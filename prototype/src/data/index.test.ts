import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertEvent } from '../domain/types';
import { useConnectionStore } from './connectionStore';
import * as data from './index';
import { api, getQuote, realtime, resetDemoData, startDataLayer, updateSimulation } from './index';
import { STORAGE_KEY } from './mock/repository';
import { useQuoteStore } from './quoteStore';
import { resetSimulation } from './simulationStore';

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

describe('data layer public surface', () => {
  it('exports exactly the documented runtime names', () => {
    expect(Object.keys(data).sort()).toEqual(
      [
        'ApiError',
        'api',
        'getQuote',
        'isApiError',
        'realtime',
        'resetDemoData',
        'startDataLayer',
        'updateSimulation',
        'useConnection',
        'useQuote',
        'useSimulation',
      ].sort(),
    );
  });

  it('re-exports the shared ApiError class', async () => {
    updateSimulation({ failNextApiCall: true });
    const error = await api.listWatchlists().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(data.ApiError);
    expect(data.isApiError(error)).toBe(true);
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
  it('restores the seeded watchlists and alerts and persists them', async () => {
    await api.deleteWatchlist('wl-core-tech');
    await api.createWatchlist({ name: 'Temporary' });
    await api.deleteAlert('alert-seed-nvda');
    await resetDemoData();
    expect((await api.listWatchlists()).map((w) => w.name)).toEqual([
      'Core Tech',
      'Index ETFs',
      'Financials',
      'Ideas',
    ]);
    expect((await api.listAlerts()).map((a) => a.id)).toContain('alert-seed-nvda');
    expect(localStorage.getItem(STORAGE_KEY)).toContain('Core Tech');
  });
});
