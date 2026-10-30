import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertEvent, ConnectionInfo, PriceAlert, Quote } from '../../domain/types';
import { STALE_AFTER_MS, type SimulationState } from '../simulation';
import { createMockMarket } from './market';
import { createMockApi } from './mockApi';
import {
  backoffDelay,
  CONNECT_DELAY_MS,
  createMockRealtime,
  DELAYED_FEED_MS,
  FEED_NAME,
  FLAKY_DROP_AFTER_MS,
  FLAKY_RECOVER_AFTER_MS,
  FLUSH_INTERVAL_MS,
} from './mockRealtime';
import { createRepository, type Repository } from './repository';
import { createSimulationSource } from './simulationSource';

const START = Date.UTC(2026, 9, 21, 15, 0);
const ISO = new Date(START).toISOString();

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 'a1',
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

interface SetupOptions {
  sim?: Partial<SimulationState>;
  alerts?: PriceAlert[];
  /** Scripted trade prices per symbol; the model takes over when a script runs out. */
  prices?: Record<string, number[]>;
  random?: () => number;
  repo?: Repository;
}

function setup(options: SetupOptions = {}) {
  const repo =
    options.repo ?? createRepository({ seed: () => ({ watchlists: [], alerts: options.alerts ?? [] }) });
  const scripts = new Map(Object.entries(options.prices ?? {}).map(([s, p]) => [s, [...p]]));
  const market = createMockMarket({ priceOverride: (symbol) => scripts.get(symbol)?.shift() });
  const simulation = createSimulationSource({ ticksPerSecond: 10, ...options.sim });
  const diffs: { added: string[]; removed: string[] }[] = [];
  let eventCounter = 0;
  const rt = createMockRealtime({
    repo,
    market,
    simulation,
    random: options.random ?? (() => 0),
    createEventId: () => `evt-${++eventCounter}`,
    onUpstreamChange: (added, removed) => diffs.push({ added: [...added], removed: [...removed] }),
  });
  const batches: { at: number; quotes: Quote[] }[] = [];
  const states: ConnectionInfo[] = [];
  const events: AlertEvent[] = [];
  const updates: PriceAlert[] = [];
  rt.onQuotes((quotes) => batches.push({ at: Date.now(), quotes: [...quotes] }));
  rt.onConnection((info) => states.push(info));
  rt.onAlert((event) => events.push(event));
  rt.onAlertUpdated((a) => updates.push(a));

  const connect = (): void => {
    rt.connect();
    vi.advanceTimersByTime(CONNECT_DELAY_MS);
  };
  const advance = (ms: number): void => {
    vi.advanceTimersByTime(ms);
  };
  const quotesFor = (symbol: string): Quote[] =>
    batches.flatMap((b) => b.quotes.filter((q) => q.symbol === symbol));
  const lastQuote = (symbol: string): Quote | undefined => quotesFor(symbol).at(-1);
  /** Connection state transitions (heartbeats repeat the current state and are collapsed). */
  const stateNames = (): string[] =>
    states.map((s) => s.state).filter((state, i, all) => i === 0 || all[i - 1] !== state);
  return {
    repo,
    market,
    simulation,
    rt,
    diffs,
    batches,
    states,
    events,
    updates,
    connect,
    advance,
    quotesFor,
    lastQuote,
    stateNames,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('doubles from 1s and caps at 30s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(backoffDelay(0)).toBe(1000);
  });
});

