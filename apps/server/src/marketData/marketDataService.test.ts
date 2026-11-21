import { beforeEach, describe, expect, it } from 'vitest';
import { ApiHttpError } from '../http/errors.js';
import { FakeProvider, snapshot } from '../test/fakeProvider.js';
import { LiveMarketData } from './liveMarketData.js';
import { MarketDataService } from './marketDataService.js';
import type { ProviderBar } from './provider.js';

const NOW = Date.parse('2026-11-14T15:00:00Z'); // Saturday
const HOUR = 3_600_000;

let provider: FakeProvider;
let now: number;
let service: MarketDataService;

beforeEach(() => {
  provider = new FakeProvider();
  now = NOW;
  service = new MarketDataService(provider, () => now);
});

async function rejection(promise: Promise<unknown>): Promise<ApiHttpError> {
  const error: unknown = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiHttpError);
  return error as ApiHttpError;
}

const bar = (iso: string, close = 1): ProviderBar => ({
  time: Date.parse(iso),
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
});

describe('without a provider', () => {
  it('rejects every request with UNAVAILABLE and says how to set one up', async () => {
    const off = new MarketDataService(null);
    for (const request of [
      off.listInstruments(),
      off.searchInstruments('a', 5),
      off.getInstrument('AAPL'),
      off.getQuotes(['AAPL']),
      off.getHistory('AAPL', '1M'),
      off.getMovers(5),
    ]) {
      const error = await rejection(request);
      expect(error.code).toBe('UNAVAILABLE');
      expect(error.message).toContain('ALPACA_API_KEY_ID');
    }
  });
});

describe('instruments', () => {
  it('lists them by symbol, filtered by asset class, and loads the list once a day', async () => {
    expect((await service.listInstruments()).map((i) => i.symbol)).toEqual([
      'AAL',
      'AAPL',
      'BTC/USD',
      'MSFT',
      'SPY',
    ]);
    expect((await service.listInstruments('stock', 2)).map((i) => i.symbol)).toEqual(['AAL', 'AAPL']);
    await service.searchInstruments('a', 5);
    await service.getInstrument('aapl');
    expect(provider.calls.listInstruments).toBe(1);
    now += 24 * HOUR;
    await service.listInstruments();
    expect(provider.calls.listInstruments).toBe(2);
  });

  it('searches with the shared ranking, optionally within one asset class', async () => {
    expect((await service.searchInstruments('aa', 5)).map((i) => i.symbol)).toEqual(['AAL', 'AAPL']);
    expect((await service.searchInstruments('s', 5, 'etf')).map((i) => i.symbol)).toEqual(['SPY']);
    expect(await service.searchInstruments('  ', 5)).toEqual([]);
  });

  it('finds one by its normalized symbol, or rejects with NOT_FOUND', async () => {
    expect((await service.getInstrument('btc/usd')).name).toBe('Bitcoin');
    const error = await rejection(service.getInstrument('zzzz'));
    expect([error.code, error.message]).toEqual(['NOT_FOUND', 'No instrument found for ZZZZ.']);
  });

  it('tries the list again after a failed load', async () => {
    provider.failWith = new Error('down');
    await expect(service.listInstruments()).rejects.toThrow('down');
    provider.failWith = null;
    expect(await service.listInstruments()).toHaveLength(5);
  });
});

describe('quotes', () => {
  it('answers in the order asked from one deduplicated request, with change against the previous close', async () => {
    provider.snapshots.set('AAPL', snapshot('AAPL', { last: 102, prevClose: 100 }));
    provider.snapshots.set('BTC/USD', snapshot('BTC/USD', { last: 90, prevClose: 100 }));

    const quotes = await service.getQuotes(['btc/usd', 'AAPL', 'ZZZZ', 'aapl']);

    expect(provider.calls.getSnapshots).toEqual([['BTC/USD', 'AAPL', 'ZZZZ']]);
    expect(quotes.map((q) => [q.symbol, q.status, q.change, q.changePct])).toEqual([
      ['BTC/USD', 'live', -10, -10],
      ['AAPL', 'live', 2, 2],
      ['ZZZZ', 'unavailable', null, null],
      ['AAPL', 'live', 2, 2],
    ]);
    expect(quotes[1]).toMatchObject({ bid: 100.9, ask: 101.1, volume: 5_000, updatedAt: NOW });
  });

  it('marks quotes from a delayed feed, and a snapshot without a last price as unavailable', async () => {
    provider.delayed = true;
    provider.snapshots.set('AAPL', snapshot('AAPL'));
    provider.snapshots.set('MSFT', snapshot('MSFT', { last: null }));
    const quotes = await service.getQuotes(['AAPL', 'MSFT']);
    expect(quotes.map((q) => q.status)).toEqual(['delayed', 'unavailable']);
    expect(quotes[1]).toMatchObject({ change: null, changePct: null, bid: 100.9 });
  });
});

