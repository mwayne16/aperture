import { mockFetch } from '@alpacahq/alpaca-trade-api/testing';
import type { ApiErrorBody } from '@aperture/shared/errors';
import type {
  HistoryResult,
  Instrument,
  InstrumentList,
  MarketDataStatus,
  MarketMovers,
  QuoteList,
} from '@aperture/shared/marketData';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDataSource } from '../db/dataSource.js';
import { testConfig } from '../test/database.js';
import { FakeProvider, snapshot } from '../test/fakeProvider.js';
import { createAlpacaProvider } from './alpaca/alpacaProvider.js';
import { MAX_QUOTE_SYMBOLS } from './marketDataDtos.js';
import { ProviderError, type MarketDataProvider } from './provider.js';

// ** Never opened: market data doesn't touch the database.
const closedDataSource = createDataSource(testConfig.databaseUrl);

let app: FastifyInstance | null = null;

function start(marketData: MarketDataProvider | null, logStream?: { write(line: string): void }) {
  app = buildApp(
    { config: testConfig, dataSource: closedDataSource, marketData },
    logStream ? { logStream } : { logger: false },
  );
  return app;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

const get = (server: FastifyInstance, url: string) => server.inject({ method: 'GET', url });

describe('GET /instruments', () => {
  it('lists every instrument by symbol, or one asset class', async () => {
    const server = start(new FakeProvider());
    const all = await get(server, '/instruments');
    expect(all.statusCode).toBe(200);
    expect(all.json<InstrumentList>().instruments.map((i) => i.symbol)).toEqual([
      'AAL',
      'AAPL',
      'BTC/USD',
      'MSFT',
      'SPY',
    ]);
    const etfs = await get(server, '/instruments?assetClass=etf');
    expect(etfs.json<InstrumentList>().instruments.map((i) => i.symbol)).toEqual(['SPY']);
  });

  it('searches when given q, with a default and a maximum limit', async () => {
    const server = start(new FakeProvider());
    const found = await get(server, '/instruments?q=aa&limit=1');
    expect(found.json<InstrumentList>().instruments.map((i) => i.symbol)).toEqual(['AAL']);
    const defaults = await get(server, '/instruments?q=a');
    expect(defaults.json<InstrumentList>().instruments.length).toBeLessThanOrEqual(8);
    const tooMany = await get(server, '/instruments?q=a&limit=51');
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json<ApiErrorBody>().error.details).toEqual([
      { field: 'limit', message: 'Limit must be a whole number from 1 to 50.' },
    ]);
  });

  it('rejects an unknown asset class and unknown parameters', async () => {
    const server = start(new FakeProvider());
    const badClass = await get(server, '/instruments?assetClass=bond');
    expect(badClass.json<ApiErrorBody>().error.message).toBe('Asset class must be stock, etf or crypto.');
    const extra = await get(server, '/instruments?sort=name');
    expect([extra.statusCode, extra.json<ApiErrorBody>().error.details[0]?.field]).toEqual([400, 'sort']);
  });
});

