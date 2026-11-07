import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { realtime, startDataLayer } from '../../data/dataLayer';
import type { AlertEvent, PriceAlert } from '../../domain/types';
import { AlertNotifications } from './AlertNotifications';
import { useAlertStore } from './alertStore';
import { resetAlertsTestState } from './alertsTestHarness';

const event: AlertEvent = {
  id: 'evt-1',
  alertId: 'alert-seed-nvda',
  symbol: 'AAPL',
  condition: 'above',
  targetPrice: 200,
  tag: 'buy',
  field: 'last',
  price: 200.12,
  triggeredAt: '2026-10-30T18:05:09.000Z',
};

/** Replaces the realtime alert channels with ones the test can emit on. */
function fakeChannels() {
  const onAlert = new Set<(e: AlertEvent) => void>();
  const onUpdated = new Set<(a: PriceAlert) => void>();
  vi.spyOn(realtime, 'onAlert').mockImplementation((listener) => {
    onAlert.add(listener);
    return () => onAlert.delete(listener);
  });
  vi.spyOn(realtime, 'onAlertUpdated').mockImplementation((listener) => {
    onUpdated.add(listener);
    return () => onUpdated.delete(listener);
  });
  return {
    onAlert,
    onUpdated,
    emitAlert: (e: AlertEvent) => {
      act(() => {
        for (const l of onAlert) l(e);
      });
    },
    emitUpdate: (a: PriceAlert) => {
      act(() => {
        for (const l of onUpdated) l(a);
      });
    },
  };
}

const toasts = () => useToastStore.getState().toasts;

beforeEach(async () => {
  await resetAlertsTestState();
});

describe('AlertNotifications', () => {
  it('subscribes once under StrictMode and toasts each new trigger once', () => {
    const channels = fakeChannels();
    render(
      <StrictMode>
        <AlertNotifications />
      </StrictMode>,
    );
    expect(channels.onAlert.size).toBe(1);
    expect(channels.onUpdated.size).toBe(1);

    channels.emitAlert(event);
    channels.emitAlert({ ...event });
    expect(toasts()).toMatchObject([
      {
        tone: 'info',
        title: 'AAPL above 200.00 · Buy',
        description: 'Last trade 200.12 at 14:05:09 ET (simulated)',
      },
    ]);
    expect(useAlertStore.getState().events.map((e) => e.id)).toEqual(['evt-1']);

    channels.emitAlert({ ...event, id: 'evt-2', alertId: 'alert-seed-tsla', symbol: 'TSLA' });
    expect(toasts()).toHaveLength(2);
  });

  it('keeps one toast per alert, showing its latest trigger, while the log keeps every event', () => {
    const channels = fakeChannels();
    render(<AlertNotifications />);
    channels.emitAlert(event);
    channels.emitAlert({ ...event, id: 'evt-2', price: 200.5, triggeredAt: '2026-10-30T18:05:12.000Z' });
    channels.emitAlert({ ...event, id: 'evt-3', price: 200.75, triggeredAt: '2026-10-30T18:05:15.000Z' });
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.description).toBe('Last trade 200.75 at 14:05:15 ET (simulated)');
    expect(useAlertStore.getState().events.map((e) => e.id)).toEqual(['evt-3', 'evt-2', 'evt-1']);

    // A trigger after the user dismissed the toast shows a fresh one.
    act(dismissAllToasts);
    channels.emitAlert({ ...event, id: 'evt-4', triggeredAt: '2026-10-30T18:05:20.000Z' });
    expect(toasts()).toHaveLength(1);
  });

  it('merges pushed alert state into the store', async () => {
    const channels = fakeChannels();
    await useAlertStore.getState().load();
    render(<AlertNotifications />);
    const nvda = useAlertStore.getState().alerts.find((a) => a.id === 'alert-seed-nvda')!;
    const pushed = {
      ...nvda,
      armed: false,
      triggerCount: 1,
      updatedAt: new Date(Date.parse(nvda.updatedAt) + 1).toISOString(),
    };
    channels.emitUpdate(pushed);
    expect(useAlertStore.getState().alerts.find((a) => a.id === nvda.id)).toEqual(pushed);
  });

  it('stops listening when unmounted', () => {
    const channels = fakeChannels();
    const { unmount } = render(<AlertNotifications />);
    unmount();
    expect(channels.onAlert.size).toBe(0);
    expect(channels.onUpdated.size).toBe(0);
  });
});

describe('AlertNotifications with the simulated feed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies when a seeded demo alert fires on the server', async () => {
    vi.useFakeTimers();
    await useAlertStore.getState().load();
    render(<AlertNotifications />);
    const stop = startDataLayer();
    try {
      for (let i = 0; i < 120 && useAlertStore.getState().events.length === 0; i++) {
        act(() => {
          vi.advanceTimersByTime(500);
        });
      }
      const [first] = useAlertStore.getState().events;
      expect(first).toBeDefined();
      expect(toasts().some((t) => t.title.startsWith(`${first!.symbol} `))).toBe(true);
      const alert = useAlertStore.getState().alerts.find((a) => a.id === first!.alertId);
      expect(alert?.triggerCount).toBeGreaterThan(0);
    } finally {
      act(stop);
    }
  });
});
