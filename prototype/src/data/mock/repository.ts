import { MAX_WATCHLIST_SYMBOLS, validateSymbol } from '../../domain/symbols';
import type { PriceAlert, Watchlist } from '../../domain/types';
import type { Unsubscribe } from '../realtime';
import { buildSeedData, type SeedData } from './seed';

/**
 * The mock backend's persistence: the watchlist and alerts in localStorage under STORAGE_KEY as
 * `{ version: 2, watchlist, alerts }`. Reads return copies, so callers can't mutate stored state.
 * Version 1 data, from when users could keep several watchlists, is merged into one list in order.
 *
 * Loading never throws: missing, corrupted or unknown-version data falls back to the seed, invalid
 * entries are dropped, and storage exceptions (blocked storage, quota) are caught. The in-memory
 * state stays authoritative when storage fails.
 */

export const STORAGE_KEY = 'aperture.prototype.v1';
const STORAGE_VERSION = 2;
const LEGACY_MULTI_LIST_VERSION = 1;

export type RepositoryData = SeedData;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Repository {
  getWatchlist(): Watchlist;
  saveWatchlist(watchlist: Watchlist): void;
  listAlerts(): PriceAlert[];
  getAlert(id: string): PriceAlert | undefined;
  /** Replaces the alert with the same id, or appends a new one. */
  saveAlert(alert: PriceAlert): void;
  deleteAlert(id: string): boolean;
  /** Wipes persisted data and restores the seed. */
  reset(): void;
  /** Called synchronously after every change. */
  subscribe(listener: () => void): Unsubscribe;
}

export interface RepositoryOptions {
  /** Defaults to window.localStorage. Pass null for memory only. */
  storage?: StorageLike | null;
  key?: string;
  seed?: () => RepositoryData;
  now?: () => number;
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    // Accessing localStorage throws when site data is blocked.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

/** Valid, unique symbols in order, capped at the watchlist limit. Anything else is dropped. */
function sanitizeSymbols(values: readonly unknown[]): string[] {
  const unique: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const symbol = validateSymbol(raw);
    if (symbol.ok && !unique.includes(symbol.value)) unique.push(symbol.value);
  }
  return unique.slice(0, MAX_WATCHLIST_SYMBOLS);
}

function sanitizeWatchlist(value: unknown, fallbackIso: string): Watchlist | null {
  if (!isRecord(value) || !Array.isArray(value.symbols)) return null;
  return {
    symbols: sanitizeSymbols(value.symbols),
    updatedAt: isIsoDate(value.updatedAt) ? value.updatedAt : fallbackIso,
  };
}

/** Merges the lists of version 1 data into one watchlist, keeping their order. */
function mergeLegacyLists(lists: readonly unknown[], fallbackIso: string): Watchlist {
  const symbols = lists.flatMap((list): unknown[] =>
    isRecord(list) && Array.isArray(list.symbols) ? (list.symbols as unknown[]) : [],
  );
  return { symbols: sanitizeSymbols(symbols), updatedAt: fallbackIso };
}

function sanitizeAlert(value: unknown, fallbackIso: string): PriceAlert | null {
  if (!isRecord(value)) return null;
  const v = value;
  if (typeof v.id !== 'string' || v.id === '' || typeof v.symbol !== 'string') return null;
  const symbol = validateSymbol(v.symbol);
  if (!symbol.ok) return null;
  if (v.condition !== 'above' && v.condition !== 'below') return null;
  if (v.tag !== 'buy' && v.tag !== 'sell') return null;
  if (typeof v.targetPrice !== 'number' || !Number.isFinite(v.targetPrice) || v.targetPrice <= 0) return null;
  if (typeof v.enabled !== 'boolean') return null;
  const triggerCount =
    typeof v.triggerCount === 'number' && Number.isInteger(v.triggerCount) && v.triggerCount >= 0
      ? v.triggerCount
      : 0;
  return {
    id: v.id,
    symbol: symbol.value,
    condition: v.condition,
    targetPrice: v.targetPrice,
    tag: v.tag,
    field: 'last',
    enabled: v.enabled,
    armed: typeof v.armed === 'boolean' ? v.armed : true,
    note: typeof v.note === 'string' ? v.note : null,
    createdAt: isIsoDate(v.createdAt) ? v.createdAt : fallbackIso,
    updatedAt: isIsoDate(v.updatedAt) ? v.updatedAt : fallbackIso,
    lastTriggeredAt: isIsoDate(v.lastTriggeredAt) ? v.lastTriggeredAt : null,
    lastTriggeredPrice:
      typeof v.lastTriggeredPrice === 'number' && Number.isFinite(v.lastTriggeredPrice)
        ? v.lastTriggeredPrice
        : null,
    triggerCount,
  };
}

