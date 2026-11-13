import { describe, expect, it, vi } from 'vitest';
import { createSparklineCache } from './sparklineCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSparklineCache', () => {
  it('shares one request between concurrent loads of the same symbol', async () => {
    const request = deferred<number[]>();
    const fetchCloses = vi.fn(() => request.promise);
    const cache = createSparklineCache({ fetchCloses });
    const first = cache.load('aapl');
    const second = cache.load('AAPL');
    expect(fetchCloses).toHaveBeenCalledTimes(1);
    expect(fetchCloses).toHaveBeenCalledWith('AAPL');
    request.resolve([1, 2, 3]);
    await expect(first).resolves.toEqual([1, 2, 3]);
    await expect(second).resolves.toEqual([1, 2, 3]);
  });

  it('serves a fresh result without asking again, then asks once it expires', async () => {
    let now = 1_000;
    const fetchCloses = vi.fn(() => Promise.resolve([1, 2]));
    const cache = createSparklineCache({ fetchCloses, ttlMs: 100, now: () => now });
    await cache.load('AAPL');
    expect(cache.peek('AAPL')).toEqual([1, 2]);
    await cache.load('AAPL');
    expect(fetchCloses).toHaveBeenCalledTimes(1);

    now += 100;
    expect(cache.peek('AAPL')).toBeUndefined();
    await cache.load('AAPL');
    expect(fetchCloses).toHaveBeenCalledTimes(2);
  });

  it('does not keep failures, so the next load tries again', async () => {
    const fetchCloses = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([4, 5]);
    const cache = createSparklineCache({ fetchCloses });
    await expect(cache.load('AAPL')).rejects.toThrow('down');
    await expect(cache.load('AAPL')).resolves.toEqual([4, 5]);
    expect(fetchCloses).toHaveBeenCalledTimes(2);
  });

  it('does not keep empty history', async () => {
    const fetchCloses = vi.fn(() => Promise.resolve([]));
    const cache = createSparklineCache({ fetchCloses });
    await cache.load('AAPL');
    expect(cache.peek('AAPL')).toBeUndefined();
    await cache.load('AAPL');
    expect(fetchCloses).toHaveBeenCalledTimes(2);
  });

  it('keeps symbols apart', async () => {
    const fetchCloses = vi.fn((symbol: string) => Promise.resolve(symbol === 'AAPL' ? [1, 2] : [3, 4]));
    const cache = createSparklineCache({ fetchCloses });
    await expect(cache.load('AAPL')).resolves.toEqual([1, 2]);
    await expect(cache.load('BTC/USD')).resolves.toEqual([3, 4]);
  });

  it('forgets everything on clear, and a request from before the clear does not refill it', async () => {
    const request = deferred<number[]>();
    const fetchCloses = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue([9, 9]);
    const cache = createSparklineCache({ fetchCloses });
    const early = cache.load('AAPL');
    cache.clear();
    request.resolve([1, 2]);
    await expect(early).resolves.toEqual([1, 2]);
    expect(cache.peek('AAPL')).toBeUndefined();
    await expect(cache.load('AAPL')).resolves.toEqual([9, 9]);
  });
});
