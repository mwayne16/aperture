import type { AlertList, PriceAlert } from '@aperture/shared/alerts';
import type { ApiErrorBody } from '@aperture/shared/errors';
import type { FastifyInstance } from 'fastify';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { openTestDatabase, resetDatabase, testConfig } from '../test/database.js';
import { AlertEntity } from './alertEntity.js';
import { AlertService } from './alertService.js';

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

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  const response = await app.inject({ method, url, payload });
  return { status: response.statusCode, body: response.body === '' ? null : response.json<unknown>() };
}

const VALID = { symbol: 'aapl', condition: 'above', targetPrice: 250.5, tag: 'buy' } as const;

async function create(overrides: object = {}): Promise<PriceAlert> {
  const { status, body } = await call('POST', '/alerts', { ...VALID, ...overrides });
  expect(status).toBe(201);
  return body as PriceAlert;
}

async function update(id: string, payload: object): Promise<PriceAlert> {
  const { status, body } = await call('PATCH', `/alerts/${id}`, payload);
  expect(status).toBe(200);
  return body as PriceAlert;
}

/** Stands in for the alert engine firing, which is what disarms an alert. */
async function disarm(id: string): Promise<void> {
  await dataSource.manager.update(AlertEntity, id, { armed: false });
}

describe('POST /alerts', () => {
  it('creates an armed, enabled alert on the last trade price with a normalized symbol and note', async () => {
    const alert = await create({ symbol: ' btc/usd ', note: '  breakout  ' });
    expect(alert).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      symbol: 'BTC/USD',
      condition: 'above',
      targetPrice: 250.5,
      tag: 'buy',
      field: 'last',
      enabled: true,
      armed: true,
      note: 'breakout',
      createdAt: alert.createdAt,
      updatedAt: alert.createdAt,
      lastTriggeredAt: null,
      lastTriggeredPrice: null,
      triggerCount: 0,
    });
    expect((await call('GET', '/alerts')).body).toEqual({ alerts: [alert] });
  });

  it('stores a blank note as null and honours enabled: false', async () => {
    expect(await create({ note: '   ', enabled: false })).toMatchObject({
      note: null,
      enabled: false,
      armed: true,
    });
  });

  it('round-trips prices exactly', async () => {
    for (const targetPrice of [0.1 + 0.2, 0.000012345, 999_999.99]) {
      const { id } = await create({ targetPrice });
      const [stored] = (await new AlertService(dataSource).list()).filter((alert) => alert.id === id);
      expect(stored?.targetPrice).toBe(targetPrice);
    }
  });

  it('reports every invalid field with the shared messages', async () => {
    const { status, body } = await call('POST', '/alerts', {
      symbol: '???',
      condition: 'near',
      targetPrice: '12',
      tag: 'hold',
      enabled: 'yes',
      note: 'x'.repeat(501),
    });
    expect(status).toBe(400);
    expect((body as ApiErrorBody).error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Use 1-5 letters with an optional class like ".B", or a pair like "BTC/USD".',
      details: [
        {
          field: 'symbol',
          message: 'Use 1-5 letters with an optional class like ".B", or a pair like "BTC/USD".',
        },
        { field: 'condition', message: 'Condition must be "above" or "below".' },
        { field: 'targetPrice', message: 'Enter a target price greater than 0.' },
        { field: 'tag', message: 'Tag must be "buy" or "sell".' },
        { field: 'enabled', message: 'Enabled must be true or false.' },
        { field: 'note', message: 'Use 500 characters or fewer.' },
      ],
    });
  });

  it('requires the four alert fields', async () => {
    const { body } = await call('POST', '/alerts', {});
    expect((body as ApiErrorBody).error.details.map((detail) => detail.field)).toEqual([
      'symbol',
      'condition',
      'targetPrice',
      'tag',
    ]);
  });

  it('refuses fields the server owns', async () => {
    const { status, body } = await call('POST', '/alerts', {
      ...VALID,
      id: 'mine',
      armed: false,
      triggerCount: 9,
    });
    expect(status).toBe(400);
    expect((body as ApiErrorBody).error.details.map((detail) => detail.field)).toEqual([
      'id',
      'armed',
      'triggerCount',
    ]);
  });
});

