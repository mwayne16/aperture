import { mockFetch, type MockRequest, type MockRoute } from '@alpacahq/alpaca-trade-api/testing';
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../provider.js';
import {
  ASSETS_CRYPTO,
  ASSETS_US_EQUITY,
  CRYPTO_BARS,
  CRYPTO_SNAPSHOTS,
  MOST_ACTIVES,
  MOVERS,
  STOCK_BARS_PAGE_1,
  STOCK_BARS_PAGE_2,
  STOCK_SNAPSHOTS,
} from './alpacaFixtures.js';
import { createAlpacaProvider, type AlpacaFeed } from './alpacaProvider.js';

const KEY_ID = 'PKTESTKEYID0000000000';
const SECRET = 'test-secret-that-must-never-be-logged';
const NOW = Date.parse('2026-11-14T15:00:00Z');

/** An adapter on canned routes that records every request it makes. */
function setup(routes: MockRoute[], feed: AlpacaFeed = 'iex') {
  const requests: MockRequest[] = [];
  const recorded = routes.map((route) => ({
    ...route,
    respond: (request: MockRequest) => {
      requests.push(request);
      if (route.respond) return route.respond(request);
      return new Response(JSON.stringify(route.body ?? {}), {
        status: route.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...route.headers },
      });
    },
  }));
  const provider = createAlpacaProvider({
    keyId: KEY_ID,
    secret: SECRET,
    feed,
    fetchApi: mockFetch(recorded),
    now: () => NOW,
  });
  return { provider, requests };
}

const params = (request: MockRequest | undefined) => Object.fromEntries(request?.url.searchParams ?? []);

