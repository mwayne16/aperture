import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { realtime } from '../../data/dataLayer';
import type { AlertEvent, ConnectionState } from '../../domain/types';
import { FLAP_WINDOW_MS } from './connectionNotices';
import { startNotificationFeed } from './notificationFeed';
import { useNotificationStore } from './notificationStore';

const event: AlertEvent = {
  id: 'evt-1',
  alertId: 'alert-seed-msft',
  symbol: 'MSFT',
  condition: 'above',
  targetPrice: 200,
  tag: 'buy',
  field: 'last',
  price: 200.12,
  triggeredAt: '2026-10-30T18:05:09.000Z',
};

let alertListeners: Set<(e: AlertEvent) => void>;
const stops: (() => void)[] = [];

function start() {
  const stop = startNotificationFeed();
  stops.push(stop);
  return stop;
}

function emit(e: AlertEvent) {
  for (const listener of alertListeners) listener(e);
}

function setState(state: ConnectionState) {
  useConnectionStore.getState().setConnection({ ...useConnectionStore.getState().connection, state });
}

const inbox = () => useNotificationStore.getState().notifications;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-10-30T18:00:00.000Z') });
  alertListeners = new Set();
  vi.spyOn(realtime, 'onAlert').mockImplementation((listener) => {
    alertListeners.add(listener);
    return () => alertListeners.delete(listener);
  });
  useConnectionStore.setState({ connection: { ...INITIAL_CONNECTION, state: 'connected' } });
  useNotificationStore.setState({ notifications: [] });
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startNotificationFeed', () => {
  it('adds one entry per alert trigger, linking to the symbol, and ignores a re-delivered event', () => {
    start();
    emit(event);
    emit({ ...event });
    expect(inbox()).toEqual([
      {
        id: 'alert:evt-1',
        kind: 'alert',
        title: 'MSFT above 200.00 · Buy',
        body: 'Last trade 200.12 at 14:05:09 ET (simulated)',
        at: Date.parse(event.triggeredAt),
        read: false,
        symbol: 'MSFT',
      },
    ]);
    emit({ ...event, id: 'evt-2', triggeredAt: '2026-10-30T18:06:00.000Z' });
    expect(inbox().map((n) => n.id)).toEqual(['alert:evt-2', 'alert:evt-1']);
  });

  it('drops "(simulated)" once the feed is real, and survives an unreadable trigger time', () => {
    useConnectionStore.setState({ connection: { ...INITIAL_CONNECTION, state: 'connected', simulated: false } });
    start();
    emit({ ...event, triggeredAt: 'not a time' });
    expect(inbox()[0]).toMatchObject({ body: 'Last trade 200.12 at — ET', at: Date.now() });
  });

  it('listens once however many times it is started, and stops after the last teardown', () => {
    const first = start();
    const second = start();
    expect(alertListeners.size).toBe(1);
    emit(event);
    setState('reconnecting');
    expect(inbox()).toHaveLength(2);

    first();
    first();
    expect(alertListeners.size).toBe(1);
    second();
    expect(alertListeners.size).toBe(0);
    emit({ ...event, id: 'evt-late' });
    setState('connected');
    expect(inbox()).toHaveLength(2);
  });

  it('survives a StrictMode-style start, stop, start without duplicate entries', () => {
    start()();
    start();
    emit(event);
    setState('reconnecting');
    expect(inbox().map((n) => n.kind).sort()).toEqual(['alert', 'connection']);
  });

  it('records a lost connection and turns the same entry into a restore', () => {
    start();
    setState('reconnecting');
    expect(inbox()).toMatchObject([{ kind: 'connection', title: 'Connection lost', read: false, symbol: null }]);
    useNotificationStore.getState().markAllRead();

    vi.advanceTimersByTime(4000);
    setState('connected');
    expect(inbox()).toHaveLength(1);
    expect(inbox()[0]).toMatchObject({ title: 'Connection restored', read: false });
    expect(inbox()[0]?.body).toMatch(/back after 4s offline/);
  });

  it('coalesces a flapping connection into one entry, and starts a new one after a stable spell', () => {
    start();
    for (let i = 0; i < 4; i++) {
      setState('reconnecting');
      vi.advanceTimersByTime(4000);
      setState('connected');
      vi.advanceTimersByTime(20_000);
    }
    expect(inbox()).toHaveLength(1);
    expect(inbox()[0]).toMatchObject({ title: 'Connection restored' });
    expect(inbox()[0]?.body).toMatch(/dropped 4 times since/);

    vi.advanceTimersByTime(FLAP_WINDOW_MS);
    setState('reconnecting');
    expect(inbox().map((n) => n.title)).toEqual(['Connection lost', 'Connection restored']);
  });

  it('ignores startup and a deliberate disconnect', () => {
    useConnectionStore.setState({ connection: INITIAL_CONNECTION });
    start();
    setState('connecting');
    setState('connected');
    setState('disconnected');
    expect(inbox()).toEqual([]);
  });

  it('brings back an outage entry the user cleared while it was still going on', () => {
    start();
    setState('reconnecting');
    useNotificationStore.getState().clear();
    setState('connected');
    expect(inbox().map((n) => n.title)).toEqual(['Connection restored']);
  });
});
