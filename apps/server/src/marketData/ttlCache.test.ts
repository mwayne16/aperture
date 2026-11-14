import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttlCache.js';

function setup(maxEntries = 10) {
  let now = 0;
  let loads = 0;
  const cache = new TtlCache<number>(maxEntries, () => now);
  const load = (value: number) => () => {
    loads += 1;
    return Promise.resolve(value);
  };
  return { cache, load, advance: (ms: number) => (now += ms), loads: () => loads };
}

describe('TtlCache', () => {
  it('serves a value until it expires, then loads it again', async () => {
    const { cache, load, advance, loads } = setup();
    expect(await cache.get('a', 1000, load(1))).toBe(1);
    advance(999);
    expect(await cache.get('a', 1000, load(2))).toBe(1);
    advance(1);
    expect(await cache.get('a', 1000, load(3))).toBe(3);
    expect(loads()).toBe(2);
  });

  it('shares one load between concurrent requests', async () => {
    const { cache, load, loads } = setup();
    const [first, second] = await Promise.all([cache.get('a', 1000, load(1)), cache.get('a', 1000, load(2))]);
    expect([first, second]).toEqual([1, 1]);
    expect(loads()).toBe(1);
  });

  it('forgets a failed load so the next request tries again', async () => {
    const { cache, load } = setup();
    await expect(cache.get('a', 1000, () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await cache.get('a', 1000, load(2))).toBe(2);
  });

  it('drops the oldest entries beyond its size', async () => {
    const { cache, load, loads } = setup(2);
    await cache.get('a', 1000, load(1));
    await cache.get('b', 1000, load(2));
    await cache.get('c', 1000, load(3));
    await cache.get('b', 1000, load(20));
    await cache.get('a', 1000, load(10));
    expect(loads()).toBe(4);
  });
});
