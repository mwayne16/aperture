import { createServer, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { RedisConnection } from '../redis/redisConnection.js';
import { newsArticle } from '../test/fakeNewsSource.js';
import { RedisNewsCache } from './redisNewsCache.js';

const NOW = Date.parse('2026-11-16T15:00:00Z');
const opened: RedisConnection[] = [];
let warnings: string[] = [];

const log = {
  info: () => undefined,
  warn: (...args: unknown[]) => {
    warnings.push(String(args.at(-1)));
  },
} as never;

function connect(
  url: string,
  options: ConstructorParameters<typeof RedisConnection>[1] = {},
): RedisConnection {
  const redis = new RedisConnection(url, options);
  opened.push(redis);
  redis.start(log);
  return redis;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((redis) => redis.close()));
  warnings = [];
});

describe('RedisNewsCache', () => {
  it('keeps articles in Redis for the given time, readable by a fresh cache', async () => {
    const redis = connect(inject('redisUrl'));
    await vi.waitFor(() => {
      expect(redis.ready).toBe(true);
    });
    const articles = [newsArticle(NOW, { symbols: ['AAPL'] })];
    await new RedisNewsCache(redis).set('news:test:roundtrip', articles, 500);

    // ** A new cache has an empty memory copy, so this read can only come from Redis.
    expect(await new RedisNewsCache(redis).get('news:test:roundtrip')).toEqual(articles);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await new RedisNewsCache(redis).get('news:test:roundtrip')).toBeNull();
  });

  it('ignores cached data it cannot read', async () => {
    const redis = connect(inject('redisUrl'));
    await vi.waitFor(() => {
      expect(redis.ready).toBe(true);
    });
    await redis.set('news:test:broken', '{"not":"a list"}', 10_000);
    expect(await new RedisNewsCache(redis).get('news:test:broken')).toBeNull();
  });

  it('answers from memory while Redis is unreachable, and warns once', async () => {
    const redis = connect('redis://127.0.0.1:1', { maxAttempts: 2, recoveryDelayMs: 60_000 });
    const cache = new RedisNewsCache(redis);
    const articles = [newsArticle(NOW)];
    await cache.set('news:test:offline', articles, 10_000);
    expect(await cache.get('news:test:offline')).toEqual(articles);
    await vi.waitFor(() => {
      expect(warnings).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(warnings).toEqual(['Redis is unavailable; caching in memory until it is back']);
    expect(redis.ready).toBe(false);
  });
});

describe('RedisConnection', () => {
  it('closes cleanly and leaves no retry behind', async () => {
    const redis = connect('redis://127.0.0.1:1', { maxAttempts: 1, recoveryDelayMs: 60_000 });
    await vi.waitFor(() => {
      expect(warnings).toHaveLength(1);
    });
    await redis.close();
    expect(redis.ready).toBe(false);
  });
});

describe('RedisConnection recovery', () => {
  it('connects again after it stopped retrying', async () => {
    let connections = 0;
    // ** A server that accepts and drops every connection, so the client exhausts its attempts.
    const server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      connect(`redis://127.0.0.1:${String(port)}`, { maxAttempts: 1, recoveryDelayMs: 50 });
      await vi.waitFor(
        () => {
          expect(connections).toBeGreaterThanOrEqual(5);
        },
        { timeout: 5_000 },
      );
      expect(warnings).toEqual(['Redis is unavailable; caching in memory until it is back']);
    } finally {
      await Promise.all(opened.splice(0).map((redis) => redis.close()));
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