describe('GET /instruments/:symbol', () => {
  it('finds an instrument, with crypto pairs encoded in the path', async () => {
    const server = start(new FakeProvider());
    const btc = await get(server, '/instruments/btc%2Fusd');
    expect([btc.statusCode, btc.json<Instrument>().symbol]).toEqual([200, 'BTC/USD']);
    const missing = await get(server, '/instruments/ZZZZ');
    expect([missing.statusCode, missing.json<ApiErrorBody>().error.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('rejects a malformed symbol with the shared message', async () => {
    const server = start(new FakeProvider());
    const bad = await get(server, '/instruments/A$B');
    expect(bad.statusCode).toBe(400);
    expect(bad.json<ApiErrorBody>().error.details[0]?.field).toBe('symbol');
  });
});

describe('GET /instruments/:symbol/history', () => {
  it('returns bars for a range', async () => {
    const provider = new FakeProvider();
    provider.bars.set('BTC/USD', [
      { time: Date.now() - 3_600_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 },
    ]);
    const server = start(provider);
    const history = await get(server, '/instruments/BTC%2FUSD/history?range=1D');
    expect(history.statusCode).toBe(200);
    expect(history.json<HistoryResult>()).toMatchObject({
      symbol: 'BTC/USD',
      range: '1D',
      timeframe: '5Min',
      simulated: false,
    });
    expect(history.json<HistoryResult>().bars).toHaveLength(1);
  });

  it('requires a known range', async () => {
    const server = start(new FakeProvider());
    for (const url of ['/instruments/AAPL/history', '/instruments/AAPL/history?range=2D']) {
      const bad = await get(server, url);
      expect(bad.statusCode).toBe(400);
      expect(bad.json<ApiErrorBody>().error.message).toBe(
        'Range must be one of 1D, 1W, 1M, 3M, 6M, YTD, 1Y, 5Y, 10Y, ALL.',
      );
    }
  });
});

describe('GET /quotes', () => {
  it('accepts a comma-separated list or repeated parameters, crypto included', async () => {
    const provider = new FakeProvider();
    provider.snapshots.set('AAPL', snapshot('AAPL'));
    provider.snapshots.set('BTC/USD', snapshot('BTC/USD'));
    const server = start(provider);
    const listed = await get(server, '/quotes?symbols=AAPL,%20BTC/USD');
    expect(listed.json<QuoteList>().quotes.map((q) => [q.symbol, q.status])).toEqual([
      ['AAPL', 'live'],
      ['BTC/USD', 'live'],
    ]);
    const repeated = await get(server, '/quotes?symbols=AAPL&symbols=ZZZZ');
    expect(repeated.json<QuoteList>().quotes.map((q) => [q.symbol, q.status])).toEqual([
      ['AAPL', 'live'],
      ['ZZZZ', 'unavailable'],
    ]);
  });

  it('rejects a missing, oversized or malformed list', async () => {
    const server = start(new FakeProvider());
    const tooMany = Array.from({ length: MAX_QUOTE_SYMBOLS + 1 }, (_, i) => `S${String(i)}`).join(',');
    const cases: [string, string][] = [
      ['/quotes', 'Symbols must be a comma-separated list.'],
      ['/quotes?symbols=,', 'Enter at least one symbol.'],
      [`/quotes?symbols=${tooMany}`, 'Ask for at most 200 symbols at a time.'],
      ['/quotes?symbols=AAPL,A$B', 'Entry 2 is not a valid symbol.'],
    ];
    for (const [url, message] of cases) {
      const bad = await get(server, url);
      expect([bad.statusCode, bad.json<ApiErrorBody>().error.message]).toEqual([400, message]);
    }
  });
});

describe('GET /market-data/status', () => {
  it('answers 200 and says market data is off when there are no keys', async () => {
    const server = start(null);
    const response = await get(server, '/market-data/status');
    expect(response.statusCode).toBe(200);
    expect(response.json<MarketDataStatus>()).toEqual({
      configured: false,
      feedName: null,
      delayed: false,
      stocks: { state: 'idle', reconnectAttempt: 0, error: null, lastMessageAt: null, streamed: [] },
      crypto: { state: 'idle', reconnectAttempt: 0, error: null, lastMessageAt: null, streamed: [] },
      polled: [],
      lastPollAt: null,
      pollError: null,
    });
  });

  it("reports the live service's connections and feed once configured", async () => {
    const provider = new FakeProvider();
    const server = start(provider);
    await server.ready();
    provider.stream?.status('stocks', 'reconnecting', {
      reconnectAttempt: 2,
      error: 'The connection to Alpaca closed.',
    });
    const status = (await get(server, '/market-data/status')).json<MarketDataStatus>();
    expect(status).toMatchObject({
      configured: true,
      feedName: 'Fake IEX',
      stocks: { state: 'reconnecting', reconnectAttempt: 2, error: 'The connection to Alpaca closed.' },
      crypto: { state: 'idle' },
    });
  });
});

describe('GET /movers', () => {
  it('returns gainers, losers and most active stocks, five of each by default', async () => {
    const provider = new FakeProvider();
    provider.movers = { gainers: ['AAPL'], losers: [], mostActive: ['AAPL'], asOf: 42 };
    provider.snapshots.set('AAPL', snapshot('AAPL'));
    const server = start(provider);
    const movers = await get(server, '/movers');
    expect(movers.statusCode).toBe(200);
    expect(provider.calls.getMovers).toEqual([5]);
    expect(movers.json<MarketMovers>()).toMatchObject({ asOf: 42, simulated: false });
    expect((await get(server, '/movers?limit=0')).statusCode).toBe(400);
  });
});

describe('market data failures', () => {
  it('answers UNAVAILABLE with setup instructions while market data is not configured', async () => {
    const server = start(null);
    const response = await get(server, '/quotes?symbols=AAPL');
    expect(response.statusCode).toBe(503);
    expect(response.json<ApiErrorBody>().error).toEqual({
      code: 'UNAVAILABLE',
      message:
        "Market data isn't set up. Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to .env, then restart the server.",
      details: [],
    });
  });

  it.each([
    [
      'credentials',
      'Alpaca rejected the API keys.',
      'Alpaca rejected the API keys. Check ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env, then restart the server.',
    ],
    [
      'rate_limited',
      "Alpaca's request limit was reached.",
      "Alpaca's request limit was reached. Try again in a minute.",
    ],
    ['unavailable', 'Alpaca could not be reached.', 'Alpaca could not be reached. Try again shortly.'],
  ] as const)(
    'answers PROVIDER_ERROR for a %s failure, with what to do next',
    async (failure, original, message) => {
      const provider = new FakeProvider();
      provider.failWith = new ProviderError(failure, original);
      const server = start(provider);
      const response = await get(server, '/movers');
      expect(response.statusCode).toBe(502);
      expect(response.json<ApiErrorBody>().error).toEqual({ code: 'PROVIDER_ERROR', message, details: [] });
    },
  );

  it('never logs the API keys when Alpaca rejects them', async () => {
    const keyId = 'PKLOGCHECK0000000000';
    const secret = 'secret-that-must-not-reach-the-log';
    const lines: string[] = [];
    const provider = createAlpacaProvider({
      keyId,
      secret,
      feed: 'iex',
      fetchApi: mockFetch([
        {
          path: '/v2/stocks/snapshots',
          status: 401,
          headers: { 'X-Request-ID': 'req-123' },
          body: { code: 40110000, message: 'request is not authorized' },
        },
      ]),
    });
    const server = start(provider, { write: (line) => lines.push(line) });

    const response = await get(server, '/quotes?symbols=AAPL');

    expect(response.statusCode).toBe(502);
    const log = lines.join('\n');
    expect(log).toContain('Market data request failed');
    expect(log).toContain('req-123');
    expect(log).not.toContain(keyId);
    expect(log).not.toContain(secret);
  });
});