describe('connection lifecycle', () => {
  it('starts disconnected and marks the feed as simulated', () => {
    const { rt } = setup();
    expect(rt.getConnection()).toEqual({
      state: 'disconnected',
      feedName: FEED_NAME,
      simulated: true,
      lastMessageAt: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
      error: null,
    });
  });

  it('goes connecting → connected after ~300ms', () => {
    const t = setup();
    t.rt.connect();
    expect(t.rt.getConnection().state).toBe('connecting');
    t.advance(CONNECT_DELAY_MS - 1);
    expect(t.rt.getConnection().state).toBe('connecting');
    t.advance(1);
    expect(t.rt.getConnection()).toMatchObject({
      state: 'connected',
      reconnectAttempt: 0,
      nextRetryAt: null,
      error: null,
      lastMessageAt: START + CONNECT_DELAY_MS,
      simulated: true,
    });
    expect(t.stateNames()).toEqual(['connecting', 'connected']);
  });

  it('ignores connect() while already connecting or connected', () => {
    const t = setup();
    t.rt.connect();
    t.rt.connect();
    t.advance(CONNECT_DELAY_MS);
    t.rt.connect();
    expect(t.stateNames()).toEqual(['connecting', 'connected']);
  });

  it('disconnect() clears every timer, stops retries and emissions, and allows reconnecting', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(1000);
    t.rt.disconnect();
    expect(t.rt.getConnection()).toMatchObject({
      state: 'disconnected',
      reconnectAttempt: 0,
      nextRetryAt: null,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(t.rt.getUpstreamSubscriptions().size).toBe(0);
    const count = t.batches.length;
    t.advance(60_000);
    expect(t.batches.length).toBe(count);

    t.connect();
    expect(t.rt.getConnection().state).toBe('connected');
  });

  it('disconnect() during connecting never connects', () => {
    const t = setup();
    t.rt.connect();
    t.rt.disconnect();
    t.advance(5000);
    expect(t.stateNames()).toEqual(['connecting', 'disconnected']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disconnect() before connect() is a no-op', () => {
    const t = setup();
    t.rt.disconnect();
    expect(t.states).toHaveLength(0);
  });

  it('disconnect() marks delivered quotes stale once', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL', 'ZZZZ']);
    t.connect();
    t.rt.disconnect();
    const last = t.batches.at(-1)!.quotes;
    expect(last.map((q) => [q.symbol, q.status])).toEqual([['AAPL', 'stale']]);
  });

  it('sends a heartbeat (lastMessageAt) every second while connected', () => {
    const t = setup();
    t.connect();
    t.advance(1000);
    expect(t.rt.getConnection().lastMessageAt).toBe(Date.now());
    const before = t.states.length;
    t.advance(3000);
    expect(t.states.length - before).toBe(3);
  });
});

describe('quote batching', () => {
  it('emits one snapshot batch on connect covering every subscribed symbol', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL', 'MSFT', 'ZZZZ']);
    expect(t.batches).toHaveLength(0);
    t.connect();
    expect(t.batches).toHaveLength(1);
    const snapshot = t.batches[0]!.quotes;
    expect(snapshot.map((q) => q.symbol).sort()).toEqual(['AAPL', 'MSFT', 'ZZZZ']);
    const aapl = snapshot.find((q) => q.symbol === 'AAPL')!;
    expect(aapl.status).toBe('live');
    expect(aapl.last).toBe(t.market.getState('AAPL')!.last);
    expect(aapl.bid!).toBeLessThan(aapl.ask!);
    expect(aapl.change).toBeCloseTo(aapl.last! - aapl.prevClose!, 6);
  });

  it('serves unknown symbols as unavailable with null prices, and never ticks or stales them', () => {
    const t = setup();
    t.rt.setSubscriptions(['ZZZZ']);
    t.connect();
    expect(t.quotesFor('ZZZZ')).toHaveLength(1);
    expect(t.lastQuote('ZZZZ')).toMatchObject({
      status: 'unavailable',
      last: null,
      bid: null,
      ask: null,
      prevClose: null,
      change: null,
      changePct: null,
      volume: null,
    });
    t.advance(STALE_AFTER_MS * 3);
    expect(t.quotesFor('ZZZZ')).toHaveLength(1);
  });

  it('coalesces trades: at most one quote per symbol per batch, flushed every 250ms', () => {
    let i = 0;
    const t = setup({ sim: { ticksPerSecond: 50 }, random: () => (i++ % 3) / 3 });
    t.rt.setSubscriptions(['AAPL', 'MSFT', 'NVDA']);
    t.connect();
    const connectedAt = Date.now();
    t.advance(5000);
    const live = t.batches.slice(1);
    expect(live.length).toBe(5000 / FLUSH_INTERVAL_MS);
    for (const batch of live) {
      const symbols = batch.quotes.map((q) => q.symbol);
      expect(new Set(symbols).size).toBe(symbols.length);
      expect((batch.at - connectedAt) % FLUSH_INTERVAL_MS).toBe(0);
    }
    // 50 trades per second were coalesced into far fewer quotes.
    const trades = ['AAPL', 'MSFT', 'NVDA'].reduce((sum, s) => sum + t.market.getState(s)!.tradeCount, 0);
    const delivered = live.reduce((sum, b) => sum + b.quotes.length, 0);
    expect(trades).toBe(250);
    expect(delivered).toBeLessThanOrEqual(3 * live.length);
    // Once trading stops, the last delivered quote is the latest trade. (A trade at the same instant
    // as a flush may ship in the next flush; timer order on ties isn't guaranteed.)
    t.simulation.patch({ feedScenario: 'stale' });
    t.advance(FLUSH_INTERVAL_MS);
    for (const symbol of ['AAPL', 'MSFT', 'NVDA']) {
      expect(t.lastQuote(symbol)?.last).toBe(t.market.getState(symbol)!.last);
      expect(t.lastQuote(symbol)?.volume).toBe(t.market.getState(symbol)!.volume);
    }
  });

  it('distributes exactly ticksPerSecond trades per second across the demand set', () => {
    const t = setup({ sim: { ticksPerSecond: 12 }, random: Math.random });
    t.rt.setSubscriptions(['AAPL', 'MSFT', 'NVDA']);
    t.connect();
    t.advance(10_000);
    const counts = ['AAPL', 'MSFT', 'NVDA'].map((s) => t.market.getState(s)!.tradeCount);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(120);
    expect(counts.every((c) => c > 10)).toBe(true);
  });

  it('reads ticksPerSecond live and clamps it to 1-50', () => {
    const t = setup({ sim: { ticksPerSecond: 0 } });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(1000);
    expect(t.market.getState('AAPL')!.tradeCount).toBe(1);
    t.simulation.patch({ ticksPerSecond: 1000 });
    t.advance(1000);
    expect(t.market.getState('AAPL')!.tradeCount).toBe(51);
  });

  it('sends no batch when nothing changed', () => {
    const t = setup({ sim: { feedScenario: 'stale' } });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(STALE_AFTER_MS - 1000);
    expect(t.batches).toHaveLength(1);
  });
});

