import { validateAlertFields } from '@aperture/shared/alertRules';
import { resolveRange } from '../../domain/chartRanges';
import { MAX_WATCHLIST_SYMBOLS, normalizeSymbol, validateSymbol } from '@aperture/shared/symbols';
import {
  CHART_RANGES,
  type AssetClass,
  type ChartRange,
  type HistoryResult,
  type Instrument,
  type PriceAlert,
  type Quote,
  type UpdateAlertInput,
  type Watchlist,
} from '../../domain/types';
import { ApiError, isApiError, type ApiErrorDetail, type MarketApi } from '../api';
import { generateHistory } from './history';
import { simulatedNews } from './news';
import { quoteFromState, unavailableQuote } from './quotes';
import { INSTRUMENTS, toInstrument, type InstrumentProfile } from './instruments';
import { createMockMarket, type MockMarket } from './market';
import { DELAYED_FEED_MS } from './mockRealtime';
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
const DEFAULT_MOVERS_LIMIT = 5;
const DEFAULT_NEWS_LIMIT = 10;
const MAX_LIST_LIMIT = 50;
const ASSET_CLASSES: readonly AssetClass[] = ['stock', 'etf', 'crypto'];
export const MAX_SEARCH_LIMIT = 50;

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

  function checkLimit(limit: unknown, fallback: number): number {
    if (limit === undefined) return fallback;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      throw validationError([{ field: 'limit', message: `Limit must be a whole number from 1 to ${MAX_LIST_LIMIT}.` }]);
    }
    return limit;
  }

  /** A point-in-time quote, after trading the symbol forward if nobody has streamed it lately. */
  function snapshot(symbol: string, at: number): Quote {
    const state = market.catchUp(symbol, at);
    if (!state) return unavailableQuote(symbol, at);
    const tradedAt = market.lastTradeAt(symbol) ?? at;
    return simulation.get().feedScenario === 'delayed'
      ? quoteFromState(state, tradedAt - DELAYED_FEED_MS, 'delayed', at)
      : quoteFromState(state, tradedAt, 'live', at);
  }

  return {
    getWatchlist: () => request(() => repo.getWatchlist()),

    addSymbol: (symbol) =>
      request(() => {
        const current = repo.getWatchlist();
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

    removeSymbol: (symbol) =>
      request(() => {
        const current = repo.getWatchlist();
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

    reorderSymbols: (symbols) =>
      request(() => {
        const current = repo.getWatchlist();
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
          continuous: profile.assetClass === 'crypto',
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

    listInstruments: (assetClass) =>
      request(() => {
        if (!ASSET_CLASSES.includes(assetClass)) {
          throw validationError([{ field: 'assetClass', message: 'Asset class must be stock, etf or crypto.' }]);
        }
        return instruments
          .filter((i) => i.assetClass === assetClass)
          .sort((a, b) => a.symbol.localeCompare(b.symbol))
          .map(toInstrument);
      }),

    getSnapshots: (symbols) =>
      request(() => {
        if (!Array.isArray(symbols) || symbols.length > MAX_SEARCH_LIMIT * 4) {
          throw validationError([{ field: 'symbols', message: 'Ask for at most 200 symbols at a time.' }]);
        }
        const at = now();
        return (symbols as readonly unknown[]).map((raw) => {
          const result = validateSymbol(asString(raw));
          return result.ok ? snapshot(result.value, at) : unavailableQuote(asString(raw), at);
        });
      }),

    getMovers: (limit) =>
      request(() => {
        const count = checkLimit(limit, DEFAULT_MOVERS_LIMIT);
        const at = now();
        const quotes = instruments
          .filter((i) => i.assetClass === 'stock')
          .map((i) => snapshot(i.symbol, at))
          .filter((q) => q.changePct !== null);
        const byChange = [...quotes].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
        return {
          gainers: byChange.filter((q) => (q.changePct ?? 0) > 0).slice(0, count),
          losers: byChange.filter((q) => (q.changePct ?? 0) < 0).reverse().slice(0, count),
          mostActive: [...quotes].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, count),
          asOf: at,
          simulated: true,
        };
      }),

    getNews: (options = {}) =>
      request(() => {
        const input = asRecord(options);
        const count = checkLimit(input.limit, DEFAULT_NEWS_LIMIT);
        const wanted = Array.isArray(input.symbols) ? (input.symbols as unknown[]).map((s) => normalizeSymbol(asString(s))) : null;
        const profiles = wanted ? instruments.filter((i) => wanted.includes(i.symbol)) : instruments;
        return simulatedNews(profiles, count, now());
      }),
  };
}
