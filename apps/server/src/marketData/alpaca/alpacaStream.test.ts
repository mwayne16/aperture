import { mockFetch } from '@alpacahq/alpaca-trade-api/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAlpacaStream } from '../../test/fakeAlpacaStream.js';
import type { LiveQuote, LiveTrade, MarketStream, StreamChannel, StreamStatus } from '../provider.js';
import { createAlpacaProvider } from './alpacaProvider.js';

const KEY_ID = 'PKSTREAMTEST00000000';
const SECRET = 'stream-secret-that-must-never-show';
const AT = new Date('2026-11-16T15:30:00.123Z');

let stocks: FakeAlpacaStream;
let crypto: FakeAlpacaStream;
let stream: MarketStream;
let statuses: StreamStatus[];
let trades: LiveTrade[];
let quotes: LiveQuote[];
let confirmed: { channel: StreamChannel; symbols: string[] }[];

function open(maxAttempts = 2): MarketStream {
  const provider = createAlpacaProvider({
    keyId: KEY_ID,
    secret: SECRET,
    feed: 'iex',
    fetchApi: mockFetch([]),
    streamUrls: { stocks: stocks.url, crypto: crypto.url },
    streamReconnect: { maxAttempts, initialMs: 10, maxMs: 20 },
  });
  stream = provider.openStream({
    onTrade: (trade) => trades.push(trade),
    onQuote: (quote) => quotes.push(quote),
    onStatus: (status) => statuses.push(status),
    onSubscribed: (channel, symbols) => confirmed.push({ channel, symbols }),
  });
  return stream;
}

const states = (channel: StreamChannel) => statuses.filter((s) => s.channel === channel).map((s) => s.state);
const lastStatus = (channel: StreamChannel) => statuses.filter((s) => s.channel === channel).at(-1);

beforeEach(async () => {
  [stocks, crypto] = await Promise.all([FakeAlpacaStream.start(), FakeAlpacaStream.start()]);
  statuses = [];
  trades = [];
  quotes = [];
  confirmed = [];
});

afterEach(async () => {
  stream.close();
  await Promise.all([stocks.stop(), crypto.stop()]);
});

describe('Alpaca stream: connecting', () => {
  it('connects a channel on its first symbols, signs in, and confirms what Alpaca acknowledged', async () => {
    open().setSymbols({ stocks: ['AAPL', 'MSFT'], crypto: [] });
    await vi.waitFor(() => {
      expect(confirmed).toContainEqual({ channel: 'stocks', symbols: ['AAPL', 'MSFT'] });
    });
    expect(stocks.received[0]).toEqual({ action: 'auth', key: KEY_ID, secret: SECRET });
    expect(stocks.received[1]).toEqual({
      action: 'subscribe',
      trades: ['AAPL', 'MSFT'],
      quotes: ['AAPL', 'MSFT'],
    });
    expect(states('stocks')).toEqual(['connecting', 'connected']);
    // No crypto symbols, so the crypto connection is never opened.
    expect(crypto.connections).toBe(0);
  });

  it('sends only the difference when the symbols change', async () => {
    open().setSymbols({ stocks: ['AAPL', 'MSFT'], crypto: [] });
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('connected');
    });
    stream.setSymbols({ stocks: ['MSFT', 'NVDA'], crypto: ['BTC/USD'] });
    await vi.waitFor(() => {
      expect(confirmed).toContainEqual({ channel: 'stocks', symbols: ['MSFT', 'NVDA'] });
    });
    expect(stocks.received.slice(2)).toEqual([
      { action: 'unsubscribe', trades: ['AAPL'] },
      { action: 'unsubscribe', quotes: ['AAPL'] },
      { action: 'subscribe', trades: ['NVDA'] },
      { action: 'subscribe', quotes: ['NVDA'] },
    ]);
    await vi.waitFor(() => {
      expect(confirmed).toContainEqual({ channel: 'crypto', symbols: ['BTC/USD'] });
    });
  });

  it('confirms only what Alpaca accepted when it refuses symbols over the limit', async () => {
    stocks.symbolLimit = 2;
    open().setSymbols({ stocks: ['AAPL', 'MSFT'], crypto: [] });
    await vi.waitFor(() => {
      expect(confirmed.at(-1)?.symbols).toEqual(['AAPL', 'MSFT']);
    });
    stream.setSymbols({ stocks: ['AAPL', 'MSFT', 'NVDA'], crypto: [] });
    await vi.waitFor(() => {
      expect(stocks.received).toHaveLength(4);
    });
    expect(confirmed.at(-1)?.symbols).toEqual(['AAPL', 'MSFT']);
    expect(lastStatus('stocks')?.state).toBe('connected');
  });
});