/**
 * Parses persisted JSON. Returns null when the payload is unusable as a whole (bad JSON, unknown
 * version, wrong shape); drops individual invalid or duplicate entries.
 */
export function parsePersisted(raw: string | null, fallbackIso: string): RepositoryData | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.alerts)) return null;

  let watchlist: Watchlist | null = null;
  if (parsed.version === STORAGE_VERSION) watchlist = sanitizeWatchlist(parsed.watchlist, fallbackIso);
  else if (parsed.version === LEGACY_MULTI_LIST_VERSION && Array.isArray(parsed.watchlists)) {
    watchlist = mergeLegacyLists(parsed.watchlists, fallbackIso);
  }
  if (!watchlist) return null;

  const alerts: PriceAlert[] = [];
  for (const entry of parsed.alerts) {
    const alert = sanitizeAlert(entry, fallbackIso);
    if (alert && !alerts.some((a) => a.id === alert.id)) alerts.push(alert);
  }
  return { watchlist, alerts };
}

const cloneWatchlist = (w: Watchlist): Watchlist => ({ ...w, symbols: [...w.symbols] });
const cloneAlert = (a: PriceAlert): PriceAlert => ({ ...a });

export function createRepository(options: RepositoryOptions = {}): Repository {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const key = options.key ?? STORAGE_KEY;
  const now = options.now ?? (() => Date.now());
  const seed = options.seed ?? (() => buildSeedData({ now: now() }));
  const listeners = new Set<() => void>();

  function read(): string | null {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function persist(): void {
    try {
      storage?.setItem(key, JSON.stringify({ version: STORAGE_VERSION, watchlist, alerts }));
    } catch {
      // Quota exceeded or storage blocked: keep working from memory.
    }
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  const loaded = parsePersisted(read(), new Date(now()).toISOString()) ?? seed();
  let watchlist: Watchlist = cloneWatchlist(loaded.watchlist);
  let alerts: PriceAlert[] = loaded.alerts.map(cloneAlert);
  // Writes the seed on first run and drops invalid entries from storage.
  persist();

  return {
    getWatchlist: () => cloneWatchlist(watchlist),
    saveWatchlist(next) {
      watchlist = cloneWatchlist(next);
      persist();
      notify();
    },
    listAlerts: () => alerts.map(cloneAlert),
    getAlert(id) {
      const found = alerts.find((a) => a.id === id);
      return found ? cloneAlert(found) : undefined;
    },
    saveAlert(alert) {
      const copy = cloneAlert(alert);
      const index = alerts.findIndex((a) => a.id === copy.id);
      alerts = index === -1 ? [...alerts, copy] : alerts.map((a, i) => (i === index ? copy : a));
      persist();
      notify();
    },
    deleteAlert(id) {
      const next = alerts.filter((a) => a.id !== id);
      if (next.length === alerts.length) return false;
      alerts = next;
      persist();
      notify();
      return true;
    },
    reset() {
      try {
        storage?.removeItem(key);
      } catch {
        // Ignored: the seed is written below anyway.
      }
      const fresh = seed();
      watchlist = cloneWatchlist(fresh.watchlist);
      alerts = fresh.alerts.map(cloneAlert);
      persist();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
