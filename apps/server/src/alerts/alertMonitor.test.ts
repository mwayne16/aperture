import type { AlertEvent, PriceAlert } from '@aperture/shared/alerts';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, resetDatabase } from '../test/database.js';
import { AlertMonitor, MAX_STORED_EVENTS } from './alertMonitor.js';
import { AlertService } from './alertService.js';

let dataSource: DataSource;
let alerts: AlertService;
let clock: number;
let triggered: AlertEvent[];
let updated: PriceAlert[];
let warnings: string[];

const now = () => new Date(clock);
const log = {
  info: () => undefined,
  warn: (...args: unknown[]) => {
    warnings.push(String(args.at(-1)));
  },
} as never;

function monitor(source: DataSource = dataSource): AlertMonitor {
  const watcher = new AlertMonitor(source, log, now);
  watcher.onTriggered((event) => triggered.push(event));
  watcher.onUpdated((alert) => updated.push(alert));
  return watcher;
}

/** Evaluates each price in turn, waiting for any save it starts. */
async function prices(target: AlertMonitor, symbol: string, ...values: number[]): Promise<void> {
  for (const value of values) {
    clock += 1_000;
    target.evaluate(symbol, value);
    await target.settled();
  }
}

const stored = async (id: string) => (await alerts.list()).find((alert) => alert.id === id);

beforeAll(async () => {
  dataSource = await openTestDatabase();
});

afterAll(async () => {
  await dataSource.destroy();
});

beforeEach(async () => {
  await resetDatabase(dataSource);
  clock = Date.parse('2026-11-16T15:00:00Z');
  alerts = new AlertService(dataSource, now);
  triggered = [];
  updated = [];
  warnings = [];
});

