import { ApiError, isApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import { normalizeSymbol } from '@aperture/shared/symbols';
import type { BarTimeframe, ChartRange, HistoryResult } from '../../domain/types';
import { isIntradayTimeframe } from './chartFormat';

/**
 * Price history keyed by symbol and range. Results stay fresh for a short time for intraday bars and
 * longer for daily and up, concurrent requests for the same key share one fetch, and failures and
 * empty results are never cached so the next load tries again.
 */

const INTRADAY_TTL_MS = 60_000;
const DAILY_TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 50;

export function historyTtlMs(timeframe: BarTimeframe): number {
  return isIntradayTimeframe(timeframe) ? INTRADAY_TTL_MS : DAILY_TTL_MS;
}

/** True for a cancelled request. Callers ignore these: they are not errors. */
export function isAbortError(error: unknown): boolean {
  if (isApiError(error)) return error.code === 'ABORTED';
  return error instanceof DOMException && error.name === 'AbortError';
}

function abortedError(): ApiError {
  return new ApiError('ABORTED', 'The request was cancelled.', 499);
}

type FetchHistory = (symbol: string, range: ChartRange, signal: AbortSignal) => Promise<HistoryResult>;

interface HistoryCacheOptions {
  fetchHistory: FetchHistory;
  now?: () => number;
  maxEntries?: number;
}

export interface HistoryCache {
  /** The cached result while it is fresh, else undefined. Never starts a request. */
  peek(symbol: string, range: ChartRange): HistoryResult | undefined;
  /**
   * Resolves from the cache while fresh. Otherwise joins the request in flight for the same key or
   * starts one. Aborting `signal` rejects this call with ABORTED; the shared request is cancelled
   * only once every caller has aborted.
   */
  load(symbol: string, range: ChartRange, signal?: AbortSignal): Promise<HistoryResult>;
  /** Drops every entry and cancels requests in flight. */
  clear(): void;
}

interface Entry {
  result: HistoryResult;
  expiresAt: number;
}

interface Pending {
  promise: Promise<HistoryResult>;
  controller: AbortController;
  callers: number;
}

export function createHistoryCache(options: HistoryCacheOptions): HistoryCache {
  const { fetchHistory, now = Date.now, maxEntries = MAX_ENTRIES } = options;
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Pending>();

  const keyOf = (symbol: string, range: ChartRange) => `${normalizeSymbol(symbol)}|${range}`;

  function fresh(key: string): HistoryResult | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > now()) return entry.result;
    entries.delete(key);
    return undefined;
  }

  function store(key: string, result: HistoryResult): void {
    // Re-inserting moves the key to the end, so the first key is always the oldest.
    entries.delete(key);
    entries.set(key, { result, expiresAt: now() + historyTtlMs(result.timeframe) });
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(oldest);
    }
  }

  function start(key: string, symbol: string, range: ChartRange): Pending {
    const controller = new AbortController();
    const settle = () => {
      if (pending.get(key)?.controller === controller) pending.delete(key);
    };
    const promise = fetchHistory(normalizeSymbol(symbol), range, controller.signal).then(
      (result) => {
        settle();
        // ** An empty result is often a provider gap rather than real absence, so it is fetched again.
        if (!controller.signal.aborted && result.bars.length > 0) store(key, result);
        return result;
      },
      (error: unknown) => {
        settle();
        throw error;
      },
    );
    // ** Every caller may leave before the request settles; its rejection must not go unhandled.
    promise.catch(() => undefined);
    return { promise, controller, callers: 0 };
  }

  function leave(key: string, request: Pending): void {
    request.callers -= 1;
    if (request.callers > 0) return;
    // ** Wait a microtask so a caller that leaves and rejoins at once (a StrictMode remount, a quick
    // toggle back) keeps the same request instead of starting a second one.
    queueMicrotask(() => {
      if (request.callers > 0 || pending.get(key) !== request) return;
      pending.delete(key);
      request.controller.abort();
    });
  }

  return {
    peek: (symbol, range) => fresh(keyOf(symbol, range)),

    load(symbol, range, signal) {
      const key = keyOf(symbol, range);
      const cached = fresh(key);
      if (cached) return Promise.resolve(cached);
      if (signal?.aborted) return Promise.reject(abortedError());

      let request = pending.get(key);
      if (!request) {
        request = start(key, symbol, range);
        pending.set(key, request);
      }
      const joined = request;
      joined.callers += 1;
      if (!signal) return joined.promise;

      return new Promise<HistoryResult>((resolve, reject) => {
        const onAbort = () => {
          leave(key, joined);
          reject(abortedError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        joined.promise.then(
          (result) => {
            signal.removeEventListener('abort', onAbort);
            resolve(result);
          },
          (error: unknown) => {
            signal.removeEventListener('abort', onAbort);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    },

    clear() {
      entries.clear();
      for (const request of pending.values()) request.controller.abort();
      pending.clear();
    },
  };
}

/** The app's history cache over `api.getHistory`. */
export const historyCache = createHistoryCache({
  fetchHistory: (symbol, range, signal) => api.getHistory(symbol, range, signal),
});
