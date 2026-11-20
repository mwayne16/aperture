import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeProvider, snapshot, type FakeStream } from '../test/fakeProvider.js';
import { LiveMarketData, POLL_INTERVAL_MS, RECOVERY_DELAY_MS } from './liveMarketData.js';
import { ProviderError } from './provider.js';
import type { Demand } from './streamPlan.js';

const START = Date.parse('2026-11-16T15:00:00Z');

let provider: FakeProvider;
let demand: Demand;
let demandLoads: number;
let warnings: string[];
let live: LiveMarketData;

function stream(): FakeStream {
  if (provider.stream === null) throw new Error('The stream was not opened.');
  return provider.stream;
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  provider = new FakeProvider();
  for (const symbol of ['AAPL', 'MSFT', 'SPY', 'NVDA', 'BTC/USD']) {
    provider.snapshots.set(symbol, snapshot(symbol, { lastTradeAt: START - 1_000, quoteAt: START - 1_000 }));
  }
  provider.limits.streamSymbolsPerConnection = { stocks: 2, crypto: 30 };
  demand = { focus: [], alerts: ['NVDA'], watchlist: ['AAPL', 'MSFT', 'BTC/USD'], viewed: [] };
  demandLoads = 0;
  warnings = [];
  live = new LiveMarketData(provider, {
    demand: () => {
      demandLoads += 1;
      return Promise.resolve(demand);
    },
    log: {
      info: () => undefined,
      warn: (...args: unknown[]) => {
        warnings.push(String(args.at(-1)));
      },
    } as never,
  });
});

afterEach(() => {
  live.stop();
  vi.useRealTimers();
});

describe('starting', () => {
  it('subscribes what fits each stream, tracks the rest for polling and fetches every baseline at once', async () => {
    await live.start();
    expect(stream().subscriptions).toEqual([{ stocks: ['AAPL', 'MSFT'], crypto: ['BTC/USD'] }]);
    expect(provider.calls.getSnapshots).toEqual([['AAPL', 'MSFT', 'BTC/USD', 'NVDA']]);
    expect(live.status()).toMatchObject({
      configured: true,
      feedName: 'Fake IEX',
      polled: ['AAPL', 'MSFT', 'BTC/USD', 'NVDA'],
      stocks: { state: 'idle', streamed: [] },
      lastPollAt: START,
    });
  });

  it('never rejects when demand cannot be loaded, and keeps going', async () => {
    const failing = new LiveMarketData(provider, {
      demand: () => Promise.reject(new Error('database down')),
      log: {
        info: () => undefined,
        warn: (...args: unknown[]) => warnings.push(String(args.at(-1))),
      } as never,
    });
    await expect(failing.start()).resolves.toBeUndefined();
    expect(warnings).toEqual(['Could not load the symbols that need prices; keeping the current ones']);
    expect(failing.status().polled).toEqual([]);
    failing.stop();
  });
});

describe('quotes', () => {
  it('serves a polled symbol for two rounds after its last snapshot, then leaves it to the REST path', async () => {
    await live.start();
    expect(live.quote('NVDA')).toMatchObject({ symbol: 'NVDA', last: 101, status: 'live' });
    provider.failWith = new ProviderError('unavailable', 'Alpaca could not be reached.');
    await vi.advanceTimersByTimeAsync(2 * POLL_INTERVAL_MS);
    expect(live.quote('NVDA')).toBeNull();
    expect(live.status().pollError).toBe('Alpaca could not be reached.');
  });

  it('serves a streamed symbol only once its connection confirmed it, with live ticks on top of the baseline', async () => {
    await live.start();
    stream().connect('stocks');
    stream().handlers.onTrade({ symbol: 'AAPL', price: 110, time: START + 5 });
    stream().handlers.onQuote({
      symbol: 'AAPL',
      bid: 109.9,
      bidSize: 1,
      ask: 110.1,
      askSize: 2,
      time: START + 6,
    });
    await vi.advanceTimersByTimeAsync(10 * POLL_INTERVAL_MS);
    expect(live.quote('AAPL')).toMatchObject({
      last: 110,
      bid: 109.9,
      ask: 110.1,
      prevClose: 100,
      change: 10,
    });
    expect(live.status().stocks).toMatchObject({
      state: 'connected',
      streamed: ['AAPL', 'MSFT'],
      lastMessageAt: START + 0,
    });
  });

  it('returns nothing for a symbol it does not track or has no baseline for', async () => {
    provider.snapshots.delete('NVDA');
    await live.start();
    expect(live.quote('NVDA')).toBeNull();
    expect(live.quote('TSLA')).toBeNull();
  });

  it('marks quotes from a delayed feed', async () => {
    provider.delayed = true;
    await live.start();
    expect(live.quote('NVDA')?.status).toBe('delayed');
  });
});