describe('subscriptions', () => {
  it('normalizes, ignores duplicates and blanks, and sends only the diff upstream', () => {
    const t = setup();
    t.connect();
    t.rt.setSubscriptions(['aapl', 'AAPL', ' msft ', '', 7 as unknown as string]);
    expect([...t.rt.getUpstreamSubscriptions()].sort()).toEqual(['AAPL', 'MSFT']);
    expect(t.diffs).toEqual([{ added: ['AAPL', 'MSFT'], removed: [] }]);

    t.rt.setSubscriptions(['MSFT', 'NVDA']);
    expect(t.diffs.at(-1)).toEqual({ added: ['NVDA'], removed: ['AAPL'] });
    t.rt.setSubscriptions(['NVDA', 'msft', 'NVDA']);
    expect(t.diffs).toHaveLength(2);
    t.rt.setSubscriptions([]);
    expect(t.diffs.at(-1)).toEqual({ added: [], removed: ['MSFT', 'NVDA'] });
    expect(t.rt.getUpstreamSubscriptions().size).toBe(0);
  });

  it('subscribes upstream only while connected', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL']);
    expect(t.rt.getUpstreamSubscriptions().size).toBe(0);
    t.connect();
    expect([...t.rt.getUpstreamSubscriptions()]).toEqual(['AAPL']);
  });

  it('stops emitting a symbol once it is unsubscribed', () => {
    const t = setup({ random: Math.random });
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    t.advance(2000);
    t.rt.setSubscriptions(['MSFT']);
    const cut = t.batches.length;
    t.advance(5000);
    const after = t.batches.slice(cut).flatMap((b) => b.quotes.map((q) => q.symbol));
    expect(after).not.toContain('AAPL');
    expect(after).toContain('MSFT');
  });

  it('gives a newly subscribed symbol its first quote within one flush', () => {
    const t = setup({ sim: { feedScenario: 'stale' } });
    t.connect();
    t.rt.setSubscriptions(['NVDA']);
    t.advance(FLUSH_INTERVAL_MS);
    expect(t.lastQuote('NVDA')?.status).toBe('live');
  });

  it('keeps enabled alert symbols upstream without emitting them to the client', () => {
    let i = 0;
    const t = setup({
      alerts: [alert({ symbol: 'TSLA', targetPrice: 1_000_000 })],
      random: () => (i++ % 2) / 2,
    });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    expect([...t.rt.getUpstreamSubscriptions()].sort()).toEqual(['AAPL', 'TSLA']);
    t.advance(3000);
    expect(t.quotesFor('TSLA')).toHaveLength(0);
    expect(t.market.getState('TSLA')!.tradeCount).toBeGreaterThan(0);

    // Unsubscribing the client from an alert symbol keeps it upstream.
    t.rt.setSubscriptions(['AAPL', 'TSLA']);
    t.advance(FLUSH_INTERVAL_MS);
    expect(t.quotesFor('TSLA').length).toBeGreaterThan(0);
    t.rt.setSubscriptions(['AAPL']);
    expect(t.rt.getUpstreamSubscriptions().has('TSLA')).toBe(true);
  });

  it('follows alert changes in the repository: disable removes, enable and create add', () => {
    const t = setup({ alerts: [alert({ symbol: 'TSLA' })] });
    t.connect();
    expect(t.rt.getUpstreamSubscriptions().has('TSLA')).toBe(true);
    t.repo.saveAlert({ ...t.repo.getAlert('a1')!, enabled: false });
    expect(t.rt.getUpstreamSubscriptions().has('TSLA')).toBe(false);
    t.repo.saveAlert({ ...t.repo.getAlert('a1')!, enabled: true });
    expect(t.rt.getUpstreamSubscriptions().has('TSLA')).toBe(true);
    t.repo.saveAlert(alert({ id: 'a2', symbol: 'AMD' }));
    expect(t.rt.getUpstreamSubscriptions().has('AMD')).toBe(true);
    t.repo.deleteAlert('a2');
    expect(t.rt.getUpstreamSubscriptions().has('AMD')).toBe(false);
  });

  it('marks a re-added symbol stale when there is no connection', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    expect(t.lastQuote('AAPL')?.status).toBe('live');
    // Unsubscribed while connected: the client still holds a live AAPL quote.
    t.rt.setSubscriptions(['MSFT']);
    t.simulation.patch({ feedScenario: 'disconnected' });
    expect(t.batches.at(-1)!.quotes.map((q) => q.symbol)).toEqual(['MSFT']);
    const cut = t.batches.length;
    t.rt.setSubscriptions(['MSFT', 'AAPL']);
    expect(t.batches.length).toBe(cut + 1);
    expect(t.batches.at(-1)!.quotes.map((q) => [q.symbol, q.status])).toEqual([['AAPL', 'stale']]);
    // Re-adding again sends nothing: it is already stale.
    t.rt.setSubscriptions(['MSFT']);
    t.rt.setSubscriptions(['MSFT', 'AAPL']);
    expect(t.batches.length).toBe(cut + 1);
  });
});

