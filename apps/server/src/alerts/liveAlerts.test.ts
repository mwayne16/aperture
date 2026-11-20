import type { AlertEventList, AlertList, PriceAlert } from '@aperture/shared/alerts';
import type { ApiErrorBody } from '@aperture/shared/errors';
import type { FastifyInstance } from 'fastify';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { openTestDatabase, resetDatabase, testConfig } from '../test/database.js';
import { FakeProvider, snapshot } from '../test/fakeProvider.js';

let dataSource: DataSource;
let provider: FakeProvider;
let app: FastifyInstance;
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
  provider.snapshots.set('AAPL', snapshot('AAPL', { last: 150, lastTradeAt: Date.now() - 60_000 }));
  app = buildApp({ config: testConfig, dataSource, marketData: provider }, { logger: false });
  await app.ready();
  tradeTime = Date.now();
});

afterEach(async () => {
  await app.close();
});

/** Pushes a trade through the fake stream, each one newer than the last. */
function trade(price: number): void {
  tradeTime += 1_000;
  provider.stream?.handlers.onTrade({ symbol: 'AAPL', price, time: tradeTime });
}

const events = async () =>
  (await app.inject({ method: 'GET', url: '/alerts/events' })).json<AlertEventList>().events;
const stored = async () => (await app.inject({ method: 'GET', url: '/alerts' })).json<AlertList>().alerts;

describe('alerts on live prices', () => {
  it('fires an alert created over the API on the first trade that crosses it, once', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/alerts',
      payload: { symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' },
    });
    const alert = created.json<PriceAlert>();

    // ** The alert reaches the monitor and the live service in the background, so trade until it fires.
    await vi.waitFor(
      async () => {
        trade(201);
        expect(await events()).toHaveLength(1);
      },
      { timeout: 5_000, interval: 50 },
    );
    trade(205);
    trade(210);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const history = await events();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ alertId: alert.id, symbol: 'AAPL', price: 201, tag: 'buy' });
    expect((await stored())[0]).toMatchObject({ armed: false, triggerCount: 1, lastTriggeredPrice: 201 });
  });

  it('stops evaluating an alert once it is deleted, and keeps its history', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/alerts',
      payload: { symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' },
    });
    const { id } = created.json<PriceAlert>();
    // First prove the alert is live: it fires, then re-arms when the price drops back.
    await vi.waitFor(
      async () => {
        trade(201);
        expect(await events()).toHaveLength(1);
      },
      { timeout: 5_000, interval: 50 },
    );
    await vi.waitFor(async () => {
      trade(190);
      expect((await stored())[0]?.armed).toBe(true);
    });

    await app.inject({ method: 'DELETE', url: `/alerts/${id}` });
    await new Promise((resolve) => setTimeout(resolve, 200));
    trade(250);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const history = await events();
    expect(history.map((event) => [event.alertId, event.price])).toEqual([[id, 201]]);
  });

  it('validates the history limit', async () => {
    const response = await app.inject({ method: 'GET', url: '/alerts/events?limit=201' });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>().error.message).toBe('Limit must be a whole number from 1 to 200.');
  });
});
