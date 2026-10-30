import { resolveRange } from '../../domain/chartRanges';
import {
  MAX_WATCHLIST_SYMBOLS,
  normalizeSymbol,
  validateSymbol,
  validateWatchlistName,
} from '../../domain/symbols';
import {
  CHART_RANGES,
  type AlertCondition,
  type AlertTag,
  type ChartRange,
  type CreateAlertInput,
  type HistoryResult,
  type Instrument,
  type PriceAlert,
  type UpdateAlertInput,
  type Watchlist,
} from '../../domain/types';
import { ApiError, isApiError, type ApiErrorDetail, type MarketApi } from '../api';
import { generateHistory } from './history';
import { INSTRUMENTS, toInstrument, type InstrumentProfile } from './instruments';
import { createMockMarket, type MockMarket } from './market';
import { makeId } from './random';
import type { Repository } from './repository';
import { createSimulationSource, type SimulationSource } from './simulationSource';

/**
 * Mock implementation of the backend HTTP API. Every call waits `apiLatencyMs` (history uses the
 * history scenario's delay instead), then runs against the shared repository, so alert changes
 * reach the mock realtime's evaluation immediately. Errors mirror the backend envelope via ApiError.
 */

export const HISTORY_DELAY_MS = { normal: 400, slow: 2500 } as const;
export const DEFAULT_SEARCH_LIMIT = 8;
export const MAX_SEARCH_LIMIT = 50;
export const NOTE_MAX_LENGTH = 500;
export const MAX_TARGET_PRICE = 1_000_000;

export interface MockApiOptions {
  repo: Repository;
  market?: MockMarket;
  simulation?: SimulationSource;
  now?: () => number;
  createId?: (prefix: string) => string;
  instruments?: readonly InstrumentProfile[];
}

function validationError(details: ApiErrorDetail[]): ApiError {
  return new ApiError('VALIDATION_ERROR', details[0]?.message ?? 'The request is invalid.', 400, details);
}

function notFound(message: string): ApiError {
  return new ApiError('NOT_FOUND', message, 404);
}

function conflict(field: string, message: string): ApiError {
  return new ApiError('CONFLICT', message, 409, [{ field, message }]);
}

function unavailable(): ApiError {
  return new ApiError(
    'UNAVAILABLE',
    'The service is temporarily unavailable (simulated failure). Try again.',
    503,
  );
}

function aborted(): ApiError {
  return new ApiError('ABORTED', 'The request was cancelled.', 499);
}

/** Resolves after `ms`, or rejects with ABORTED when `signal` aborts first. Resolves on a microtask for 0. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const delay = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    if (delay === 0 && !signal) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runtime guard for untyped callers: non-strings validate as empty input. */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isCondition(value: unknown): value is AlertCondition {
  return value === 'above' || value === 'below';
}

function isTag(value: unknown): value is AlertTag {
  return value === 'buy' || value === 'sell';
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

type AlertFields = Partial<Record<keyof CreateAlertInput, unknown>>;

/** Validates alert fields. On create every required field is checked; on update only those present. */
function validateAlertFields(input: AlertFields, mode: 'create' | 'update'): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];
  const required = mode === 'create';
  if (required) {
    const symbol = typeof input.symbol === 'string' ? validateSymbol(input.symbol) : null;
    if (!symbol?.ok) details.push({ field: 'symbol', message: symbol?.reason ?? 'Enter a symbol.' });
  }
  if ((required || input.condition !== undefined) && !isCondition(input.condition)) {
    details.push({ field: 'condition', message: 'Condition must be "above" or "below".' });
  }
  if (required || input.targetPrice !== undefined) {
    const price = input.targetPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      details.push({ field: 'targetPrice', message: 'Enter a target price greater than 0.' });
    } else if (price > MAX_TARGET_PRICE) {
      details.push({ field: 'targetPrice', message: `Target price must be ${MAX_TARGET_PRICE} or less.` });
    }
  }
  if ((required || input.tag !== undefined) && !isTag(input.tag)) {
    details.push({ field: 'tag', message: 'Tag must be "buy" or "sell".' });
  }
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    details.push({ field: 'enabled', message: 'Enabled must be true or false.' });
  }
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') {
      details.push({ field: 'note', message: 'Note must be text.' });
    } else if (input.note.trim().length > NOTE_MAX_LENGTH) {
      details.push({ field: 'note', message: `Use ${NOTE_MAX_LENGTH} characters or fewer.` });
    }
  }
  return details;
}

