import type { ApiErrorBody } from '@aperture/shared/errors';
import { MAX_WATCHLIST_SYMBOLS } from '@aperture/shared/symbols';
import type { Watchlist } from '@aperture/shared/watchlist';
import type { FastifyInstance } from 'fastify';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { openTestDatabase, resetDatabase, testConfig } from '../test/database.js';
import { WatchlistService } from './watchlistService.js';

let dataSource: DataSource;
let app: FastifyInstance;

beforeAll(async () => {
  dataSource = await openTestDatabase();
  app = buildApp({ config: testConfig, dataSource, marketData: null }, { logger: false });
});

afterAll(async () => {
  await app.close();
  await dataSource.destroy();
});

beforeEach(() => resetDatabase(dataSource));

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const response = await app.inject({ method, url, payload });
  return { status: response.statusCode, body: response.json<unknown>() };
}

async function add(symbol: string): Promise<Watchlist> {
  const { status, body } = await call('POST', '/watchlist/symbols', { symbol });
  expect(status).toBe(200);
  return body as Watchlist;
}

/** A distinct valid ticker for each index: A, B, ... Z, AA, AB, ... */
function ticker(index: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return index < 26
    ? (letters[index] ?? '')
    : `${letters[Math.floor(index / 26) - 1] ?? ''}${letters[index % 26] ?? ''}`;
}

describe('GET /watchlist', () => {
  it('starts empty on a fresh install', async () => {
    expect(await call('GET', '/watchlist')).toEqual({
      status: 200,
      body: { symbols: [], updatedAt: '2026-01-01T00:00:00.000Z' },
    });
  });
});

describe('POST /watchlist/symbols', () => {
  it('appends normalized symbols in order and moves updatedAt forward', async () => {
    await add(' aapl ');
    const watchlist = await add('btc/usd');
    expect(watchlist.symbols).toEqual(['AAPL', 'BTC/USD']);
    expect(Date.parse(watchlist.updatedAt)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'));
    expect(await call('GET', '/watchlist')).toEqual({ status: 200, body: watchlist });
  });

  it('rejects a symbol already in the list with CONFLICT', async () => {
    await add('AAPL');
    const message = 'AAPL is already in this watchlist.';
    expect(await call('POST', '/watchlist/symbols', { symbol: 'aapl' })).toEqual({
      status: 409,
      body: { error: { code: 'CONFLICT', message, details: [{ field: 'symbol', message }] } },
    });
  });

  it('rejects malformed symbols and extra fields with the shared messages', async () => {
    const { status, body } = await call('POST', '/watchlist/symbols', { symbol: 'TOOLONG', position: 0 });
    expect(status).toBe(400);
    expect((body as ApiErrorBody).error.details).toEqual([
      { field: 'position', message: 'property position should not exist' },
      {
        field: 'symbol',
        message: 'Use 1-5 letters with an optional class like ".B", or a pair like "BTC/USD".',
      },
    ]);
  });

  it(`stops at ${String(MAX_WATCHLIST_SYMBOLS)} symbols`, async () => {
    for (let index = 0; index < MAX_WATCHLIST_SYMBOLS; index += 1) await add(ticker(index));
    const message = `This watchlist is full (${String(MAX_WATCHLIST_SYMBOLS)} symbols max).`;
    expect(await call('POST', '/watchlist/symbols', { symbol: 'ZZZ' })).toEqual({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message, details: [{ field: 'symbol', message }] } },
    });
  });

  it('never exceeds the limit or duplicates a symbol under concurrent requests', async () => {
    const service = new WatchlistService(dataSource);
    const attempts = [
      ...Array.from({ length: MAX_WATCHLIST_SYMBOLS + 5 }, (_, index) => ticker(index)),
      'A',
      'A',
    ];
    const results = await Promise.allSettled(attempts.map((symbol) => service.add(symbol)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(MAX_WATCHLIST_SYMBOLS);
    const { symbols } = await service.get();
    expect(symbols).toHaveLength(MAX_WATCHLIST_SYMBOLS);
    expect(new Set(symbols).size).toBe(MAX_WATCHLIST_SYMBOLS);
  });

  it('keeps updatedAt strictly increasing when the clock stands still', async () => {
    const frozen = new Date('2026-01-01T00:00:00Z');
    const service = new WatchlistService(dataSource, () => frozen);
    const first = await service.add('AAPL');
    const second = await service.add('MSFT');
    expect(Date.parse(first.updatedAt)).toBe(frozen.getTime() + 1);
    expect(Date.parse(second.updatedAt)).toBe(frozen.getTime() + 2);
  });
});

describe('DELETE /watchlist/symbols/:symbol', () => {
  it('removes a symbol, including a URL-encoded crypto pair', async () => {
    await add('AAPL');
    await add('BTC/USD');
    await add('MSFT');
    expect(await call('DELETE', '/watchlist/symbols/btc%2Fusd')).toMatchObject({
      status: 200,
      body: { symbols: ['AAPL', 'MSFT'] },
    });
  });

  it('appends after the last symbol when earlier ones were removed', async () => {
    await add('AAPL');
    await add('MSFT');
    await call('DELETE', '/watchlist/symbols/AAPL');
    expect((await add('TSLA')).symbols).toEqual(['MSFT', 'TSLA']);
  });

  it('answers NOT_FOUND for a symbol not in the list', async () => {
    expect(await call('DELETE', '/watchlist/symbols/AAPL')).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'AAPL is not in this watchlist.', details: [] } },
    });
  });
});