describe('polling', () => {
  it('polls unstreamed symbols every round and streamed ones once a minute, one request per round', async () => {
    await live.start();
    stream().connect('stocks');
    stream().connect('crypto');
    provider.calls.getSnapshots.length = 0;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(provider.calls.getSnapshots).toEqual([['NVDA']]);
    await vi.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);
    expect(provider.calls.getSnapshots).toEqual([
      ['NVDA'],
      ['NVDA'],
      ['NVDA'],
      ['AAPL', 'MSFT', 'BTC/USD', 'NVDA'],
    ]);
  });

  it('polls the symbols of a dropped connection right away and until it is back', async () => {
    await live.start();
    stream().connect('stocks');
    provider.calls.getSnapshots.length = 0;
    stream().status('stocks', 'reconnecting', { reconnectAttempt: 1, error: 'The connection closed.' });
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.calls.getSnapshots).toEqual([['AAPL', 'MSFT', 'BTC/USD', 'NVDA']]);
    expect(live.status()).toMatchObject({
      stocks: { state: 'reconnecting', reconnectAttempt: 1, error: 'The connection closed.', streamed: [] },
      polled: ['AAPL', 'MSFT', 'BTC/USD', 'NVDA'],
    });
    stream().connect('stocks');
    expect(live.status().polled).toEqual(['BTC/USD', 'NVDA']);
  });

  it('keeps polling symbols the provider did not confirm on a stream', async () => {
    await live.start();
    stream().status('stocks', 'connected');
    stream().handlers.onSubscribed('stocks', ['AAPL']);
    expect(live.status().polled).toEqual(['MSFT', 'BTC/USD', 'NVDA']);
  });
});

describe('recovering a connection', () => {
  it('tries again after a while when a connection stopped retrying', async () => {
    await live.start();
    stream().status('stocks', 'disconnected', { error: 'Gave up after 10 attempts.' });
    await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS - 1);
    expect(stream().reconnects).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(stream().reconnects).toBe(1);
  });

  it('does not retry rejected keys, a deliberate close, or after a reconnect', async () => {
    await live.start();
    stream().status('stocks', 'disconnected', { error: 'Alpaca rejected the API keys.', retryable: false });
    stream().status('crypto', 'disconnected');
    stream().status('crypto', 'disconnected', { error: 'Gave up.' });
    stream().connect('crypto');
    await vi.advanceTimersByTimeAsync(2 * RECOVERY_DELAY_MS);
    expect(stream().reconnects).toBe(0);
  });
});

describe('refreshing demand', () => {
  it('folds a burst of refreshes into at most one more run and follows the new demand', async () => {
    await live.start();
    demand = { focus: [], alerts: [], watchlist: ['SPY'], viewed: [] };
    await Promise.all([live.refresh(), live.refresh(), live.refresh()]);
    expect(demandLoads).toBe(3);
    expect(stream().subscriptions.at(-1)).toEqual({ stocks: ['SPY'], crypto: [] });
    expect(live.status().polled).toEqual(['SPY']);
    expect(live.quote('AAPL')).toBeNull();
  });
});