describe('history', () => {
  it('requests the bars the range needs and returns them with times in seconds', async () => {
    provider.bars.set('AAPL', [bar('2026-11-12T05:00:00Z', 225), bar('2026-11-13T05:00:00Z', 228)]);

    const result = await service.getHistory('aapl', '3M');

    expect(provider.calls.getBars).toEqual([
      { symbols: ['AAPL'], timeframe: '1Day', start: new Date('2026-08-14T15:00:00Z'), end: new Date(NOW) },
    ]);
    expect(result).toEqual({
      symbol: 'AAPL',
      range: '3M',
      timeframe: '1Day',
      bars: [
        {
          time: Date.parse('2026-11-12T05:00:00Z') / 1000,
          open: 225,
          high: 225,
          low: 225,
          close: 225,
          volume: 10,
        },
        {
          time: Date.parse('2026-11-13T05:00:00Z') / 1000,
          open: 228,
          high: 228,
          low: 228,
          close: 228,
          volume: 10,
        },
      ],
      truncated: true,
      simulated: false,
    });
  });

  it('keeps only the latest session for the one-day chart', async () => {
    provider.bars.set('AAPL', [
      bar('2026-11-12T20:55:00Z'),
      bar('2026-11-13T14:30:00Z'),
      bar('2026-11-13T20:55:00Z'),
    ]);
    const result = await service.getHistory('AAPL', '1D');
    expect(result.bars.map((b) => b.time * 1000)).toEqual([
      Date.parse('2026-11-13T14:30:00Z'),
      Date.parse('2026-11-13T20:55:00Z'),
    ]);
    expect(result.truncated).toBe(false);
  });

  it('returns an empty chart for a listed symbol without bars', async () => {
    const result = await service.getHistory('MSFT', '1Y');
    expect([result.bars, result.truncated]).toEqual([[], false]);
  });

  it('rejects an unknown symbol before asking for bars', async () => {
    expect((await rejection(service.getHistory('ZZZZ', '1M'))).code).toBe('NOT_FOUND');
    expect(provider.calls.getBars).toHaveLength(0);
  });

  it('caches each symbol and range, briefly for intraday ranges and longer for daily ones', async () => {
    await service.getHistory('AAPL', '1M');
    await service.getHistory('AAPL', '1M');
    await service.getHistory('AAPL', '1Y');
    expect(provider.calls.getBars).toHaveLength(2);
    now += 60_000;
    await service.getHistory('AAPL', '1M');
    await service.getHistory('AAPL', '1Y');
    expect(provider.calls.getBars).toHaveLength(3);
    now += 15 * 60_000;
    await service.getHistory('AAPL', '1Y');
    expect(provider.calls.getBars).toHaveLength(4);
  });
});