describe('PUT /watchlist/order', () => {
  beforeEach(async () => {
    for (const symbol of ['AAPL', 'MSFT', 'BTC/USD']) await add(symbol);
  });

  it('stores the new order, which later additions follow', async () => {
    expect(await call('PUT', '/watchlist/order', { symbols: ['btc/usd', 'AAPL', 'MSFT'] })).toMatchObject({
      status: 200,
      body: { symbols: ['BTC/USD', 'AAPL', 'MSFT'] },
    });
    expect((await add('TSLA')).symbols).toEqual(['BTC/USD', 'AAPL', 'MSFT', 'TSLA']);
  });

  it('reports every entry that keeps the order from being a permutation', async () => {
    const { status, body } = await call('PUT', '/watchlist/order', { symbols: ['MSFT', 'MSFT', 'ZZZ'] });
    expect(status).toBe(400);
    expect((body as ApiErrorBody).error.details).toEqual([
      { field: 'symbols.1', message: 'MSFT appears more than once.' },
      { field: 'symbols.2', message: 'ZZZ is not in this watchlist.' },
      { field: 'symbols', message: 'The new order is missing AAPL, BTC/USD.' },
    ]);
    expect(((await call('GET', '/watchlist')).body as Watchlist).symbols).toEqual([
      'AAPL',
      'MSFT',
      'BTC/USD',
    ]);
  });

  it('rejects a body that is not a list of strings', async () => {
    for (const [symbols, message] of [
      ['AAPL', 'Symbols must be a list.'],
      [['AAPL', 7], 'Each entry must be a symbol.'],
    ] as const) {
      const { status, body } = await call('PUT', '/watchlist/order', { symbols });
      expect(status).toBe(400);
      expect((body as ApiErrorBody).error.details).toEqual([{ field: 'symbols', message }]);
    }
  });
});

describe('change notifications', () => {
  it('reports each committed change, and nothing for a rejected one', async () => {
    let changes = 0;
    const watchlist = new WatchlistService(dataSource, undefined, () => (changes += 1));
    await watchlist.add('AAPL');
    await watchlist.add('MSFT');
    await watchlist.reorder(['MSFT', 'AAPL']);
    await watchlist.remove('AAPL');
    await expect(watchlist.add('MSFT')).rejects.toThrow();
    await expect(watchlist.remove('ZZZZ')).rejects.toThrow();
    expect(changes).toBe(4);
  });
});
