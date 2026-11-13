/**
 * Adversarial tests for the mock realtime client, derived from the data-layer spec (not the
 * implementation): staleness, subscription diffing, scenarios, snapshots, alerts and timer hygiene.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertEvent, ConnectionInfo, PriceAlert, Quote } from '../../domain/types';
import { STALE_AFTER_MS, type FeedScenario, type SimulationState } from '../simulation';
import { createMockMarket } from './market';
import { CONNECT_DELAY_MS, createMockRealtime } from './mockRealtime';
import { createRepository, type Repository } from './repository';
import { createSimulationSource } from './simulationSource';

const START = Date.UTC(2026, 9, 21, 15, 0);
const ISO = new Date(START).toISOString();

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 'adv-1',
    symbol: 'AAPL',
    condition: 'above',
    targetPrice: 100,
    tag: 'buy',
    field: 'last',
    enabled: true,
    armed: true,
    note: null,
    createdAt: ISO,
    updatedAt: ISO,
    lastTriggeredAt: null,
    lastTriggeredPrice: null,
    triggerCount: 0,
    ...overrides,
  };
}

interface Options {
  sim?: Partial<SimulationState>;
  alerts?: PriceAlert[];
  prices?: Record<string, number[]>;
  random?: () => number;
  repo?: Repository;
  defaultEventIds?: boolean;
}

function setup(options: Options = {}) {
  const repo =
    options.repo ??
    createRepository({
      storage: null,
      seed: () => ({ watchlist: { symbols: [], updatedAt: '' }, alerts: options.alerts ?? [] }),
    });
  const scripts = new Map(Object.entries(options.prices ?? {}).map(([s, p]) => [s, [...p]]));
  const market = createMockMarket({ priceOverride: (symbol) => scripts.get(symbol)?.shift() });
  const simulation = createSimulationSource({ ticksPerSecond: 10, ...options.sim });
  let n = 0;
  const rt = createMockRealtime({
    repo,
    market,
    simulation,
    random: options.random ?? (() => 0),
    ...(options.defaultEventIds ? {} : { createEventId: () => `e-${++n}` }),
  });
  const batches: { at: number; quotes: Quote[] }[] = [];
  const states: ConnectionInfo[] = [];
  const events: AlertEvent[] = [];
  const updates: PriceAlert[] = [];
  rt.onQuotes((q) => batches.push({ at: Date.now(), quotes: [...q] }));
  rt.onConnection((c) => states.push({ ...c }));
  rt.onAlert((e) => events.push(e));
  rt.onAlertUpdated((a) => updates.push(a));
  const quotesFor = (symbol: string): Quote[] =>
    batches.flatMap((b) => b.quotes.filter((q) => q.symbol === symbol));
  return {
    repo,
    market,
    simulation,
    rt,
    batches,
    states,
    events,
    updates,
    quotesFor,
    lastQuote: (symbol: string) => quotesFor(symbol).at(-1),
    connect() {
      rt.connect();
      vi.advanceTimersByTime(CONNECT_DELAY_MS);
    },
    advance(ms: number) {
      vi.advanceTimersByTime(ms);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('staleness is measured from the last trade, not from the last (re)subscription', () => {
  it('a symbol re-subscribed while no ticks arrive keeps its stale status (stale scenario)', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(2000); // real trades for AAPL
    const traded = t.lastQuote('AAPL')!;
    expect(traded.status).toBe('live');

    t.simulation.patch({ feedScenario: 'stale' });
    t.advance(STALE_AFTER_MS + 2000);
    expect(t.lastQuote('AAPL')!.status).toBe('stale');

    // The UI drops the symbol and subscribes to it again. No trade has happened for > STALE_AFTER_MS.
    t.rt.setSubscriptions([]);
    t.advance(500);
    t.rt.setSubscriptions(['AAPL']);
    t.advance(500);
    const resent = t.lastQuote('AAPL')!;
    // Same trade as before the switch: nothing new has traded.
    expect(resent.last).toBe(
      t
        .quotesFor('AAPL')
        .filter((q) => q.status === 'stale')
        .at(-1)!.last,
    );
    expect(Date.now() - (resent.lastTradeAt ?? 0)).toBeGreaterThan(STALE_AFTER_MS);
    // Spec: "quotes with no trade for STALE_AFTER_MS become 'stale'". It must not flip back to live.
    expect(resent.status).toBe('stale');
  });

  it('a snapshot after an outage does not label old trades as live while no ticks arrive', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    t.advance(2000);
    t.simulation.patch({ feedScenario: 'stale' });
    t.advance(STALE_AFTER_MS + 2000);
    t.simulation.patch({ feedScenario: 'disconnected' });
    t.advance(5000);
    // Outage ends but the feed is still in the "no ticks" scenario.
    t.simulation.patch({ feedScenario: 'stale' });
    t.advance(CONNECT_DELAY_MS + 100);
    expect(t.rt.getConnection().state).toBe('connected');
    for (const symbol of ['AAPL', 'MSFT']) {
      const q = t.lastQuote(symbol)!;
      if (q.lastTradeAt !== null && Date.now() - q.lastTradeAt > STALE_AFTER_MS) {
        expect(q.status).toBe('stale');
      }
    }
  });
});

describe('timer hygiene', () => {
  const scenarios: FeedScenario[] = ['live', 'delayed', 'stale', 'disconnected', 'flaky'];

  it.each(scenarios)('leaves no timers after disconnect() in the %s scenario at any phase', (scenario) => {
    for (const runFor of [0, 100, CONNECT_DELAY_MS, 5_000, 21_000, 23_000, 65_000]) {
      const t = setup({ sim: { feedScenario: scenario }, alerts: [alert({ targetPrice: 1 })] });
      t.rt.setSubscriptions(['AAPL', 'ZZZZ']);
      t.rt.connect();
      t.advance(runFor);
      t.rt.disconnect();
      expect(vi.getTimerCount()).toBe(0);
      expect(t.rt.getConnection().state).toBe('disconnected');
      expect(t.rt.getUpstreamSubscriptions().size).toBe(0);
      const count = t.batches.length;
      t.advance(120_000);
      expect(t.batches.length).toBe(count);
      vi.clearAllTimers();
    }
  });

  it('switching scenarios repeatedly never accumulates timers', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    const sequence: FeedScenario[] = [
      'flaky',
      'disconnected',
      'live',
      'flaky',
      'stale',
      'delayed',
      'flaky',
      'live',
    ];
    for (const s of sequence) {
      t.simulation.patch({ feedScenario: s });
      t.advance(700);
    }
    // 3 loops (tick/flush/sweep) at most plus one pending timer (connect/retry/flaky).
    expect(vi.getTimerCount()).toBeLessThanOrEqual(4);
    t.rt.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('disconnected scenario', () => {
  it('reports attempt numbers and nextRetryAt = now + backoff, never connects, and keeps every quote stale', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    t.advance(1000);
    const beforeOutage = t.batches.length;
    t.simulation.patch({ feedScenario: 'disconnected' });
    const expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000];
    for (let i = 0; i < expected.length; i++) {
      const info = t.rt.getConnection();
      expect(info.state).toBe('reconnecting');
      expect(info.reconnectAttempt).toBe(i + 1);
      expect(info.nextRetryAt).toBe(Date.now() + expected[i]!);
      expect(info.error).not.toBeNull();
      t.advance(expected[i]!);
    }
    const outageIndex = t.states.findIndex((s) => s.state === 'reconnecting');
    expect(t.states.slice(outageIndex).every((s) => s.state === 'reconnecting')).toBe(true);
    const duringOutage = t.batches.slice(beforeOutage).flatMap((b) => b.quotes);
    expect(duringOutage.length).toBeGreaterThan(0);
    expect(duringOutage.every((q) => q.status === 'stale')).toBe(true);
    expect(t.rt.getUpstreamSubscriptions().size).toBe(0);
  });

  it('connecting straight into the outage goes connecting → reconnecting with attempt 1', () => {
    const t = setup({ sim: { feedScenario: 'disconnected' } });
    t.rt.connect();
    expect(t.rt.getConnection().state).toBe('connecting');
    t.advance(CONNECT_DELAY_MS);
    expect(t.rt.getConnection()).toMatchObject({ state: 'reconnecting', reconnectAttempt: 1 });
    t.advance(120_000);
    expect(t.states.every((s) => s.state !== 'connected')).toBe(true);
    expect(t.states.every((s) => s.simulated && s.feedName === 'Simulated feed')).toBe(true);
  });
});

describe('snapshot after (re)connect', () => {
  it('flaky recovery emits exactly one snapshot batch that covers every client symbol, including unknown ones', () => {
    const t = setup({ sim: { feedScenario: 'flaky' } });
    t.rt.setSubscriptions(['AAPL', 'MSFT', 'ZZZZ']);
    t.connect();
    t.advance(20_000);
    expect(t.rt.getConnection().state).toBe('reconnecting');
    const before = t.batches.length;
    t.advance(4_000);
    expect(t.rt.getConnection().state).toBe('connected');
    const snapshot = t.batches[before]!;
    expect(snapshot.quotes.map((q) => q.symbol).sort()).toEqual(['AAPL', 'MSFT', 'ZZZZ']);
    expect(snapshot.quotes.find((q) => q.symbol === 'ZZZZ')).toMatchObject({
      status: 'unavailable',
      last: null,
    });
    // No second batch in the same instant.
    expect(t.batches.filter((b) => b.at === snapshot.at)).toHaveLength(1);
  });
});

describe('batches', () => {
  it('never contains two quotes for one symbol and never contains unsubscribed symbols, even at 50 tps', () => {
    const t = setup({ sim: { ticksPerSecond: 50 }, alerts: [alert({ symbol: 'NVDA', targetPrice: 1e6 })] });
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    t.advance(3000);
    t.rt.setSubscriptions(['MSFT']);
    const cut = t.batches.length;
    t.advance(5000);
    for (const batch of t.batches) {
      const symbols = batch.quotes.map((q) => q.symbol);
      expect(new Set(symbols).size).toBe(symbols.length);
      expect(symbols).not.toContain('NVDA');
    }
    expect(t.batches.slice(cut).flatMap((b) => b.quotes.map((q) => q.symbol))).not.toContain('AAPL');
    expect(t.rt.getUpstreamSubscriptions()).toEqual(new Set(['MSFT', 'NVDA']));
  });

  it('flushes regular batches on the 250ms cadence (at most 4 per second)', () => {
    const t = setup({ sim: { ticksPerSecond: 50 }, random: Math.random });
    t.rt.setSubscriptions(['AAPL', 'MSFT', 'NVDA', 'SPY']);
    t.connect();
    const from = t.batches.length;
    t.advance(10_000);
    const regular = t.batches.slice(from);
    expect(regular.length).toBeLessThanOrEqual(40);
    expect(regular.length).toBeGreaterThanOrEqual(38);
    for (let i = 1; i < regular.length; i++) {
      expect(regular[i]!.at - regular[i - 1]!.at).toBeGreaterThanOrEqual(250);
    }
  });

  it('re-subscribing the same set in a different order or with duplicates is not a change', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    const upstream = t.rt.getUpstreamSubscriptions();
    const count = t.batches.length;
    t.rt.setSubscriptions(['msft', ' AAPL ', 'AAPL', 'MSFT']);
    expect(t.rt.getUpstreamSubscriptions()).toEqual(upstream);
    expect(t.batches.length).toBe(count);
  });
});

describe('backend alerts', () => {
  it('persists the triggered state and emits a matching event with a unique id (default id factory)', () => {
    const t = setup({
      alerts: [alert({ id: 'x', targetPrice: 150 })],
      prices: { AAPL: [140, 151, 152, 149, 155, 156] },
      defaultEventIds: true,
    });
    t.connect(); // no client subscriptions at all: the backend watches the alert symbol on its own
    expect(t.rt.getUpstreamSubscriptions()).toEqual(new Set(['AAPL']));
    t.advance(600);
    expect(t.batches).toHaveLength(0);
    expect(t.events.map((e) => e.price)).toEqual([151, 155]);
    expect(new Set(t.events.map((e) => e.id)).size).toBe(2);
    for (const e of t.events) {
      expect(e).toMatchObject({
        alertId: 'x',
        symbol: 'AAPL',
        condition: 'above',
        targetPrice: 150,
        tag: 'buy',
        field: 'last',
      });
    }
    const stored = t.repo.getAlert('x')!;
    expect(stored).toMatchObject({ armed: false, triggerCount: 2, lastTriggeredPrice: 155 });
    expect(stored.lastTriggeredAt).toBe(t.events[1]!.triggeredAt);
    expect(stored.createdAt).toBe(ISO);
    expect(Date.parse(stored.updatedAt)).toBeGreaterThan(START);
    // onAlertUpdated mirrors every persisted change: fire, re-arm, fire.
    expect(t.updates.map((u) => [u.armed, u.triggerCount])).toEqual([
      [false, 1],
      [true, 1],
      [false, 2],
    ]);
  });

  it('never evaluates an alert on an unknown symbol and never trades it', () => {
    const t = setup({ alerts: [alert({ symbol: 'ZZZZ', targetPrice: 0.01 })] });
    t.rt.setSubscriptions(['ZZZZ']);
    t.connect();
    t.advance(30_000);
    expect(t.events).toHaveLength(0);
    expect(t.updates).toHaveLength(0);
    expect(t.quotesFor('ZZZZ').every((q) => q.status === 'unavailable' && q.last === null)).toBe(true);
    expect(t.quotesFor('ZZZZ')).toHaveLength(1);
  });

  it('an alert removed from the repo stops being evaluated and leaves upstream', () => {
    const t = setup({ alerts: [alert({ id: 'gone', symbol: 'NVDA', targetPrice: 1 })] });
    t.connect();
    t.advance(200);
    expect(t.events).toHaveLength(1);
    t.repo.deleteAlert('gone');
    expect(t.rt.getUpstreamSubscriptions().has('NVDA')).toBe(false);
    t.repo.saveAlert(alert({ id: 'other', symbol: 'MSFT', condition: 'below', targetPrice: 1 }));
    t.advance(5000);
    expect(t.events).toHaveLength(1);
  });

  it('does not fire from a stale scenario where no trades happen, even if the condition is met', () => {
    const t = setup({ sim: { feedScenario: 'stale' }, alerts: [alert({ targetPrice: 1 })] });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(STALE_AFTER_MS * 3);
    expect(t.events).toHaveLength(0);
    expect(t.repo.getAlert('adv-1')!.armed).toBe(true);
  });
});