describe('stopping', () => {
  it('closes the stream and leaves no timers behind', async () => {
    await live.start();
    stream().status('stocks', 'disconnected', { error: 'Gave up.' });
    live.stop();
    stream().status('crypto', 'disconnected', { error: 'Closed.' });
    expect(stream().closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('logging', () => {
  it('warns once about a lasting poll failure, not every round', async () => {
    provider.failWith = new ProviderError('credentials', 'Alpaca rejected the API keys.');
    await live.start();
    await vi.advanceTimersByTimeAsync(5 * POLL_INTERVAL_MS);
    expect(warnings.filter((w) => w === 'Polling market data failed')).toHaveLength(1);
  });
});

describe('refusals on a working connection', () => {
  it('warns once and shows the reason while the connection stays up', async () => {
    await live.start();
    stream().connect('stocks');
    const refusal = 'Alpaca refused more symbols than the plan allows on one connection.';
    stream().status('stocks', 'connected', { error: refusal });
    stream().status('stocks', 'connected', { error: refusal });
    expect(warnings.filter((w) => w === 'Market data stream refused a request')).toHaveLength(1);
    expect(live.status().stocks).toMatchObject({ state: 'connected', error: refusal });
  });
});

describe('price updates', () => {
  it('publishes the first known price of a polled symbol and every newer trade, but no repeats', async () => {
    const prices: string[] = [];
    live.onPrice(({ symbol, price }) => prices.push(`${symbol} ${String(price)}`));
    await live.start();
    expect(prices.sort()).toEqual(['AAPL 101', 'BTC/USD 101', 'MSFT 101', 'NVDA 101']);

    prices.length = 0;
    stream().connect('stocks');
    stream().handlers.onTrade({ symbol: 'AAPL', price: 110, time: START + 5 });
    stream().handlers.onTrade({ symbol: 'AAPL', price: 90, time: START + 4 });
    // The same snapshot polled again brings no newer trade.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    provider.snapshots.set('NVDA', snapshot('NVDA', { last: 120, lastTradeAt: START + 60_000 }));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(prices).toEqual(['AAPL 110', 'NVDA 120']);
  });

  it('keeps publishing when a listener throws', async () => {
    const seen: string[] = [];
    live.onPrice(() => {
      throw new Error('broken listener');
    });
    live.onPrice(({ symbol }) => seen.push(symbol));
    await live.start();
    expect(seen).toHaveLength(4);
    expect(warnings).toContain('A price listener failed');
  });
});

describe('changes, status and the latest quote', () => {
  it('reports a symbol whenever a trade, a quote or a snapshot changes it', async () => {
    const changed: string[] = [];
    live.onChange((symbol) => changed.push(symbol));
    await live.start();
    expect(changed.sort()).toEqual(['AAPL', 'BTC/USD', 'MSFT', 'NVDA']);

    changed.length = 0;
    stream().handlers.onTrade({ symbol: 'AAPL', price: 110, time: START + 5 });
    stream().handlers.onTrade({ symbol: 'AAPL', price: 90, time: START + 4 });
    stream().handlers.onQuote({ symbol: 'MSFT', bid: 1, bidSize: 1, ask: 2, askSize: 1, time: START + 5 });
    stream().handlers.onTrade({ symbol: 'TSLA', price: 300, time: START + 6 });
    expect(changed).toEqual(['AAPL', 'MSFT']);
  });

  it('reports the status when a connection changes, symbols are confirmed and a poll finishes', async () => {
    const statuses: string[] = [];
    live.onStatus((status) =>
      statuses.push(`${status.stocks.state}:${String(status.stocks.streamed.length)}`),
    );
    await live.start();
    statuses.length = 0;
    stream().status('stocks', 'connected');
    stream().handlers.onSubscribed('stocks', ['AAPL', 'MSFT']);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(statuses).toEqual(['connected:0', 'connected:2', 'connected:2']);
  });

  it('marks the latest quote stale once polling falls behind, and has none before the first snapshot', async () => {
    provider.snapshots.delete('NVDA');
    await live.start();
    expect(live.latest('NVDA')).toBeNull();
    expect(live.latest('AAPL')?.status).toBe('live');
    provider.failWith = new ProviderError('unavailable', 'Alpaca could not be reached.');
    await vi.advanceTimersByTimeAsync(2 * POLL_INTERVAL_MS);
    expect(live.latest('AAPL')).toMatchObject({ status: 'stale', last: 101 });
    expect(live.quote('AAPL')).toBeNull();
  });
});