describe('AlertMonitor', () => {
  it('fires once when the price enters the condition, saving the trigger, and stays quiet while it holds', async () => {
    const alert = await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const watcher = monitor();
    await watcher.reload();

    await prices(watcher, 'AAPL', 199, 201, 205, 200);

    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toMatchObject({
      alertId: alert.id,
      symbol: 'AAPL',
      condition: 'above',
      targetPrice: 200,
      tag: 'buy',
      field: 'last',
      price: 201,
      triggeredAt: '2026-11-16T15:00:02.000Z',
    });
    expect(await stored(alert.id)).toMatchObject({
      armed: false,
      triggerCount: 1,
      lastTriggeredPrice: 201,
      lastTriggeredAt: '2026-11-16T15:00:02.000Z',
    });
    expect(await alerts.listEvents(10)).toEqual(triggered);
  });

  it('re-arms when the price leaves the condition and fires again when it comes back', async () => {
    const alert = await alerts.create({ symbol: 'MSFT', condition: 'below', targetPrice: 400, tag: 'sell' });
    const watcher = monitor();
    await watcher.reload();

    await prices(watcher, 'MSFT', 399, 401, 398);

    expect(triggered.map((event) => event.price)).toEqual([399, 398]);
    expect(updated.map((saved) => saved.armed)).toEqual([false, true, false]);
    expect(await stored(alert.id)).toMatchObject({ armed: false, triggerCount: 2, lastTriggeredPrice: 398 });
    expect((await alerts.listEvents(10)).map((event) => event.price)).toEqual([398, 399]);
  });

  it('never fires a disabled alert, and fires a re-enabled one on its next price', async () => {
    const alert = await alerts.create({
      symbol: 'NVDA',
      condition: 'above',
      targetPrice: 100,
      tag: 'buy',
      enabled: false,
    });
    const watcher = monitor();
    await watcher.reload();
    await prices(watcher, 'NVDA', 150);
    expect(triggered).toEqual([]);

    await alerts.update(alert.id, { enabled: true });
    await watcher.reload();
    await prices(watcher, 'NVDA', 151);
    expect(triggered.map((event) => event.price)).toEqual([151]);
  });

  it('does not fire again after a restart while the condition still holds', async () => {
    await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const before = monitor();
    await before.reload();
    await prices(before, 'AAPL', 210);

    const after = monitor();
    await after.reload();
    await prices(after, 'AAPL', 211, 212);
    expect(triggered).toHaveLength(1);
  });

  it('fires only once when two monitors see the same crossing', async () => {
    await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const first = monitor();
    const second = monitor();
    await Promise.all([first.reload(), second.reload()]);

    first.evaluate('AAPL', 201);
    second.evaluate('AAPL', 201);
    await Promise.all([first.settled(), second.settled()]);

    expect(triggered).toHaveLength(1);
    expect(await alerts.listEvents(10)).toHaveLength(1);
  });

  it('fires once for a burst of prices that arrive while the trigger is being saved', async () => {
    await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const watcher = monitor();
    await watcher.reload();
    for (const price of [201, 202, 203, 204]) watcher.evaluate('AAPL', price);
    await watcher.settled();
    expect(triggered.map((event) => event.price)).toEqual([201]);
  });

  it("doesn't fire on an alert the user changed since it was loaded, and picks up the change", async () => {
    const alert = await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const watcher = monitor();
    await watcher.reload();
    await alerts.update(alert.id, { targetPrice: 300 });

    // The cached copy still says 200, so this looks like a crossing; the saved alert says otherwise.
    await prices(watcher, 'AAPL', 250);
    expect(triggered).toEqual([]);
    await prices(watcher, 'AAPL', 260, 301);
    expect(triggered.map((event) => [event.price, event.targetPrice])).toEqual([[301, 300]]);
  });

  it('keeps updatedAt increasing even when the clock is behind it', async () => {
    const alert = await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const watcher = monitor();
    await watcher.reload();
    clock -= 60_000;
    await prices(watcher, 'AAPL', 201);
    const saved = await stored(alert.id);
    expect(Date.parse(saved?.updatedAt ?? '')).toBe(Date.parse(alert.updatedAt) + 1);
  });

  it('keeps the newest triggers when the history is full', async () => {
    await dataSource.query(
      `INSERT INTO "alert_events" ("id", "alert_id", "symbol", "condition", "target_price", "tag", "field", "price", "triggered_at")
       SELECT gen_random_uuid(), gen_random_uuid(), 'OLD', 'above', 1, 'buy', 'last', 1,
              TIMESTAMPTZ '2026-01-01' + n * interval '1 second'
       FROM generate_series(1, $1) AS n`,
      [MAX_STORED_EVENTS],
    );
    await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const watcher = monitor();
    await watcher.reload();
    await prices(watcher, 'AAPL', 201);

    const rows = await dataSource.query<{ count: number }[]>(
      'SELECT count(*)::int AS count FROM "alert_events"',
    );
    expect(rows[0]?.count).toBe(MAX_STORED_EVENTS);
    expect((await alerts.listEvents(1))[0]?.symbol).toBe('AAPL');
  });

  it('ignores prices before its first load and for symbols without alerts', async () => {
    await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const watcher = monitor();
    await prices(watcher, 'AAPL', 201);
    await watcher.reload();
    await prices(watcher, 'TSLA', 1_000);
    expect(triggered).toEqual([]);
  });

  it('warns once while saves fail, notifies nobody, and keeps the alert armed', async () => {
    const alert = await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const failing = await openTestDatabase();
    const watcher = monitor(failing);
    await watcher.reload();
    await failing.destroy();

    await prices(watcher, 'AAPL', 201, 202, 203);

    expect(triggered).toEqual([]);
    expect(warnings).toEqual(['Could not save an alert change; it will be tried on the next price']);
    expect(await stored(alert.id)).toMatchObject({ armed: true, triggerCount: 0 });
  });
});

describe('AlertMonitor listeners', () => {
  it('keeps notifying when a listener throws, and stops after unsubscribing', async () => {
    await alerts.create({ symbol: 'AAPL', condition: 'above', targetPrice: 200, tag: 'buy' });
    const watcher = monitor();
    watcher.onTriggered(() => {
      throw new Error('broken listener');
    });
    const late: AlertEvent[] = [];
    const stop = watcher.onTriggered((event) => late.push(event));
    await watcher.reload();
    await prices(watcher, 'AAPL', 201, 199);
    stop();
    await prices(watcher, 'AAPL', 202);
    expect([triggered.length, late.length]).toEqual([2, 1]);
    expect(warnings).toContain('An alert listener failed');
  });
});
