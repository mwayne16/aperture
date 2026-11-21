import type { PriceAlert } from '@aperture/shared/alerts';
import type { MarketDataStatus } from '@aperture/shared/marketData';
import { MAX_REALTIME_MESSAGE_BYTES, REALTIME_PATH } from '@aperture/shared/realtime';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import type { DataSource } from 'typeorm';
import type { ClientOptions } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { MarketDataProvider } from '../marketData/provider.js';
import { openTestDatabase, resetDatabase, testConfig } from '../test/database.js';
import { FakeProvider, snapshot } from '../test/fakeProvider.js';
import { RealtimeTestClient } from '../test/realtimeClient.js';
import { MAX_CONNECTIONS } from './realtimeHub.js';

let dataSource: DataSource;
let provider: FakeProvider;
let app: FastifyInstance | null = null;
let url: string;
let clients: RealtimeTestClient[];
let tradeTime: number;

beforeAll(async () => {
  dataSource = await openTestDatabase();
});

afterAll(async () => {
  await dataSource.destroy();
});

beforeEach(async () => {
  await resetDatabase(dataSource);
  provider = new FakeProvider();
  const recent = Date.now() - 60_000;
  for (const symbol of ['AAPL', 'MSFT', 'BTC/USD']) {
    provider.snapshots.set(symbol, snapshot(symbol, { lastTradeAt: recent, quoteAt: recent }));
  }
  clients = [];
  tradeTime = Date.now();
});

afterEach(async () => {
  for (const client of clients) client.close();
  await app?.close();
  app = null;
});

async function start(marketData: MarketDataProvider | null = provider): Promise<FastifyInstance> {
  app = buildApp({ config: testConfig, dataSource, marketData }, { logger: false });
  await app.listen({ host: '127.0.0.1', port: 0 });
  url = `ws://127.0.0.1:${String((app.server.address() as AddressInfo).port)}${REALTIME_PATH}`;
  return app;
}

async function connect(options: ClientOptions = {}): Promise<RealtimeTestClient> {
  const client = await RealtimeTestClient.open(url, options);
  clients.push(client);
  return client;
}

function trade(symbol: string, price: number): void {
  tradeTime += 1_000;
  provider.stream?.handlers.onTrade({ symbol, price, time: tradeTime });
}

async function marketStatus(server: FastifyInstance): Promise<MarketDataStatus> {
  return (await server.inject({ method: 'GET', url: '/market-data/status' })).json<MarketDataStatus>();
}

describe('realtime connection', () => {
  it('sends the market-data status on connect', async () => {
    await start();
    const client = await connect();
    const { status } = await client.next('status');
    expect(status).toMatchObject({ configured: true, feedName: 'Fake IEX' });
  });

  it('answers a subscribe with the latest quotes, and a new symbol once its first snapshot arrives', async () => {
    const server = await start();
    await server.inject({ method: 'POST', url: '/watchlist/symbols', payload: { symbol: 'AAPL' } });
    await vi.waitFor(async () => {
      expect((await marketStatus(server)).polled).toContain('AAPL');
    });
    const client = await connect();

    client.send({ type: 'subscribe', symbols: ['aapl'] });
    const first = await client.next('quotes');
    expect(first.quotes.map((quote) => [quote.symbol, quote.status])).toEqual([['AAPL', 'live']]);

    // BTC/USD isn't watched: subscribing adds it to what the server polls, and its quote follows.
    client.send({ type: 'subscribe', symbols: ['BTC/USD'] });
    const second = await client.next('quotes');
    // The poll that fetches it refreshes AAPL too, so the batch may carry both.
    expect(second.quotes.map((quote) => quote.symbol)).toContain('BTC/USD');
    expect((await marketStatus(server)).polled).toContain('BTC/USD');
  });

  it('coalesces rapid trades into one quote per symbol', async () => {
    await start();
    const client = await connect();
    client.send({ type: 'subscribe', symbols: ['AAPL', 'MSFT'] });
    await vi.waitFor(() => {
      expect(
        client
          .all('quotes')
          .flatMap((m) => m.quotes.map((q) => q.symbol))
          .sort(),
      ).toEqual(['AAPL', 'MSFT']);
    });
    const before = client.all('quotes').length;

    for (const price of [110, 111, 112, 113]) trade('AAPL', price);
    trade('MSFT', 420);
    await vi.waitFor(() => {
      expect(client.all('quotes').length).toBeGreaterThan(before);
    });
    const batch = client.all('quotes')[before];
    expect(batch?.quotes.map((quote) => [quote.symbol, quote.last])).toEqual([
      ['AAPL', 113],
      ['MSFT', 420],
    ]);
  });

  it('stops sending a symbol after unsubscribe, and drops its demand when the app disconnects', async () => {
    const server = await start();
    const client = await connect();
    client.send({ type: 'subscribe', symbols: ['MSFT'] });
    await client.next('quotes');
    client.send({ type: 'unsubscribe', symbols: ['MSFT'] });
    await vi.waitFor(async () => {
      expect((await marketStatus(server)).polled).not.toContain('MSFT');
    });
    const sent = client.all('quotes').length;
    trade('MSFT', 430);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(client.all('quotes')).toHaveLength(sent);

    client.send({ type: 'subscribe', symbols: ['MSFT'] });
    await client.next('quotes');
    client.close();
    await vi.waitFor(async () => {
      expect((await marketStatus(server)).polled).not.toContain('MSFT');
    });
  });

  it('gives the open stock page a place in what the server watches', async () => {
    const server = await start();
    const client = await connect();
    client.send({ type: 'focus', symbol: 'msft' });
    await vi.waitFor(async () => {
      expect((await marketStatus(server)).polled).toEqual(['MSFT']);
    });
    client.send({ type: 'focus', symbol: null });
    await vi.waitFor(async () => {
      expect((await marketStatus(server)).polled).toEqual([]);
    });
  });

  it('recovers after reconnecting: a new connection gets current quotes for what it subscribes to', async () => {
    await start();
    const first = await connect();
    first.send({ type: 'subscribe', symbols: ['AAPL'] });
    await first.next('quotes');
    trade('AAPL', 150);
    first.close();

    const second = await connect();
    second.send({ type: 'subscribe', symbols: ['AAPL'] });
    const { quotes } = await second.next('quotes');
    expect(quotes[0]).toMatchObject({ symbol: 'AAPL', last: 150 });
  });
});

