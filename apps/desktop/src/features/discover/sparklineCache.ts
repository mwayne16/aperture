import { api } from '../../data/dataLayer';
import { normalizeSymbol } from '../../domain/symbols';

/**
 * One-day closing prices per symbol for sparklines. Every list that draws the same symbol shares one
 * request and one result. Results expire after a few minutes; failures and empty results are never
 * kept, so the next sparkline that needs the symbol asks again.
 */

const DEFAULT_TTL_MS = 5 * 60_000;

type Closes = readonly number[];

interface SparklineCacheOptions {
  fetchCloses: (symbol: string) => Promise<Closes>;
  ttlMs?: number;
  now?: () => number;
}

export interface SparklineCache {
  /** Fresh closes for `symbol`, or undefined. Never starts a request. */
  peek(symbol: string): Closes | undefined;
  /** Fresh closes from the cache, else the request in flight for the symbol, else a new request. */
  load(symbol: string): Promise<Closes>;
  /** Forgets everything. Requests already in flight finish without filling the cache. */
  clear(): void;
}

export function createSparklineCache({
  fetchCloses,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
}: SparklineCacheOptions): SparklineCache {
  const entries = new Map<string, { closes: Closes; expiresAt: number }>();
  const pending = new Map<string, Promise<Closes>>();
  let generation = 0;

  function fresh(key: string): Closes | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > now()) return entry.closes;
    entries.delete(key);
    return undefined;
  }

  return {
    peek: (symbol) => fresh(normalizeSymbol(symbol)),

    load(symbol) {
      const key = normalizeSymbol(symbol);
      const cached = fresh(key);
      if (cached) return Promise.resolve(cached);
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;

      const startedIn = generation;
      const request = fetchCloses(key).then(
        (closes) => {
          if (startedIn !== generation) return closes;
          pending.delete(key);
          if (closes.length > 0) entries.set(key, { closes, expiresAt: now() + ttlMs });
          return closes;
        },
        (error: unknown) => {
          if (startedIn === generation) pending.delete(key);
          throw error;
        },
      );
      pending.set(key, request);
      return request;
    },

    clear() {
      generation += 1;
      entries.clear();
      pending.clear();
    },
  };
}

/** The app's sparkline cache over one-day history. */
export const sparklineCache = createSparklineCache({
  fetchCloses: async (symbol) => (await api.getHistory(symbol, '1D')).bars.map((bar) => bar.close),
});