describe('Alpaca stream: ticks', () => {
  it('passes on checked trades and quotes and drops malformed ones', async () => {
    open().setSymbols({ stocks: ['AAPL'], crypto: [] });
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('connected');
    });
    stocks.trade('AAPL', -5, AT);
    stocks.trade('AAPL', 101.25, 'not a time');
    stocks.trade('AAPL', 101.5, AT);
    stocks.quote('AAPL', 0, 101.6, AT);
    await vi.waitFor(() => {
      expect(quotes).toHaveLength(1);
    });
    expect(trades).toEqual([{ symbol: 'AAPL', price: 101.5, time: AT.getTime() }]);
    expect(quotes).toEqual([
      { symbol: 'AAPL', bid: null, bidSize: null, ask: 101.6, askSize: 3, time: AT.getTime() },
    ]);
  });
});

describe('Alpaca stream: failures', () => {
  it('reconnects after a drop and subscribes everything again', async () => {
    open().setSymbols({ stocks: ['AAPL', 'MSFT'], crypto: [] });
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('connected');
    });
    stocks.dropConnections();
    await vi.waitFor(() => {
      expect(stocks.connections).toBe(2);
    });
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('connected');
    });
    expect(states('stocks')).toEqual([
      'connecting',
      'connected',
      'reconnecting',
      'reconnecting',
      'connected',
    ]);
    expect(statuses.find((s) => s.state === 'reconnecting')?.reconnectAttempt).toBe(1);
    expect(stocks.received.filter((m) => m.action === 'subscribe').at(-1)).toEqual({
      action: 'subscribe',
      trades: ['AAPL', 'MSFT'],
      quotes: ['AAPL', 'MSFT'],
    });
  });

  it('stops for good when Alpaca rejects the keys', async () => {
    stocks.authReply = { code: 402, msg: 'auth failed' };
    open().setSymbols({ stocks: ['AAPL'], crypto: [] });
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('disconnected');
    });
    expect(lastStatus('stocks')).toEqual({
      channel: 'stocks',
      state: 'disconnected',
      reconnectAttempt: 0,
      error: 'Alpaca rejected the API keys.',
      retryable: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stocks.connections).toBe(1);
  });

  it('gives up after its attempts when another connection holds the keys, and can be started again', async () => {
    stocks.authReply = { code: 406, msg: 'connection limit exceeded' };
    open(2).setSymbols({ stocks: ['AAPL'], crypto: [] });
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('disconnected');
    });
    expect(stocks.connections).toBe(3);
    expect(lastStatus('stocks')).toMatchObject({ state: 'disconnected', retryable: true });
    expect(lastStatus('stocks')?.error).toBe(
      'Another connection is already using these Alpaca keys; the plan allows one per feed. Stop the other server ' +
        'or app. Stopped retrying after 2 attempts.',
    );

    stocks.authReply = 'ok';
    stream.reconnect();
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('connected');
    });
    await vi.waitFor(() => {
      expect(confirmed.at(-1)?.symbols).toEqual(['AAPL']);
    });
  });

  it('never reports the keys in a status', async () => {
    stocks.authReply = { code: 402, msg: `auth failed for ${KEY_ID}` };
    open().setSymbols({ stocks: ['AAPL'], crypto: [] });
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('disconnected');
    });
    const reported = JSON.stringify(statuses);
    expect(reported).not.toContain(KEY_ID);
    expect(reported).not.toContain(SECRET);
  });

  it('reports a deliberate close without an error and does not reconnect', async () => {
    open().setSymbols({ stocks: ['AAPL'], crypto: [] });
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('connected');
    });
    stream.close();
    await vi.waitFor(() => {
      expect(lastStatus('stocks')?.state).toBe('disconnected');
    });
    expect(lastStatus('stocks')?.error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stocks.connections).toBe(1);
  });
});
