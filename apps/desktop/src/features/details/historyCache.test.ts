import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../data/api';
import type { ChartRange, HistoryResult } from '../../domain/types';
import { createHistoryCache, historyTtlMs, isAbortError } from './historyCache';

interface Call {
  symbol: string;
  range: ChartRange;
  signal: AbortSignal;
  resolve: (result: HistoryResult) => void;
  reject: (error: unknown) => void;
}

function result(symbol: string, range: ChartRange, barCount = 1): HistoryResult {
  const timeframe = range === '1D' ? '5Min' : '1Day';
  const bars = Array.from({ length: barCount }, (_, i) => ({
    time: 1_700_000_000 + i * 300,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 1_000,
  }));
  return { symbol, range, timeframe, bars, truncated: false, simulated: true };
}

/** A cache over a fetch the test settles by hand, with a clock the test moves. */
function setup(maxEntries?: number) {
  const calls: Call[] = [];
  let time = 0;
  const fetchHistory = vi.fn(
    (symbol: string, range: ChartRange, signal: AbortSignal) =>
      new Promise<HistoryResult>((resolve, reject) => {
        calls.push({ symbol, range, signal, resolve, reject });
      }),
  );
  const cache = createHistoryCache({ fetchHistory, now: () => time, ...(maxEntries ? { maxEntries } : {}) });
  return {
    cache,
    calls,
    fetchHistory,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

function lastCall(calls: Call[]): Call {
  const call = calls.at(-1);
  if (!call) throw new Error('No fetch yet.');
  return call;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('historyTtlMs', () => {
  it('keeps intraday bars briefly and daily bars longer', () => {
    expect(historyTtlMs('5Min')).toBe(60_000);
    expect(historyTtlMs('1Hour')).toBe(60_000);
    expect(historyTtlMs('1Day')).toBe(15 * 60_000);
    expect(historyTtlMs('1Month')).toBe(15 * 60_000);
  });
});

describe('history cache', () => {
  it('serves a fresh result without fetching again', async () => {
    const { cache, calls, fetchHistory } = setup();
    const first = cache.load('AAPL', '1Y');
    lastCall(calls).resolve(result('AAPL', '1Y'));
    const value = await first;
    expect(cache.peek('AAPL', '1Y')).toBe(value);
    await expect(cache.load('AAPL', '1Y')).resolves.toBe(value);
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });

  it('keys by normalized symbol and requests the normalized symbol', async () => {
    const { cache, calls, fetchHistory } = setup();
    const first = cache.load(' aapl ', '1Y');
    expect(lastCall(calls).symbol).toBe('AAPL');
    lastCall(calls).resolve(result('AAPL', '1Y'));
    await first;
    expect(cache.peek('AAPL', '1Y')).toBeDefined();
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });

  it('expires intraday results after a minute and daily results after fifteen', async () => {
    const { cache, calls, advance } = setup();
    const intraday = cache.load('AAPL', '1D');
    lastCall(calls).resolve(result('AAPL', '1D'));
    const daily = cache.load('AAPL', '1Y');
    lastCall(calls).resolve(result('AAPL', '1Y'));
    await Promise.all([intraday, daily]);

    advance(59_999);
    expect(cache.peek('AAPL', '1D')).toBeDefined();
    advance(1);
    expect(cache.peek('AAPL', '1D')).toBeUndefined();
    expect(cache.peek('AAPL', '1Y')).toBeDefined();
    advance(15 * 60_000);
    expect(cache.peek('AAPL', '1Y')).toBeUndefined();

    void cache.load('AAPL', '1Y');
    expect(calls).toHaveLength(3);
  });

  it('shares one request between concurrent callers', async () => {
    const { cache, calls } = setup();
    const a = cache.load('AAPL', '1M', new AbortController().signal);
    const b = cache.load('AAPL', '1M', new AbortController().signal);
    expect(calls).toHaveLength(1);
    lastCall(calls).resolve(result('AAPL', '1M'));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
  });

  it('keeps the shared request alive while another caller still waits', async () => {
    const { cache, calls } = setup();
    const leaving = new AbortController();
    const a = cache.load('AAPL', '1M', leaving.signal);
    const b = cache.load('AAPL', '1M', new AbortController().signal);
    leaving.abort();
    await expect(a).rejects.toSatisfy(isAbortError);
    await flush();
    expect(lastCall(calls).signal.aborted).toBe(false);
    lastCall(calls).resolve(result('AAPL', '1M'));
    await expect(b).resolves.toMatchObject({ range: '1M' });
  });

  it('cancels the request once every caller has left, and caches nothing', async () => {
    const { cache, calls } = setup();
    const controller = new AbortController();
    const pending = cache.load('AAPL', '1M', controller.signal);
    controller.abort();
    await expect(pending).rejects.toSatisfy(isAbortError);
    await flush();
    const call = lastCall(calls);
    expect(call.signal.aborted).toBe(true);
    call.resolve(result('AAPL', '1M'));
    await flush();
    expect(cache.peek('AAPL', '1M')).toBeUndefined();
  });

  it('keeps one request when a caller leaves and rejoins at once, as a StrictMode remount does', async () => {
    const { cache, calls } = setup();
    const first = new AbortController();
    const abandoned = cache.load('AAPL', '1M', first.signal);
    first.abort();
    const rejoined = cache.load('AAPL', '1M', new AbortController().signal);
    await expect(abandoned).rejects.toSatisfy(isAbortError);
    await flush();
    expect(calls).toHaveLength(1);
    expect(lastCall(calls).signal.aborted).toBe(false);
    lastCall(calls).resolve(result('AAPL', '1M'));
    await expect(rejoined).resolves.toMatchObject({ range: '1M' });
  });

  it('never caches a failure', async () => {
    const { cache, calls } = setup();
    const failing = cache.load('AAPL', '5Y');
    lastCall(calls).reject(new ApiError('PROVIDER_ERROR', 'Provider down', 502));
    await expect(failing).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(cache.peek('AAPL', '5Y')).toBeUndefined();
    void cache.load('AAPL', '5Y');
    expect(calls).toHaveLength(2);
  });

  it('returns an empty result but fetches again next time', async () => {
    const { cache, calls } = setup();
    const empty = cache.load('AAPL', '1D');
    lastCall(calls).resolve(result('AAPL', '1D', 0));
    await expect(empty).resolves.toMatchObject({ bars: [] });
    expect(cache.peek('AAPL', '1D')).toBeUndefined();
    void cache.load('AAPL', '1D');
    expect(calls).toHaveLength(2);
  });

  it('rejects an already aborted call without fetching', async () => {
    const { cache, fetchHistory } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(cache.load('AAPL', '1M', controller.signal)).rejects.toSatisfy(isAbortError);
    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it('drops the oldest entries beyond its limit', async () => {
    const { cache, calls } = setup(2);
    for (const range of ['1M', '3M', '6M'] as const) {
      const load = cache.load('AAPL', range);
      lastCall(calls).resolve(result('AAPL', range));
      await load;
    }
    expect(cache.peek('AAPL', '1M')).toBeUndefined();
    expect(cache.peek('AAPL', '3M')).toBeDefined();
    expect(cache.peek('AAPL', '6M')).toBeDefined();
  });

  it('clear forgets results and cancels requests in flight', async () => {
    const { cache, calls } = setup();
    const done = cache.load('AAPL', '1M');
    lastCall(calls).resolve(result('AAPL', '1M'));
    await done;
    const inFlight = cache.load('AAPL', '3M');
    cache.clear();
    expect(cache.peek('AAPL', '1M')).toBeUndefined();
    expect(lastCall(calls).signal.aborted).toBe(true);
    lastCall(calls).reject(new ApiError('ABORTED', 'cancelled', 499));
    await expect(inFlight).rejects.toSatisfy(isAbortError);
  });
});

describe('isAbortError', () => {
  it('recognizes API and DOM cancellations only', () => {
    expect(isAbortError(new ApiError('ABORTED', 'cancelled', 499))).toBe(true);
    expect(isAbortError(new DOMException('stop', 'AbortError'))).toBe(true);
    expect(isAbortError(new ApiError('PROVIDER_ERROR', 'down', 502))).toBe(false);
    expect(isAbortError(new Error('boom'))).toBe(false);
  });
});