describe('staleness', () => {
  it('turns quotes stale after STALE_AFTER_MS without trades and re-emits them only once', () => {
    const t = setup({ sim: { feedScenario: 'stale' } });
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    expect(t.batches[0]!.quotes.every((q) => q.status === 'live')).toBe(true);
    t.advance(STALE_AFTER_MS - 1000);
    expect(t.batches).toHaveLength(1);
    t.advance(1000 + FLUSH_INTERVAL_MS);
    expect(t.batches).toHaveLength(2);
    expect(t.batches[1]!.quotes.map((q) => q.status)).toEqual(['stale', 'stale']);
    // Prices are kept, only the status changes.
    expect(t.batches[1]!.quotes[0]!.last).toBe(t.batches[0]!.quotes[0]!.last);
    t.advance(60_000);
    expect(t.batches).toHaveLength(2);
    expect(t.rt.getConnection().state).toBe('connected');
  });

  it('brings stale quotes back to live on their next trade', () => {
    const t = setup({ sim: { feedScenario: 'stale' } });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(STALE_AFTER_MS + 1000);
    expect(t.lastQuote('AAPL')?.status).toBe('stale');
    t.simulation.patch({ feedScenario: 'live' });
    t.advance(FLUSH_INTERVAL_MS);
    expect(t.lastQuote('AAPL')?.status).toBe('live');
  });

  it('measures staleness by arrival time, so delayed quotes do not go stale immediately', () => {
    const t = setup({ sim: { feedScenario: 'delayed' } });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(STALE_AFTER_MS * 2);
    expect(t.quotesFor('AAPL').every((q) => q.status === 'delayed')).toBe(true);
  });
});

