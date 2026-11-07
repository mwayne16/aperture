import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { ApiError } from '../../data/api';
import { api, resetDemoData } from '../../data/dataLayer';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import type { AlertEvent, PriceAlert } from '../../domain/types';
import { MAX_ALERT_EVENTS, useAlertStore } from './alertStore';

const store = () => useAlertStore.getState();
const shown = (id: string) => store().alerts.find((a) => a.id === id);
const toasts = () => useToastStore.getState().toasts;

const NVDA = 'alert-seed-nvda';
const MSFT = 'alert-seed-msft';

function later(alert: PriceAlert, patch: Partial<PriceAlert>, ms = 60_000): PriceAlert {
  return { ...alert, ...patch, updatedAt: new Date(Date.parse(alert.updatedAt) + ms).toISOString() };
}

function event(id: string, triggeredAt: string, symbol = 'NVDA'): AlertEvent {
  return {
    id,
    alertId: NVDA,
    symbol,
    condition: 'above',
    targetPrice: 100,
    tag: 'buy',
    field: 'last',
    price: 100.5,
    triggeredAt,
  };
}

async function loaded(): Promise<void> {
  await store().load();
  expect(store().status).toBe('ready');
}

beforeEach(async () => {
  resetSimulation();
  updateSimulation({ apiLatencyMs: 0 });
  await resetDemoData();
  useAlertStore.setState(useAlertStore.getInitialState(), true);
  dismissAllToasts();
});