/** Trims a note; blank becomes null. */
function normalizeNote(note: string | null | undefined): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  return trimmed === '' ? null : trimmed;
}

/** Runtime guard for untyped callers: a non-object body reads as having no fields. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function createMockApi(options: MockApiOptions): MarketApi {
  const { repo } = options;
  const market = options.market ?? createMockMarket();
  const simulation = options.simulation ?? createSimulationSource();
  const now = options.now ?? (() => Date.now());
  const createId = options.createId ?? makeId;
  const instruments = options.instruments ?? INSTRUMENTS;

  /** ISO timestamp for a mutation, strictly later than `previous` so updatedAt always changes. */
  function stamp(previous?: string): string {
    let ms = now();
    const before = previous === undefined ? Number.NaN : Date.parse(previous);
    if (Number.isFinite(before) && before >= ms) ms = before + 1;
    return new Date(ms).toISOString();
  }

  /** Consumes the one-shot failure flag. Returns true when this call must fail. */
  function takeFailure(): boolean {
    if (!simulation.get().failNextApiCall) return false;
    simulation.patch({ failNextApiCall: false });
    return true;
  }

  async function request<T>(handler: () => T): Promise<T> {
    const fail = takeFailure();
    await sleep(simulation.get().apiLatencyMs);
    if (fail) throw unavailable();
    try {
      return handler();
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new ApiError('INTERNAL', 'Unexpected error in the simulated backend.', 500);
    }
  }

  function requireWatchlist(id: string): Watchlist {
    const watchlist = repo.getWatchlist(id);
    if (!watchlist) throw notFound('Watchlist not found.');
    return watchlist;
  }

  function validName(name: unknown): string {
    const result = validateWatchlistName(asString(name), []);
    if (!result.ok) throw validationError([{ field: 'name', message: result.reason }]);
    return result.value;
  }

  function assertUniqueName(name: string, exceptId?: string): void {
    const clash = repo.listWatchlists().some((w) => w.id !== exceptId && sameName(w.name, name));
    if (clash) throw conflict('name', 'You already have a watchlist with this name.');
  }

  function searchUniverse(query: string, limit: number): Instrument[] {
    const upper = query.toUpperCase();
    const lower = query.toLowerCase();
    const exact = instruments.filter((i) => i.symbol === upper);
    const prefix = instruments
      .filter((i) => i.symbol !== upper && i.symbol.startsWith(upper))
      .sort((a, b) => a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol));
    const byName = instruments
      .filter((i) => !i.symbol.startsWith(upper) && i.name.toLowerCase().includes(lower))
      .sort(
        (a, b) =>
          a.name.toLowerCase().indexOf(lower) - b.name.toLowerCase().indexOf(lower) ||
          a.name.localeCompare(b.name),
      );
    return [...exact, ...prefix, ...byName].slice(0, limit).map(toInstrument);
  }

  return {
    listWatchlists: () => request(() => repo.listWatchlists()),

    createWatchlist: (input) =>
      request(() => {
        const name = validName(asRecord(input).name);
        assertUniqueName(name);
        const iso = stamp();
        const watchlist: Watchlist = {
          id: createId('wl'),
          name,
          symbols: [],
          createdAt: iso,
          updatedAt: iso,
        };
        repo.saveWatchlist(watchlist);
        return watchlist;
      }),

    renameWatchlist: (id, name) =>
      request(() => {
        const current = requireWatchlist(id);
        const nextName = validName(name);
        assertUniqueName(nextName, id);
        const next: Watchlist = { ...current, name: nextName, updatedAt: stamp(current.updatedAt) };
        repo.saveWatchlist(next);
        return next;
      }),

    deleteWatchlist: (id) =>
      request(() => {
        if (!repo.deleteWatchlist(id)) throw notFound('Watchlist not found.');
      }),

    addSymbol: (watchlistId, symbol) =>
      request(() => {
        const current = requireWatchlist(watchlistId);
        const result = validateSymbol(asString(symbol));
        if (!result.ok) throw validationError([{ field: 'symbol', message: result.reason }]);
        if (current.symbols.includes(result.value)) {
          throw conflict('symbol', `${result.value} is already in this watchlist.`);
        }
        if (current.symbols.length >= MAX_WATCHLIST_SYMBOLS) {
          throw validationError([
            { field: 'symbol', message: `This watchlist is full (${MAX_WATCHLIST_SYMBOLS} symbols max).` },
          ]);
        }
        const next: Watchlist = {
          ...current,
          symbols: [...current.symbols, result.value],
          updatedAt: stamp(current.updatedAt),
        };
        repo.saveWatchlist(next);
        return next;
      }),

    removeSymbol: (watchlistId, symbol) =>
      request(() => {
        const current = requireWatchlist(watchlistId);
        const normalized = normalizeSymbol(asString(symbol));
        if (!current.symbols.includes(normalized))
          throw notFound(`${normalized || 'Symbol'} is not in this watchlist.`);
        const next: Watchlist = {
          ...current,
          symbols: current.symbols.filter((s) => s !== normalized),
          updatedAt: stamp(current.updatedAt),
        };
        repo.saveWatchlist(next);
        return next;
      }),

    reorderSymbols: (watchlistId, symbols) =>
      request(() => {
        const current = requireWatchlist(watchlistId);
        if (!Array.isArray(symbols)) {
          throw validationError([{ field: 'symbols', message: 'Symbols must be a list.' }]);
        }
        const details: ApiErrorDetail[] = [];
        const seen = new Set<string>();
        const ordered: string[] = [];
        (symbols as readonly unknown[]).forEach((raw, index) => {
          const field = `symbols.${index}`;
          if (typeof raw !== 'string') {
            details.push({ field, message: 'Each entry must be a symbol.' });
            return;
          }
          const symbol = normalizeSymbol(raw);
          if (!current.symbols.includes(symbol)) {
            details.push({ field, message: `${symbol || 'This entry'} is not in this watchlist.` });
          } else if (seen.has(symbol)) {
            details.push({ field, message: `${symbol} appears more than once.` });
          }
          seen.add(symbol);
          ordered.push(symbol);
        });
        const missing = current.symbols.filter((s) => !seen.has(s));
        if (missing.length > 0) {
          details.push({ field: 'symbols', message: `The new order is missing ${missing.join(', ')}.` });
        }
        if (details.length > 0) throw validationError(details);
        const next: Watchlist = { ...current, symbols: ordered, updatedAt: stamp(current.updatedAt) };
        repo.saveWatchlist(next);
        return next;
      }),

    listAlerts: () => request(() => repo.listAlerts()),

    createAlert: (input) =>
      request(() => {
        const fields = asRecord(input);
        const details = validateAlertFields(fields, 'create');
        if (details.length > 0) throw validationError(details);
        const iso = stamp();
        const alert: PriceAlert = {
          id: createId('alert'),
          symbol: normalizeSymbol(input.symbol),
          condition: input.condition,
          targetPrice: input.targetPrice,
          tag: input.tag,
          field: 'last',
          enabled: input.enabled ?? true,
          armed: true,
          note: normalizeNote(input.note),
          createdAt: iso,
          updatedAt: iso,
          lastTriggeredAt: null,
          lastTriggeredPrice: null,
          triggerCount: 0,
        };
        repo.saveAlert(alert);
        return alert;
      }),

    updateAlert: (id, input: UpdateAlertInput) =>
      request(() => {
        const current = repo.getAlert(id);
        if (!current) throw notFound('Alert not found.');
        const fields = asRecord(input);
        // Only the documented fields are updatable; symbol and field never change.
        const details = validateAlertFields(
          {
            condition: fields.condition,
            targetPrice: fields.targetPrice,
            tag: fields.tag,
            enabled: fields.enabled,
            note: fields.note,
          },
          'update',
        );
        if (details.length > 0) throw validationError(details);

        const next: PriceAlert = { ...current };
        let rearm = false;
        if (input.condition !== undefined && input.condition !== current.condition) {
          next.condition = input.condition;
          rearm = true;
        }
        if (input.targetPrice !== undefined && input.targetPrice !== current.targetPrice) {
          next.targetPrice = input.targetPrice;
          rearm = true;
        }
        if (input.tag !== undefined) next.tag = input.tag;
        if (input.enabled !== undefined) {
          if (input.enabled && !current.enabled) rearm = true;
          next.enabled = input.enabled;
        }
        if (input.note !== undefined) next.note = normalizeNote(input.note);
        if (rearm) next.armed = true;
        next.updatedAt = stamp(current.updatedAt);
        repo.saveAlert(next);
        return next;
      }),

    deleteAlert: (id) =>
      request(() => {
        if (!repo.deleteAlert(id)) throw notFound('Alert not found.');
      }),

    searchInstruments: (query, limit = DEFAULT_SEARCH_LIMIT) =>
      request(() => {
        if (!Number.isInteger(limit) || limit < 1) {
          throw validationError([{ field: 'limit', message: 'Limit must be a whole number of at least 1.' }]);
        }
        const trimmed = asString(query).trim();
        if (trimmed === '') return [];
        return searchUniverse(trimmed, Math.min(limit, MAX_SEARCH_LIMIT));
      }),

    getInstrument: (symbol) =>
      request(() => {
        const result = validateSymbol(asString(symbol));
        if (!result.ok) throw validationError([{ field: 'symbol', message: result.reason }]);
        const profile = market.getProfile(result.value);
        return profile ? toInstrument(profile) : null;
      }),

    async getHistory(symbol: string, range: ChartRange, signal?: AbortSignal): Promise<HistoryResult> {
      if (signal?.aborted) throw aborted();
      const fail = takeFailure();
      const scenario = simulation.get().historyScenario;
      await sleep(scenario === 'slow' ? HISTORY_DELAY_MS.slow : HISTORY_DELAY_MS.normal, signal);
      if (signal?.aborted) throw aborted();
      if (fail) throw unavailable();

      const result = validateSymbol(asString(symbol));
      if (!result.ok) throw validationError([{ field: 'symbol', message: result.reason }]);
      if (!(CHART_RANGES as readonly unknown[]).includes(range)) {
        throw validationError([
          { field: 'range', message: `Range must be one of ${CHART_RANGES.join(', ')}.` },
        ]);
      }
      const profile = market.getProfile(result.value);
      if (!profile) throw notFound(`No instrument found for ${result.value}.`);
      if (scenario === 'error') {
        throw new ApiError(
          'PROVIDER_ERROR',
          'The market data provider could not load history (simulated).',
          502,
        );
      }

      try {
        const spec = resolveRange(range, new Date(now()));
        const base = { symbol: result.value, range, timeframe: spec.timeframe, simulated: true };
        if (scenario === 'empty') return { ...base, bars: [], truncated: false };

        const { bars, truncated } = generateHistory({
          symbol: result.value,
          timeframe: spec.timeframe,
          start: spec.start,
          end: spec.end,
          lastSessionOnly: spec.lastSessionOnly,
          listedYear: profile.listedYear,
          volatility: profile.volatility,
          averageVolume: profile.averageVolume,
          lastPrice: market.getState(result.value)?.last ?? profile.referencePrice,
        });
        return { ...base, bars, truncated };
      } catch {
        throw new ApiError('INTERNAL', 'Unexpected error in the simulated backend.', 500);
      }
    },
  };
}