describe('realtime alerts', () => {
  it('sends each trigger and the updated alert to every connection, once', async () => {
    const server = await start();
    const [one, two] = [await connect(), await connect()];
    const created = await server.inject({
      method: 'POST',
      url: '/alerts',
      payload: { symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' },
    });
    const alert = created.json<PriceAlert>();

    await vi.waitFor(
      () => {
        trade('AAPL', 201);
        expect(one.all('alert')).toHaveLength(1);
      },
      { timeout: 5_000, interval: 50 },
    );
    trade('AAPL', 205);
    await two.next('alert');
    await new Promise((resolve) => setTimeout(resolve, 200));

    for (const client of [one, two]) {
      expect(client.all('alert').map((m) => [m.event.alertId, m.event.price])).toEqual([[alert.id, 201]]);
      expect(client.all('alertUpdated').at(-1)?.alert).toMatchObject({
        id: alert.id,
        armed: false,
        triggerCount: 1,
      });
    }
  });
});

describe('realtime validation and limits', () => {
  it('answers a bad message with an error and keeps the connection open', async () => {
    await start();
    const client = await connect();
    const cases: [unknown, string][] = [
      ['not json', 'Messages must be JSON.'],
      [{ type: 'trade', symbol: 'AAPL' }, 'Message type must be subscribe, unsubscribe or focus.'],
      [{ type: 'subscribe', symbols: ['AAPL', 'A$B'] }, 'Entry 2 is not a valid symbol.'],
      [{ type: 'subscribe', symbols: [] }, 'Enter at least one symbol.'],
      [{ type: 'subscribe', symbols: ['AAPL'], all: true }, 'property all should not exist'],
      [{ type: 'focus' }, 'Enter a symbol.'],
    ];
    for (const [message, error] of cases) {
      client.send(message);
      expect((await client.next('error')).message).toBe(error);
    }
    client.send({ type: 'subscribe', symbols: ['AAPL'] });
    expect((await client.next('quotes')).quotes[0]?.symbol).toBe('AAPL');
  });

  it('closes the connection on a message over the size limit', async () => {
    await start();
    const client = await connect();
    client.send('x'.repeat(MAX_REALTIME_MESSAGE_BYTES + 1));
    await vi.waitFor(() => {
      expect(client.closeCode).toBe(1009);
    });
  });

  it('refuses connections from other web pages and accepts the app', async () => {
    await start();
    await expect(connect({ origin: 'https://example.com' })).rejects.toThrow('HTTP 403');
    const app = await connect({ origin: 'http://localhost:5173' });
    const packaged = await connect({ origin: 'file://' });
    await Promise.all([app.next('status'), packaged.next('status')]);
  });

  it('closes connections beyond the limit', async () => {
    await start();
    for (let i = 0; i < MAX_CONNECTIONS; i++) await connect();
    const extra = await connect();
    await vi.waitFor(() => {
      expect(extra.closeCode).toBe(1013);
    });
  });

  it('works without market data, saying so in the status', async () => {
    await start(null);
    const client = await connect();
    expect((await client.next('status')).status).toMatchObject({ configured: false, feedName: null });
    client.send({ type: 'subscribe', symbols: ['AAPL'] });
    client.send({ type: 'focus', symbol: 'AAPL' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.all('quotes')).toEqual([]);
    expect(client.all('error')).toEqual([]);
  });
});