describe('load', () => {
  it('loads the alerts and reports loading while the request runs', async () => {
    const pending = store().load();
    expect(store().status).toBe('loading');
    await pending;
    expect(store().status).toBe('ready');
    expect(store().error).toBeNull();
    expect(
      store()
        .alerts.map((a) => a.symbol)
        .sort(),
    ).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA']);
  });

  it('shares one request between calls made while it is in flight', async () => {
    const list = vi.spyOn(api, 'listAlerts');
    const first = store().load();
    const second = store().load();
    expect(second).toBe(first);
    await first;
    expect(list).toHaveBeenCalledTimes(1);
    await store().load();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('resolves with an error status when the API fails, and a retry recovers', async () => {
    updateSimulation({ failNextApiCall: true });
    await expect(store().load()).resolves.toBeUndefined();
    expect(store().status).toBe('error');
    expect(store().error).toMatch(/unavailable/i);
    expect(store().alerts).toEqual([]);

    await store().load();
    expect(store().status).toBe('ready');
    expect(store().error).toBeNull();
    expect(store().alerts).toHaveLength(4);
  });

  it('never rejects, even for unexpected or synchronous errors', async () => {
    vi.spyOn(api, 'listAlerts').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(store().load()).resolves.toBeUndefined();
    expect(store()).toMatchObject({ status: 'error', error: "Couldn't load alerts." });
    expect(store().inflightLoad).toBeNull();
  });

  it('keeps a copy pushed during the request when it is newer than the loaded one', async () => {
    await loaded();
    const stale = shown(NVDA)!;
    const pushed = later(stale, { armed: false, triggerCount: 1 });
    vi.spyOn(api, 'listAlerts').mockImplementationOnce(() => {
      store().applyServerUpdate(pushed);
      return Promise.resolve([stale]);
    });
    await store().load();
    expect(store().alerts).toEqual([pushed]);
  });

  it('does not revive an alert deleted while the load was in flight', async () => {
    await loaded();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const snapshot = await api.listAlerts();
    vi.spyOn(api, 'listAlerts').mockImplementationOnce(async () => {
      await gate;
      return snapshot;
    });
    const reload = store().load();
    await store().remove(NVDA);
    release();
    await reload;
    expect(shown(NVDA)).toBeUndefined();
  });
});

describe('create and update', () => {
  it('adds a created alert and returns it', async () => {
    await loaded();
    const created = await store().create({ symbol: 'amd', condition: 'below', targetPrice: 90, tag: 'buy' });
    expect(created).toMatchObject({ symbol: 'AMD', enabled: true, armed: true });
    expect(shown(created.id)).toEqual(created);
  });

  it('rejects with the API validation error and leaves the list alone', async () => {
    await loaded();
    const before = store().alerts;
    const error = await store()
      .create({ symbol: 'AMD', condition: 'above', targetPrice: 0, tag: 'buy' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details.map((d) => d.field)).toEqual(['targetPrice']);
    expect(store().alerts).toBe(before);
  });

  it('replaces the alert with the saved version', async () => {
    await loaded();
    const saved = await store().update(NVDA, { targetPrice: 1234.5, note: null });
    expect(shown(NVDA)).toEqual(saved);
    expect(saved).toMatchObject({ targetPrice: 1234.5, note: null });
  });

  it('drops an alert the server no longer has and still rejects', async () => {
    await loaded();
    await api.deleteAlert(NVDA);
    await expect(store().update(NVDA, { targetPrice: 5 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(shown(NVDA)).toBeUndefined();
  });
});

describe('setEnabled', () => {
  it('shows the change at once and keeps the server copy afterwards', async () => {
    await loaded();
    const pending = store().setEnabled(NVDA, false);
    expect(shown(NVDA)?.enabled).toBe(false);
    await pending;
    expect(shown(NVDA)?.enabled).toBe(false);
    expect((await api.listAlerts()).find((a) => a.id === NVDA)?.enabled).toBe(false);
    expect(toasts()).toEqual([]);
  });

  it('shows a re-enabled alert as armed, as the server re-arms it', async () => {
    await loaded();
    store().applyServerUpdate(later(shown(MSFT)!, { armed: false }, 1));
    const pending = store().setEnabled(MSFT, true);
    expect(shown(MSFT)).toMatchObject({ enabled: true, armed: true });
    await pending;
    expect(shown(MSFT)).toMatchObject({ enabled: true, armed: true });
  });

  it('rolls back and shows an error toast when the server rejects it', async () => {
    await loaded();
    updateSimulation({ failNextApiCall: true });
    const pending = store().setEnabled(NVDA, false);
    expect(shown(NVDA)?.enabled).toBe(false);
    await expect(pending).resolves.toBeUndefined();
    expect(shown(NVDA)?.enabled).toBe(true);
    expect(toasts()).toMatchObject([{ tone: 'error', title: "Couldn't disable the NVDA alert" }]);
  });

  it('lets the newest flip decide when an earlier one fails', async () => {
    await loaded();
    updateSimulation({ failNextApiCall: true });
    const first = store().setEnabled(NVDA, false);
    const second = store().setEnabled(NVDA, true);
    const third = store().setEnabled(NVDA, false);
    await Promise.all([first, second, third]);
    expect(shown(NVDA)?.enabled).toBe(false);
    expect((await api.listAlerts()).find((a) => a.id === NVDA)?.enabled).toBe(false);
    expect(toasts()).toEqual([]);
  });

  it('falls back to the last confirmed state when the newest flip fails', async () => {
    await loaded();
    const first = store().setEnabled(NVDA, false);
    updateSimulation({ failNextApiCall: true });
    const second = store().setEnabled(NVDA, true);
    await Promise.all([first, second]);
    expect(shown(NVDA)?.enabled).toBe(false);
    expect(toasts()).toMatchObject([{ tone: 'error', title: "Couldn't enable the NVDA alert" }]);
  });

  it('does nothing when the alert already has that state', async () => {
    await loaded();
    const update = vi.spyOn(api, 'updateAlert');
    await store().setEnabled(NVDA, true);
    await store().setEnabled('missing', false);
    expect(update).not.toHaveBeenCalled();
  });

  it('removes an alert that was deleted on the server and says so', async () => {
    await loaded();
    await api.deleteAlert(NVDA);
    await store().setEnabled(NVDA, false);
    expect(shown(NVDA)).toBeUndefined();
    expect(toasts()).toMatchObject([{ tone: 'warning', title: 'The NVDA alert no longer exists' }]);
  });

  it('keeps the pending value when the server pushes an older state meanwhile', async () => {
    await loaded();
    const pending = store().setEnabled(NVDA, false);
    store().applyServerUpdate(later(shown(NVDA)!, { enabled: true, armed: false, triggerCount: 1 }, 1));
    expect(shown(NVDA)).toMatchObject({ enabled: false, triggerCount: 1 });
    await pending;
    expect(shown(NVDA)?.enabled).toBe(false);
  });
});

describe('remove', () => {
  it('hides the alert at once and deletes it on the server', async () => {
    await loaded();
    const pending = store().remove(NVDA);
    expect(shown(NVDA)).toBeUndefined();
    await pending;
    expect(shown(NVDA)).toBeUndefined();
    expect((await api.listAlerts()).some((a) => a.id === NVDA)).toBe(false);
  });

  it('restores the alert and shows an error toast when the delete fails', async () => {
    await loaded();
    const order = store().alerts.map((a) => a.id);
    updateSimulation({ failNextApiCall: true });
    await expect(store().remove(NVDA)).resolves.toBeUndefined();
    expect(store().alerts.map((a) => a.id)).toEqual(order);
    expect(toasts()).toMatchObject([{ tone: 'error', title: "Couldn't delete the NVDA alert" }]);
  });

  it('sends one delete for repeated clicks', async () => {
    await loaded();
    const remove = vi.spyOn(api, 'deleteAlert');
    await Promise.all([store().remove(NVDA), store().remove(NVDA)]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('treats an alert already deleted elsewhere as removed', async () => {
    await loaded();
    await api.deleteAlert(NVDA);
    await store().remove(NVDA);
    expect(shown(NVDA)).toBeUndefined();
    expect(toasts()).toEqual([]);
  });
});

describe('applyServerUpdate', () => {
  it('ignores unknown alerts until the list has loaded', async () => {
    const seed = await api.listAlerts();
    const extra = { ...seed[0]!, id: 'alert-new' };
    store().applyServerUpdate(extra);
    expect(store().alerts).toEqual([]);
    await loaded();
    store().applyServerUpdate(extra);
    expect(shown('alert-new')).toEqual(extra);
  });

  it('applies newer updates and ignores older ones', async () => {
    await loaded();
    const current = shown(NVDA)!;
    const newer = later(current, { armed: false, triggerCount: 2 });
    store().applyServerUpdate(newer);
    expect(shown(NVDA)).toEqual(newer);
    store().applyServerUpdate(later(current, { triggerCount: 1 }, 1_000));
    expect(shown(NVDA)).toEqual(newer);
  });

  it('ignores pushes for an alert the user deleted', async () => {
    await loaded();
    const current = shown(NVDA)!;
    await store().remove(NVDA);
    store().applyServerUpdate(later(current, { armed: false }));
    expect(shown(NVDA)).toBeUndefined();
  });
});

describe('trigger events', () => {
  it('keeps events newest first and reports duplicates', () => {
    expect(store().recordEvent(event('e1', '2026-10-30T14:00:00.000Z'))).toBe(true);
    expect(store().recordEvent(event('e3', '2026-10-30T14:02:00.000Z'))).toBe(true);
    expect(store().recordEvent(event('e2', '2026-10-30T14:01:00.000Z'))).toBe(true);
    expect(store().recordEvent(event('e3', '2026-10-30T14:02:00.000Z'))).toBe(false);
    expect(store().events.map((e) => e.id)).toEqual(['e3', 'e2', 'e1']);
  });

  it(`keeps at most ${MAX_ALERT_EVENTS} events`, () => {
    for (let i = 0; i < MAX_ALERT_EVENTS + 5; i++) {
      store().recordEvent(event(`e${i}`, new Date(Date.UTC(2026, 9, 30, 14, 0, i)).toISOString()));
    }
    expect(store().events).toHaveLength(MAX_ALERT_EVENTS);
    expect(store().events[0]?.id).toBe(`e${MAX_ALERT_EVENTS + 4}`);
  });

  it('clears the log', () => {
    store().recordEvent(event('e1', '2026-10-30T14:00:00.000Z'));
    store().clearEvents();
    expect(store().events).toEqual([]);
  });
});