describe('GET /alerts', () => {
  it('lists alerts oldest first', async () => {
    const first = await create({ symbol: 'AAPL' });
    const second = await create({ symbol: 'MSFT' });
    const { body } = await call('GET', '/alerts');
    expect((body as AlertList).alerts.map((alert) => alert.id)).toEqual([first.id, second.id]);
  });
});

describe('PATCH /alerts/:id', () => {
  it('changes only the fields sent, and null clears the note', async () => {
    const alert = await create({ note: 'keep an eye' });
    const updated = await update(alert.id, { tag: 'sell', note: null });
    expect(updated).toMatchObject({
      tag: 'sell',
      note: null,
      condition: 'above',
      targetPrice: 250.5,
      symbol: 'AAPL',
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(alert.updatedAt));
  });

  it('rejects null for a field that cannot be cleared, and an attempt to change the symbol', async () => {
    const alert = await create();
    for (const [payload, field] of [
      [{ targetPrice: null }, 'targetPrice'],
      [{ enabled: null }, 'enabled'],
      [{ symbol: 'MSFT' }, 'symbol'],
    ] as const) {
      const { status, body } = await call('PATCH', `/alerts/${alert.id}`, payload);
      expect(status).toBe(400);
      expect((body as ApiErrorBody).error.details[0]?.field).toBe(field);
    }
  });

  it('leaves the alert and its updatedAt alone when nothing changes', async () => {
    const alert = await create();
    expect(await update(alert.id, {})).toEqual(alert);
    expect(await update(alert.id, { tag: 'buy', targetPrice: 250.5 })).toEqual(alert);
  });

  it('re-arms a fired alert when its condition or target changes, or it is enabled again', async () => {
    const alert = await create();

    await disarm(alert.id);
    expect(await update(alert.id, { tag: 'sell', note: 'renamed' })).toMatchObject({ armed: false });
    expect(await update(alert.id, { targetPrice: 260 })).toMatchObject({ armed: true });

    await disarm(alert.id);
    expect(await update(alert.id, { condition: 'below' })).toMatchObject({ armed: true });

    await disarm(alert.id);
    expect(await update(alert.id, { enabled: false })).toMatchObject({ armed: false, enabled: false });
    expect(await update(alert.id, { enabled: true })).toMatchObject({ armed: true, enabled: true });
  });

  it('keeps updatedAt strictly increasing when the clock stands still', async () => {
    const frozen = new Date('2026-03-01T00:00:00Z');
    const service = new AlertService(dataSource, () => frozen);
    const alert = await service.create({ ...VALID });
    const first = await service.update(alert.id, { tag: 'sell' });
    const second = await service.update(alert.id, { tag: 'buy' });
    expect([alert.updatedAt, first.updatedAt, second.updatedAt].map(Date.parse)).toEqual([
      frozen.getTime(),
      frozen.getTime() + 1,
      frozen.getTime() + 2,
    ]);
  });
});

describe('alert ids', () => {
  const unknownId = '00000000-0000-4000-8000-000000000000';

  it('answers NOT_FOUND for an unknown alert', async () => {
    const notFound = {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Alert not found.', details: [] } },
    };
    expect(await call('PATCH', `/alerts/${unknownId}`, { tag: 'sell' })).toEqual(notFound);
    expect(await call('DELETE', `/alerts/${unknownId}`)).toEqual(notFound);
  });

  it('rejects an id that is not a UUID before it reaches the database', async () => {
    const { status, body } = await call('DELETE', '/alerts/42');
    expect(status).toBe(400);
    expect((body as ApiErrorBody).error.details).toEqual([
      { field: 'id', message: 'Alert id must be a UUID.' },
    ]);
  });
});

describe('DELETE /alerts/:id', () => {
  it('deletes the alert', async () => {
    const alert = await create();
    expect(await call('DELETE', `/alerts/${alert.id}`)).toEqual({ status: 204, body: null });
    expect((await call('GET', '/alerts')).body).toEqual({ alerts: [] });
  });
});