describe('scenarios', () => {
  it('delayed: quotes are marked delayed with trade times 15 minutes behind', () => {
    const t = setup({ sim: { feedScenario: 'delayed' } });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(1000);
    const quote = t.lastQuote('AAPL')!;
    expect(quote.status).toBe('delayed');
    // updatedAt is when the trade arrived; the trade itself is stamped 15 minutes earlier.
    expect(quote.updatedAt - quote.lastTradeAt!).toBe(DELAYED_FEED_MS);
    expect(quote.quoteAt).toBe(quote.lastTradeAt);
    const lag = Date.now() - DELAYED_FEED_MS - quote.lastTradeAt!;
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag).toBeLessThanOrEqual(FLUSH_INTERVAL_MS);
  });

  it('switching live ↔ delayed relabels current quotes without counting as trades', () => {
    const t = setup({ sim: { feedScenario: 'stale' } });
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    const trades = t.market.getState('AAPL')!.tradeCount;
    t.simulation.patch({ feedScenario: 'delayed' });
    t.advance(FLUSH_INTERVAL_MS);
    expect(t.batches.at(-1)!.quotes.map((q) => q.status)).toEqual(['delayed', 'delayed']);
    // 'delayed' produces trades from now on, but the relabel itself was not one.
    expect(t.batches.at(-1)!.quotes[0]!.last).toBeDefined();
    expect(trades).toBe(0);
    t.simulation.patch({ feedScenario: 'live' });
    t.advance(FLUSH_INTERVAL_MS);
    expect(t.lastQuote('AAPL')?.status).toBe('live');
    expect(t.lastQuote('MSFT')?.status).toBe('live');
  });

  it('disconnected: retries with 1s, 2s, 4s, 8s, 16s, 30s, 30s backoff and never connects', () => {
    const t = setup({ sim: { feedScenario: 'disconnected' } });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    expect(t.rt.getConnection()).toMatchObject({
      state: 'reconnecting',
      reconnectAttempt: 1,
      nextRetryAt: Date.now() + 1000,
    });
    expect(t.rt.getConnection().error).toMatch(/simulated/i);
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 7; attempt++) {
      const info = t.rt.getConnection();
      expect(info.reconnectAttempt).toBe(attempt);
      const delay = info.nextRetryAt! - Date.now();
      delays.push(delay);
      t.advance(delay - 1);
      expect(t.rt.getConnection().reconnectAttempt).toBe(attempt);
      t.advance(1);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(t.stateNames()).not.toContain('connected');
    expect(t.batches).toHaveLength(0);
    expect(t.rt.getUpstreamSubscriptions().size).toBe(0);
  });

  it('disconnected while connected: drops, marks quotes stale once, stops trades, then backs off', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    t.advance(1000);
    const cut = t.batches.length;
    t.simulation.patch({ feedScenario: 'disconnected' });
    expect(t.rt.getConnection()).toMatchObject({ state: 'reconnecting', reconnectAttempt: 1 });
    expect(t.batches.length).toBe(cut + 1);
    expect(t.batches.at(-1)!.quotes.map((q) => q.status)).toEqual(['stale', 'stale']);
    expect(t.rt.getUpstreamSubscriptions().size).toBe(0);
    const trades = t.market.getState('AAPL')!.tradeCount;
    t.advance(20_000);
    expect(t.market.getState('AAPL')!.tradeCount).toBe(trades);
    expect(t.batches.length).toBe(cut + 1);
    // Retries at +1s, +3s, +7s, +15s; the next is due at +31s.
    expect(t.rt.getConnection().reconnectAttempt).toBe(5);
  });

  it('ending the outage reconnects immediately with one snapshot batch', () => {
    const t = setup({ sim: { feedScenario: 'disconnected' } });
    t.rt.setSubscriptions(['AAPL', 'MSFT', 'ZZZZ']);
    t.connect();
    t.advance(7000);
    expect(t.rt.getConnection().state).toBe('reconnecting');
    t.simulation.patch({ feedScenario: 'live' });
    expect(t.rt.getConnection()).toMatchObject({
      state: 'connected',
      reconnectAttempt: 0,
      nextRetryAt: null,
      error: null,
    });
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]!.quotes.map((q) => q.symbol).sort()).toEqual(['AAPL', 'MSFT', 'ZZZZ']);
    expect(vi.getTimerCount()).toBe(3);
  });

  it('flaky: drops every ~20s, reconnects after ~4s with a snapshot, and repeats', () => {
    let i = 0;
    const t = setup({ sim: { feedScenario: 'flaky' }, random: () => (i++ % 2) / 2 });
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    t.advance(FLAKY_DROP_AFTER_MS - 1);
    expect(t.rt.getConnection().state).toBe('connected');
    t.advance(1);
    expect(t.rt.getConnection()).toMatchObject({
      state: 'reconnecting',
      reconnectAttempt: 1,
      nextRetryAt: Date.now() + FLAKY_RECOVER_AFTER_MS,
    });
    expect(t.batches.at(-1)!.quotes.map((q) => q.status)).toEqual(['stale', 'stale']);

    const cut = t.batches.length;
    t.advance(FLAKY_RECOVER_AFTER_MS);
    expect(t.rt.getConnection().state).toBe('connected');
    expect(t.batches.length).toBe(cut + 1);
    const snapshot = t.batches.at(-1)!.quotes;
    expect(snapshot.map((q) => q.symbol).sort()).toEqual(['AAPL', 'MSFT']);
    expect(snapshot.every((q) => q.status === 'live')).toBe(true);

    t.advance(FLAKY_DROP_AFTER_MS);
    expect(t.rt.getConnection().state).toBe('reconnecting');
    t.advance(FLAKY_RECOVER_AFTER_MS);
    expect(t.stateNames().filter((s) => s === 'connected')).toHaveLength(3);
  });

  it('leaving flaky cancels the pending drop', () => {
    const t = setup({ sim: { feedScenario: 'flaky' } });
    t.connect();
    t.advance(10_000);
    t.simulation.patch({ feedScenario: 'live' });
    t.advance(60_000);
    expect(t.stateNames()).not.toContain('reconnecting');
  });

  it('switching to disconnected during a flaky drop continues the normal backoff', () => {
    const t = setup({ sim: { feedScenario: 'flaky' } });
    t.connect();
    t.advance(FLAKY_DROP_AFTER_MS);
    t.simulation.patch({ feedScenario: 'disconnected' });
    t.advance(FLAKY_RECOVER_AFTER_MS);
    expect(t.rt.getConnection()).toMatchObject({ state: 'reconnecting', reconnectAttempt: 2 });
    expect(t.rt.getConnection().nextRetryAt! - Date.now()).toBe(2000);
  });

  it('a scenario chosen while connecting applies when the connect delay ends', () => {
    const t = setup();
    t.rt.connect();
    t.simulation.patch({ feedScenario: 'disconnected' });
    t.advance(CONNECT_DELAY_MS);
    expect(t.rt.getConnection().state).toBe('reconnecting');
  });

  it('ignores scenario changes after disconnect()', () => {
    const t = setup();
    t.connect();
    t.rt.disconnect();
    const count = t.states.length;
    t.simulation.patch({ feedScenario: 'flaky' });
    t.simulation.patch({ feedScenario: 'disconnected' });
    t.advance(60_000);
    expect(t.states.length).toBe(count);
  });

  it.each(['live', 'delayed', 'stale', 'disconnected', 'flaky'] as const)(
    'leaves no timers behind after disconnect() in the %s scenario',
    (scenario) => {
      const t = setup({ sim: { feedScenario: scenario } });
      t.rt.setSubscriptions(['AAPL']);
      t.connect();
      t.advance(FLAKY_DROP_AFTER_MS + 1000);
      t.rt.disconnect();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe('alert evaluation', () => {
  it('fires once while satisfied, re-arms after leaving, and fires again on re-entry', () => {
    const t = setup({ alerts: [alert()], prices: { AAPL: [99, 101, 102, 105, 99, 103] } });
    t.connect();
    const step = (): void => {
      t.advance(100);
    };

    step(); // 99: not satisfied, already armed: nothing to persist
    expect(t.events).toHaveLength(0);
    expect(t.updates).toHaveLength(0);

    step(); // 101: fires
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toEqual({
      id: 'evt-1',
      alertId: 'a1',
      symbol: 'AAPL',
      condition: 'above',
      targetPrice: 100,
      tag: 'buy',
      field: 'last',
      price: 101,
      triggeredAt: new Date(Date.now()).toISOString(),
    });
    expect(t.updates.at(-1)).toMatchObject({ armed: false, triggerCount: 1, lastTriggeredPrice: 101 });
    expect(t.repo.getAlert('a1')).toMatchObject({ armed: false, triggerCount: 1, lastTriggeredPrice: 101 });

    step(); // 102: still satisfied, disarmed: quiet
    step(); // 105
    expect(t.events).toHaveLength(1);
    expect(t.updates).toHaveLength(1);

    step(); // 99: leaves the condition: re-arms, no event
    expect(t.events).toHaveLength(1);
    expect(t.updates.at(-1)).toMatchObject({ armed: true, triggerCount: 1 });
    expect(t.repo.getAlert('a1')?.armed).toBe(true);

    step(); // 103: fires again with a new event id
    expect(t.events.map((e) => e.id)).toEqual(['evt-1', 'evt-2']);
    expect(t.repo.getAlert('a1')).toMatchObject({ armed: false, triggerCount: 2, lastTriggeredPrice: 103 });
  });

  it('fires "below" alerts at or under the target, including equality', () => {
    const t = setup({
      alerts: [alert({ condition: 'below', targetPrice: 100, tag: 'sell' })],
      prices: { AAPL: [100] },
    });
    t.connect();
    t.advance(100);
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({ condition: 'below', price: 100, tag: 'sell' });
  });

  it('updates updatedAt on every persisted change and never touches createdAt', () => {
    const t = setup({ alerts: [alert()], prices: { AAPL: [101, 99, 101] } });
    t.connect();
    t.advance(300);
    expect(t.updates).toHaveLength(3);
    let previous = ISO;
    for (const update of t.updates) {
      expect(update.createdAt).toBe(ISO);
      expect(Date.parse(update.updatedAt)).toBeGreaterThan(Date.parse(previous));
      previous = update.updatedAt;
    }
  });

  it('never fires a disabled alert, and does not even watch its symbol', () => {
    const t = setup({ alerts: [alert({ enabled: false })], prices: { AAPL: [150, 150, 150] } });
    t.connect();
    expect(t.rt.getUpstreamSubscriptions().has('AAPL')).toBe(false);
    t.rt.setSubscriptions(['AAPL']);
    t.advance(1000);
    expect(t.market.getState('AAPL')!.tradeCount).toBeGreaterThan(0);
    expect(t.events).toHaveLength(0);
    expect(t.updates).toHaveLength(0);
    expect(t.repo.getAlert('a1')).toMatchObject({ armed: true, triggerCount: 0 });
  });

  it('does not re-fire from snapshots or reconnects while the condition stays satisfied', () => {
    const t = setup({ sim: { feedScenario: 'flaky' }, alerts: [alert({ targetPrice: 1 })] });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(100);
    expect(t.events).toHaveLength(1);
    // Two drop/reconnect cycles with snapshots, plus plenty of satisfied trades.
    t.advance(2 * (FLAKY_DROP_AFTER_MS + FLAKY_RECOVER_AFTER_MS));
    expect(t.stateNames().filter((s) => s === 'connected')).toHaveLength(3);
    expect(t.events).toHaveLength(1);
    expect(t.repo.getAlert('a1')).toMatchObject({ armed: false, triggerCount: 1 });
  });

  it('does not evaluate snapshots: an armed, already-satisfied alert waits for the first real trade', () => {
    const t = setup({ sim: { feedScenario: 'stale' }, alerts: [alert({ targetPrice: 1 })] });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(STALE_AFTER_MS * 2);
    expect(t.events).toHaveLength(0);
    t.simulation.patch({ feedScenario: 'live' });
    t.advance(100);
    expect(t.events).toHaveLength(1);
  });

  it('never evaluates while disconnected', () => {
    const t = setup({ sim: { feedScenario: 'disconnected' }, alerts: [alert({ targetPrice: 1 })] });
    t.connect();
    t.advance(60_000);
    expect(t.events).toHaveLength(0);
    expect(t.market.getState('AAPL')?.tradeCount ?? 0).toBe(0);
  });

  it('evaluates delayed trades (they are still new trades)', () => {
    const t = setup({ sim: { feedScenario: 'delayed' }, alerts: [alert({ targetPrice: 1 })] });
    t.connect();
    t.advance(100);
    expect(t.events).toHaveLength(1);
  });

  it('evaluates every enabled alert on the symbol independently', () => {
    const t = setup({
      alerts: [
        alert({ id: 'up', targetPrice: 100 }),
        alert({ id: 'down', condition: 'below', targetPrice: 90 }),
        alert({ id: 'off', targetPrice: 50, enabled: false }),
        alert({ id: 'other', symbol: 'MSFT', targetPrice: 1 }),
      ],
      prices: { AAPL: [101, 89] },
      random: () => 0,
    });
    t.connect();
    // Upstream is AAPL and MSFT; random 0 always trades the first one (AAPL).
    t.advance(200);
    expect(t.events.map((e) => e.alertId)).toEqual(['up', 'down']);
    expect(t.repo.getAlert('off')?.triggerCount).toBe(0);
  });

  it('picks up alert changes made through the API immediately', async () => {
    const t = setup({ prices: { AAPL: [150, 150, 150, 150] } });
    const api = createMockApi({ repo: t.repo, market: t.market, simulation: t.simulation });
    t.simulation.patch({ apiLatencyMs: 0 });
    t.connect();
    const created = await api.createAlert({
      symbol: 'AAPL',
      condition: 'above',
      targetPrice: 120,
      tag: 'buy',
    });
    expect(t.rt.getUpstreamSubscriptions().has('AAPL')).toBe(true);
    t.advance(100);
    expect(t.events).toHaveLength(1);
    // Editing the target re-arms; the next satisfied trade fires again.
    await api.updateAlert(created.id, { targetPrice: 140 });
    t.advance(100);
    expect(t.events).toHaveLength(2);
    // Disabling stops evaluation and upstream interest.
    await api.updateAlert(created.id, { enabled: false });
    expect(t.rt.getUpstreamSubscriptions().has('AAPL')).toBe(false);
  });

  it('keeps the persisted armed state across a restart (new repo, api and realtime on the same storage)', async () => {
    const first = setup({
      repo: createRepository({ seed: () => ({ watchlists: [], alerts: [alert({ targetPrice: 1 })] }) }),
    });
    first.connect();
    first.advance(100);
    expect(first.events).toHaveLength(1);
    first.rt.disconnect();

    const repo = createRepository();
    expect(repo.getAlert('a1')).toMatchObject({ armed: false, triggerCount: 1 });
    const second = setup({ repo });
    second.connect();
    second.advance(5000);
    expect(second.events).toHaveLength(0);
    expect(repo.getAlert('a1')?.triggerCount).toBe(1);

    // The restarted API re-arms on edit, and the restarted realtime fires on the next trade.
    const api = createMockApi({ repo, market: second.market, simulation: second.simulation });
    second.simulation.patch({ apiLatencyMs: 0 });
    await api.updateAlert('a1', { targetPrice: 2 });
    second.advance(100);
    expect(second.events).toHaveLength(1);
    expect(repo.getAlert('a1')?.triggerCount).toBe(2);
  });

  it('fires the seeded near alerts within a minute of demo time at default settings', () => {
    const repo = createRepository();
    const t = setup({ repo, sim: { ticksPerSecond: 12 }, random: Math.random });
    t.rt.setSubscriptions(['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX']);
    t.connect();
    t.advance(60_000);
    const fired = new Set(t.events.map((e) => e.alertId));
    expect(fired.has('alert-seed-nvda')).toBe(true);
    expect(fired.has('alert-seed-tsla')).toBe(true);
    expect(fired.has('alert-seed-aapl')).toBe(false);
    expect(fired.has('alert-seed-msft')).toBe(false);
    expect(repo.getAlert('alert-seed-aapl')?.armed).toBe(true);
  });
});

describe('re-entrant listeners', () => {
  it('a connection listener that disconnects on "connected" leaves no timers and no snapshot', () => {
    const t = setup();
    t.rt.setSubscriptions(['AAPL']);
    t.rt.onConnection((info) => {
      if (info.state === 'connected') t.rt.disconnect();
    });
    t.connect();
    expect(t.rt.getConnection().state).toBe('disconnected');
    expect(vi.getTimerCount()).toBe(0);
    expect(t.batches).toHaveLength(0);
  });

  it('a connection listener that disconnects on "reconnecting" leaves no retry timer', () => {
    const t = setup({ sim: { feedScenario: 'disconnected' } });
    t.rt.onConnection((info) => {
      if (info.state === 'reconnecting') t.rt.disconnect();
    });
    t.connect();
    expect(t.rt.getConnection().state).toBe('disconnected');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a connection listener that disconnects on "connecting" leaves no connect timer', () => {
    const t = setup();
    t.rt.onConnection((info) => {
      if (info.state === 'connecting') t.rt.disconnect();
    });
    t.rt.connect();
    expect(vi.getTimerCount()).toBe(0);
    t.advance(1000);
    expect(t.rt.getConnection().state).toBe('disconnected');
  });

  it('an alert listener that disconnects stops further evaluation and trading', () => {
    const t = setup({
      alerts: [alert({ id: 'first', targetPrice: 1 }), alert({ id: 'second', targetPrice: 1 })],
      sim: { ticksPerSecond: 50 },
    });
    t.rt.onAlert(() => {
      t.rt.disconnect();
    });
    t.connect();
    t.advance(100);
    expect(t.events.map((e) => e.alertId)).toEqual(['first']);
    expect(t.repo.getAlert('second')?.triggerCount).toBe(0);
    expect(t.market.getState('AAPL')!.tradeCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('delayed relabeling', () => {
  it('shifts the real trade time once and restores it, even for a symbol that never traded', () => {
    // random() = 0 always trades the first upstream symbol (AAPL), so MSFT never trades.
    const t = setup({ sim: { feedScenario: 'stale' } });
    t.rt.setSubscriptions(['AAPL', 'MSFT']);
    t.connect();
    const real = t.lastQuote('MSFT')!.lastTradeAt!;
    t.simulation.patch({ feedScenario: 'delayed' });
    t.advance(FLUSH_INTERVAL_MS);
    expect(t.lastQuote('MSFT')).toMatchObject({ status: 'delayed', lastTradeAt: real - DELAYED_FEED_MS });
    t.simulation.patch({ feedScenario: 'live' });
    t.advance(FLUSH_INTERVAL_MS);
    expect(t.lastQuote('MSFT')).toMatchObject({ status: 'live', lastTradeAt: real });
    expect(t.market.getState('MSFT')!.tradeCount).toBe(0);
    expect(t.market.getState('AAPL')!.tradeCount).toBeGreaterThan(0);
  });
});

describe('listener isolation', () => {
  it('a throwing listener does not stop other listeners or the feed', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const t = setup();
    t.rt.onQuotes(() => {
      throw new Error('boom');
    });
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    t.advance(1000);
    expect(t.batches.length).toBeGreaterThan(1);
    expect(errors).toHaveBeenCalled();
  });

  it('unsubscribed listeners stop receiving', () => {
    const t = setup();
    const received: number[] = [];
    const off = t.rt.onQuotes(() => received.push(1));
    t.rt.setSubscriptions(['AAPL']);
    t.connect();
    off();
    t.advance(2000);
    expect(received).toHaveLength(1);
  });
});
