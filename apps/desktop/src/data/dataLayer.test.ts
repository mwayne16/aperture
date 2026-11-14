import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertEvent } from '../domain/types';
import { useConnectionStore } from './connectionStore';
import { ApiError, isApiError } from './api';
import * as dataLayer from './dataLayer';
import { api, realtime, resetDemoData, startDataLayer } from './dataLayer';
import { STORAGE_KEY } from './mock/repository';
import { SEED_WATCHLIST_SYMBOLS } from './mock/seed';
import { getQuote, useQuoteStore } from './quoteStore';
import { resetSimulation, updateSimulation } from './simulationStore';

const teardowns: (() => void)[] = [];

function start(): () => void {
  const teardown = startDataLayer();
  teardowns.push(teardown);
  return teardown;
}

beforeEach(async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 21, 15, 0) });
  resetSimulation();
  updateSimulation({ apiLatencyMs: 0 });
  useQuoteStore.getState().clear();
  await resetDemoData();
});

afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  realtime.setSubscriptions([]);
  vi.useRealTimers();
});

describe('data layer module', () => {
  it('exports only its own wiring, not re-exports of the stores or contracts', () => {
    expect(Object.keys(dataLayer).sort()).toEqual(['api', 'realtime', 'resetDemoData', 'startDataLayer']);
  });

  it('rejects API failures with the shared ApiError class', async () => {
    updateSimulation({ failNextApiCall: true });
    const error = await api.getWatchlist().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(isApiError(error)).toBe(true);
  });
});

describe('startDataLayer', () => {
  it('connects and pipes connection info and quotes into the stores', () => {
    start();
    expect(useConnectionStore.getState().connection.state).toBe('connecting');
    vi.advanceTimersByTime(300);
    expect(useConnectionStore.getState().connection).toMatchObject({ state: 'connected', simulated: true });

    realtime.setSubscriptions(['AAPL', 'MSFT']);
    vi.advanceTimersByTime(250);
    expect(getQuote('AAPL')?.status).toBe('live');
    expect(getQuote('msft')?.last).toBeGreaterThan(0);
  });

  it('is idempotent: a second call does not connect again', () => {
    const connect = vi.spyOn(realtime, 'connect');
    start();
    start();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('stops only after every caller tears down, and each teardown is safe to repeat', () => {
    const first = start();
    const second = start();
    vi.advanceTimersByTime(300);
    first();
    first();
    expect(useConnectionStore.getState().connection.state).toBe('connected');
    second();
    expect(useConnectionStore.getState().connection.state).toBe('disconnected');
    expect(vi.getTimerCount()).toBe(0);

    // Quotes no longer reach the store.
    realtime.setSubscriptions(['NVDA']);
    vi.advanceTimersByTime(5000);
    expect(getQuote('NVDA')).toBeUndefined();
  });

  it('restarts cleanly after a full teardown (StrictMode mount, unmount, mount)', () => {
    const connect = vi.spyOn(realtime, 'connect');
    start()();
    start();
    expect(connect).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300);
    expect(useConnectionStore.getState().connection.state).toBe('connected');
  });

  it('follows the simulation store: a forced outage shows as reconnecting', () => {
    start();
    vi.advanceTimersByTime(300);
    updateSimulation({ feedScenario: 'disconnected' });
    expect(useConnectionStore.getState().connection).toMatchObject({
      state: 'reconnecting',
      reconnectAttempt: 1,
    });
    updateSimulation({ feedScenario: 'live' });
    expect(useConnectionStore.getState().connection.state).toBe('connected');
  });

  it('shares one repository between api and realtime: alerts created via api fire on the feed', async () => {
    const events: AlertEvent[] = [];
    const off = realtime.onAlert((e) => events.push(e));
    start();
    vi.advanceTimersByTime(300);
    const created = await api.createAlert({ symbol: 'AMD', condition: 'above', targetPrice: 1, tag: 'buy' });
    vi.advanceTimersByTime(3000);
    off();
    expect(events.some((e) => e.alertId === created.id)).toBe(true);
    const stored = (await api.listAlerts()).find((a) => a.id === created.id);
    expect(stored).toMatchObject({ armed: false, triggerCount: 1 });
  });
});

describe('resetDemoData', () => {
  it('restores the seeded watchlist and alerts and persists them', async () => {
    await api.removeSymbol('AAPL');
    await api.addSymbol('SPY');
    await api.deleteAlert('alert-seed-nvda');
    await resetDemoData();
    expect((await api.getWatchlist()).symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
    expect((await api.listAlerts()).map((a) => a.id)).toContain('alert-seed-nvda');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      version: 2,
      watchlist: { symbols: SEED_WATCHLIST_SYMBOLS },
    });
  });
});