describe('movers', () => {
  const TODAY = Date.now() - 60_000;

  /** A catalog with ordinary shares, a warrant, a unit and a crypto pair, all with quotes from today. */
  function market(): void {
    provider.instruments = [
      { symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ', assetClass: 'stock' },
      { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', assetClass: 'stock' },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'ARCA', assetClass: 'etf' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', assetClass: 'stock' },
      { symbol: 'PIIIW', name: 'P3 Health Partners Inc. Warrant', exchange: 'NASDAQ', assetClass: 'stock' },
      {
        symbol: 'BKHAU',
        name: 'Black Hawk Acquisition Corporation Units',
        exchange: 'NASDAQ',
        assetClass: 'stock',
      },
      { symbol: 'PENY', name: 'Penny Corp', exchange: 'NASDAQ', assetClass: 'stock' },
      { symbol: 'OLD', name: 'Old Listing Inc', exchange: 'NYSE', assetClass: 'stock' },
    ];
    const quote = (symbol: string, last: number, prevClose: number, lastTradeAt = TODAY) =>
      provider.snapshots.set(
        symbol,
        snapshot(symbol, { last, prevClose, lastTradeAt, quoteAt: lastTradeAt }),
      );
    quote('AAPL', 110, 100); // +10%
    quote('MSFT', 105, 100); // +5%
    quote('SPY', 98, 100); // -2%
    quote('NVDA', 90, 100); // -10%
    quote('PIIIW', 3, 1);
    quote('BKHAU', 1.5, 3);
    quote('PENY', 0.5, 0.1);
    quote('OLD', 50, 10, Date.parse('2025-12-02T20:59:00Z'));
  }

  it('keeps ordinary shares priced at $1 or more that traded in the latest session', async () => {
    market();
    provider.movers = {
      gainers: ['PIIIW', 'OLD', 'PENY', 'MSFT', 'AAPL', 'UNKNOWN'],
      losers: ['BKHAU', 'SPY', 'NVDA'],
      mostActive: ['NVDA', 'PIIIW', 'AAPL'],
      asOf: 123,
    };
    const movers = await service.getMovers(5);
    // Ordered by the quote's own change, so the list matches the numbers shown.
    expect(movers.gainers.map((q) => [q.symbol, q.changePct])).toEqual([
      ['AAPL', 10],
      ['MSFT', 5],
    ]);
    expect(movers.losers.map((q) => [q.symbol, q.changePct])).toEqual([
      ['NVDA', -10],
      ['SPY', -2],
    ]);
    // Most active keeps the provider's order, which ranks by full-market volume.
    expect(movers.mostActive.map((q) => q.symbol)).toEqual(['NVDA', 'AAPL']);
    expect(movers).toMatchObject({ asOf: 123, simulated: false });
    // Only catalog shares are quoted, in one request.
    expect(provider.calls.getSnapshots).toEqual([['OLD', 'PENY', 'MSFT', 'AAPL', 'SPY', 'NVDA']]);
  });

  it('drops a gainer whose quote fell, and a loser whose quote rose', async () => {
    market();
    provider.movers = { gainers: ['SPY', 'AAPL'], losers: ['MSFT', 'NVDA'], mostActive: [], asOf: 1 };
    const movers = await service.getMovers(5);
    expect(movers.gainers.map((q) => q.symbol)).toEqual(['AAPL']);
    expect(movers.losers.map((q) => q.symbol)).toEqual(['NVDA']);
  });

  it('asks for 50 candidates once a minute and cuts the lists to each requested limit', async () => {
    market();
    provider.movers = { gainers: ['MSFT', 'AAPL'], losers: [], mostActive: ['NVDA', 'AAPL'], asOf: 1 };
    const five = await service.getMovers(5);
    const one = await service.getMovers(1);
    expect([five.gainers.length, one.gainers.length, one.mostActive.length]).toEqual([2, 1, 1]);
    expect(provider.calls.getMovers).toEqual([50]);
    now += 60_000;
    await service.getMovers(5);
    expect(provider.calls.getMovers).toEqual([50, 50]);
  });
});

describe('quotes with live prices', () => {
  it('uses current live values and asks the provider only for the rest', async () => {
    provider.snapshots.set('AAPL', snapshot('AAPL', { last: 105 }));
    provider.snapshots.set('MSFT', snapshot('MSFT', { last: 410 }));
    const live = new LiveMarketData(provider, {
      demand: () => Promise.resolve({ focus: [], alerts: [], watchlist: ['AAPL'], viewed: [] }),
      log: { info: () => undefined, warn: () => undefined } as never,
      now: () => now,
    });
    await live.start();
    const withLive = new MarketDataService(provider, () => now, live);
    provider.calls.getSnapshots.length = 0;

    const quotes = await withLive.getQuotes(['AAPL', 'MSFT']);

    expect(provider.calls.getSnapshots).toEqual([['MSFT']]);
    expect(quotes.map((q) => [q.symbol, q.last])).toEqual([
      ['AAPL', 105],
      ['MSFT', 410],
    ]);
    live.stop();
  });
});

describe('history that starts after the range', () => {
  it("flags ALL and 10Y charts as cut short where the provider's history begins, per asset class", async () => {
    provider.limits.historyStartMs = { stocks: Date.UTC(2020, 6, 27), crypto: Date.UTC(2021, 0, 1) };
    provider.bars.set('AAPL', [bar('2020-08-01T04:00:00Z'), bar('2026-11-01T04:00:00Z')]);
    provider.bars.set('BTC/USD', [bar('2021-01-01T00:00:00Z'), bar('2026-11-01T00:00:00Z')]);
    expect((await service.getHistory('AAPL', 'ALL')).truncated).toBe(true);
    expect((await service.getHistory('AAPL', '10Y')).truncated).toBe(true);
    expect((await service.getHistory('AAPL', '5Y')).truncated).toBe(false);
    expect((await service.getHistory('BTC/USD', 'ALL')).truncated).toBe(true);
  });
});