describe('Alpaca adapter: instruments', () => {
  it('lists active stocks and crypto from the paper host, recognizing funds by name', async () => {
    const { provider, requests } = setup([
      {
        path: '/v2/assets',
        respond: ({ url }) =>
          new Response(
            JSON.stringify(
              url.searchParams.get('asset_class') === 'crypto' ? ASSETS_CRYPTO : ASSETS_US_EQUITY,
            ),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      },
    ]);

    const instruments = await provider.listInstruments();

    expect(instruments).toEqual([
      { symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ', assetClass: 'stock' },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'ARCA', assetClass: 'etf' },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust, Series 1', exchange: 'NASDAQ', assetClass: 'etf' },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc. Class B', exchange: 'NYSE', assetClass: 'stock' },
      { symbol: 'BTC/USD', name: 'Bitcoin  / US Dollar', exchange: 'CRYPTO', assetClass: 'crypto' },
    ]);
    expect(requests.map((r) => r.url.host)).toEqual(['paper-api.alpaca.markets', 'paper-api.alpaca.markets']);
    expect(requests.map(params)).toEqual([
      { status: 'active', asset_class: 'us_equity' },
      { status: 'active', asset_class: 'crypto' },
    ]);
  });
});

describe('Alpaca adapter: snapshots', () => {
  it('fetches all stocks in one request on the configured feed and all crypto in another', async () => {
    const { provider, requests } = setup([
      { path: '/v2/stocks/snapshots', body: STOCK_SNAPSHOTS },
      { path: '/v1beta3/crypto/us/snapshots', body: CRYPTO_SNAPSHOTS },
    ]);

    const snapshots = await provider.getSnapshots(['AAPL', 'BTC/USD', 'MSFT', 'ZZZZ']);

    expect(requests).toHaveLength(2);
    expect(params(requests.find((r) => r.url.pathname === '/v2/stocks/snapshots'))).toEqual({
      symbols: 'AAPL,MSFT,ZZZZ',
      feed: 'iex',
    });
    expect(params(requests.find((r) => r.url.pathname.includes('crypto')))).toEqual({ symbols: 'BTC/USD' });
    // Unknown symbols are left out; the order follows the request.
    expect(snapshots.map((s) => s.symbol)).toEqual(['AAPL', 'BTC/USD', 'MSFT']);
    expect(snapshots[0]).toEqual({
      symbol: 'AAPL',
      last: 228.5,
      lastTradeAt: Date.parse('2026-11-13T20:59:58.123Z'),
      bid: 228.45,
      bidSize: 3,
      ask: 228.55,
      askSize: 2,
      quoteAt: Date.parse('2026-11-13T20:59:59.5Z'),
      open: 225.1,
      high: 229.2,
      low: 224.8,
      prevClose: 225,
      volume: 1_850_000,
    });
    expect(snapshots[1]).toMatchObject({
      symbol: 'BTC/USD',
      last: 91_250.5,
      bid: 91_240,
      bidSize: 0.4,
      volume: 812.5,
    });
  });

  it('turns malformed values, and a zero bid or ask, into null instead of passing them on', async () => {
    const { provider } = setup([{ path: '/v2/stocks/snapshots', body: STOCK_SNAPSHOTS }]);
    const [msft] = await provider.getSnapshots(['MSFT']);
    expect(msft).toEqual({
      symbol: 'MSFT',
      last: null,
      lastTradeAt: null,
      bid: null,
      bidSize: null,
      ask: null,
      askSize: null,
      quoteAt: Date.parse('2026-11-13T20:59:59Z'),
      open: null,
      high: 510,
      low: 500,
      prevClose: null,
      volume: null,
    });
  });

  it('makes no request for a kind of symbol nobody asked for', async () => {
    const { provider, requests } = setup([{ path: '/v1beta3/crypto/us/snapshots', body: CRYPTO_SNAPSHOTS }]);
    await provider.getSnapshots(['BTC/USD']);
    expect(requests.map((r) => r.url.pathname)).toEqual(['/v1beta3/crypto/us/snapshots']);
  });
});

describe('Alpaca adapter: bars', () => {
  it('follows pages, maps the timeframe, drops malformed bars and returns them oldest first', async () => {
    const { provider, requests } = setup([
      {
        path: '/v2/stocks/bars',
        respond: ({ url }) =>
          new Response(
            JSON.stringify(url.searchParams.has('page_token') ? STOCK_BARS_PAGE_2 : STOCK_BARS_PAGE_1),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      },
    ]);
    const start = new Date('2026-11-01T00:00:00Z');

    const bars = await provider.getBars({ symbols: ['AAPL'], timeframe: '1Day', start, end: new Date(NOW) });

    expect(requests).toHaveLength(2);
    expect(params(requests[0])).toMatchObject({
      symbols: 'AAPL',
      timeframe: '1Day',
      start: start.toISOString(),
      end: new Date(NOW).toISOString(),
      adjustment: 'split',
      feed: 'iex',
    });
    expect(bars.get('AAPL')?.map((b) => [b.time, b.close])).toEqual([
      [Date.parse('2026-11-11T05:00:00Z'), 223],
      [Date.parse('2026-11-12T05:00:00Z'), 225],
      [Date.parse('2026-11-13T05:00:00Z'), 228.5],
    ]);
  });

  it.each([
    ['5Min', '5Min'],
    ['30Min', '30Min'],
    ['1Hour', '1Hour'],
    ['1Week', '1Week'],
    ['1Month', '1Month'],
  ] as const)('requests %s bars as timeframe %s', async (timeframe, wire) => {
    const { provider, requests } = setup([
      { path: '/v2/stocks/bars', body: { bars: {}, next_page_token: null } },
    ]);
    await provider.getBars({
      symbols: ['AAPL'],
      timeframe,
      start: new Date(NOW - 86_400_000),
      end: new Date(NOW),
    });
    expect(params(requests[0]).timeframe).toBe(wire);
  });

  it('starts "earliest available" where each history begins and leaves out symbols without bars', async () => {
    const { provider, requests } = setup([
      { path: '/v2/stocks/bars', body: { bars: {}, next_page_token: null } },
      { path: '/v1beta3/crypto/us/bars', body: CRYPTO_BARS },
    ]);
    const bars = await provider.getBars({
      symbols: ['AAPL', 'BTC/USD'],
      timeframe: '1Month',
      start: null,
      end: new Date(NOW),
    });
    // IEX stock history begins 2020-07-27 and crypto history 2021-01-01.
    const starts = Object.fromEntries(requests.map((r) => [r.url.pathname, params(r).start]));
    expect(starts).toEqual({
      '/v2/stocks/bars': '2020-07-27T00:00:00.000Z',
      '/v1beta3/crypto/us/bars': '2021-01-01T00:00:00.000Z',
    });
    expect([...bars.keys()]).toEqual(['BTC/USD']);
    expect(provider.limits.historyStartMs).toEqual({
      stocks: Date.UTC(2020, 6, 27),
      crypto: Date.UTC(2021, 0, 1),
    });
  });

  it('starts SIP history in 2016', async () => {
    const { provider, requests } = setup(
      [{ path: '/v2/stocks/bars', body: { bars: {}, next_page_token: null } }],
      'sip',
    );
    await provider.getBars({ symbols: ['AAPL'], timeframe: '1Month', start: null, end: new Date(NOW) });
    expect(params(requests[0]).start).toBe('2016-01-01T00:00:00.000Z');
  });

  it('reads delayed history from SIP and ends it 15 minutes ago, which the free plan allows', async () => {
    const { provider, requests } = setup(
      [{ path: '/v2/stocks/bars', body: { bars: {}, next_page_token: null } }],
      'delayed_sip',
    );
    expect(provider.delayed).toBe(true);
    expect(provider.feedLabel).toBe('Alpaca SIP (15-minute delay)');
    await provider.getBars({
      symbols: ['AAPL'],
      timeframe: '1Day',
      start: new Date(NOW - 86_400_000),
      end: new Date(NOW),
    });
    expect(params(requests[0])).toMatchObject({
      feed: 'sip',
      end: new Date(NOW - 15 * 60_000).toISOString(),
    });
  });
});

describe('Alpaca adapter: movers', () => {
  it('ranks by the screener and keeps only valid symbols', async () => {
    const { provider, requests } = setup([
      { path: '/v1beta1/screener/stocks/movers', body: MOVERS },
      { path: '/v1beta1/screener/stocks/most-actives', body: MOST_ACTIVES },
    ]);
    const movers = await provider.getMovers(5);
    expect(movers).toEqual({
      gainers: ['NVDA'],
      losers: ['TSLA'],
      mostActive: ['AAPL', 'NVDA'],
      asOf: Date.parse('2026-11-13T20:59:00.123Z'),
    });
    expect(requests.map(params)).toEqual(expect.arrayContaining([{ top: '5' }, { by: 'volume', top: '5' }]));
  });
});

describe('Alpaca adapter: failures', () => {
  async function failure(status: number, body: unknown): Promise<ProviderError> {
    const { provider } = setup([{ path: '/v2/stocks/snapshots', status, body }]);
    const error: unknown = await provider.getSnapshots(['AAPL']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }

  it.each([
    [
      401,
      { code: 40110000, message: 'request is not authorized' },
      'credentials',
      'Alpaca rejected the API keys.',
    ],
    [
      403,
      { code: 40310000, message: 'subscription does not permit querying recent SIP data' },
      'entitlement',
      "The Alpaca plan doesn't include this data. The free plan covers the IEX feed (ALPACA_DATA_FEED=iex).",
    ],
    [
      422,
      { code: 42210000, message: 'invalid feed' },
      'rejected',
      'Alpaca refused the request: invalid feed.',
    ],
  ] as const)('maps HTTP %i to a %s failure', async (status, body, kind, message) => {
    const error = await failure(status, body);
    expect(error.failure).toBe(kind);
    expect(error.message).toBe(message);
  });

  it('retries a rate limit and a server error before giving up', { timeout: 15_000 }, async () => {
    expect((await failure(429, { message: 'too many requests' })).failure).toBe('rate_limited');
    expect((await failure(503, { message: 'down' })).failure).toBe('unavailable');
  });

  it('reports a network failure as unavailable', async () => {
    const provider = createAlpacaProvider({
      keyId: KEY_ID,
      secret: SECRET,
      feed: 'iex',
      fetchApi: () => Promise.reject(new TypeError('fetch failed')),
    });
    const error = (await provider.getSnapshots(['AAPL']).catch((e: unknown) => e)) as ProviderError;
    expect(error.failure).toBe('unavailable');
    expect(error.message).toBe('Alpaca could not be reached.');
  }, 15_000);

  it('sends the keys only as headers and never puts them in an error', async () => {
    const { provider, requests } = setup([
      { path: '/v2/stocks/snapshots', status: 401, body: { message: 'unauthorized' } },
    ]);
    const error = await provider.getSnapshots(['AAPL']).catch((e: unknown) => e);
    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get('APCA-API-KEY-ID')).toBe(KEY_ID);
    expect(requests[0]?.url.href).not.toContain(KEY_ID);
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
    expect(serialized).not.toContain(KEY_ID);
    expect(serialized).not.toContain(SECRET);
  });
});
