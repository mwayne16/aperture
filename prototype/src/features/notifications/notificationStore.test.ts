import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseStoredInbox, serializeInbox, type AppNotification } from './notificationRules';
import { NOTIFICATIONS_STORAGE_KEY, useNotificationStore, useUnreadCount } from './notificationStore';

type NewNotification = Omit<AppNotification, 'read'>;

function notice(id: string, at: number, patch: Partial<NewNotification> = {}): NewNotification {
  return { id, kind: 'alert', title: id, body: 'Body', at, symbol: 'AAPL', ...patch };
}

const store = () => useNotificationStore.getState();
const ids = () => store().notifications.map((n) => n.id);
const stored = () => parseStoredInbox(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY));

async function reloadStore() {
  vi.resetModules();
  const module = await import('./notificationStore');
  return module.useNotificationStore;
}

beforeEach(() => {
  useNotificationStore.setState({ notifications: [] });
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notificationStore', () => {
  it('adds unread entries newest first and ignores a repeated id', () => {
    store().add(notice('a', 1));
    store().add(notice('b', 2));
    store().add(notice('a', 3, { title: 'again' }));
    expect(ids()).toEqual(['b', 'a']);
    expect(store().notifications.every((n) => !n.read)).toBe(true);
    expect(store().notifications[1]?.title).toBe('a');
  });

  it('places an entry by its time, so a late-arriving event lands below newer ones', () => {
    store().add(notice('new', 20));
    store().add(notice('late', 10));
    expect(ids()).toEqual(['new', 'late']);
  });

  it('upserts an entry in place of the old one, unread and at its new time', () => {
    store().add(notice('outage', 1, { kind: 'connection', title: 'Connection lost', symbol: null }));
    store().add(notice('alert', 2));
    store().markRead('outage');
    store().upsert(notice('outage', 3, { kind: 'connection', title: 'Connection restored', symbol: null }));
    expect(ids()).toEqual(['outage', 'alert']);
    expect(store().notifications[0]).toMatchObject({ title: 'Connection restored', read: false, at: 3 });
  });

  it('marks one entry or all entries read, without new state when nothing changes', () => {
    store().add(notice('a', 1));
    store().add(notice('b', 2));
    store().markRead('a');
    expect(store().notifications.find((n) => n.id === 'a')?.read).toBe(true);
    const before = store().notifications;
    store().markRead('a');
    store().markRead('missing');
    expect(store().notifications).toBe(before);
    store().markAllRead();
    expect(store().notifications.every((n) => n.read)).toBe(true);
    const after = store().notifications;
    store().markAllRead();
    expect(store().notifications).toBe(after);
  });

  it('removes one entry and clears all', () => {
    store().add(notice('a', 1));
    store().add(notice('b', 2));
    store().remove('a');
    expect(ids()).toEqual(['b']);
    store().clear();
    expect(ids()).toEqual([]);
  });

  it('saves every change and restores the inbox after a reload', async () => {
    store().add(notice('a', 1));
    store().add(notice('b', 2, { kind: 'connection', symbol: null }));
    store().markRead('a');
    expect(stored().map((n) => [n.id, n.read])).toEqual([
      ['b', false],
      ['a', true],
    ]);

    const reloaded = await reloadStore();
    expect(reloaded.getState().notifications).toEqual(store().notifications);
  });

  it('starts empty after a reload with corrupt storage, and recovers on the next write', async () => {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, '{"version":1,"notifications":[{"id":');
    const reloaded = await reloadStore();
    expect(reloaded.getState().notifications).toEqual([]);
    reloaded.getState().add(notice('fresh', 5));
    expect(stored().map((n) => n.id)).toEqual(['fresh']);
  });

  it('keeps the valid stored entries when some are malformed', async () => {
    const good = { ...notice('good', 2), read: true };
    localStorage.setItem(
      NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify({ version: 1, notifications: [good, { ...good, id: 'bad', at: 'soon' }] }),
    );
    const reloaded = await reloadStore();
    expect(reloaded.getState().notifications).toEqual([good]);
  });

  it('keeps working in memory when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    store().add(notice('a', 1));
    expect(ids()).toEqual(['a']);

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const reloaded = await reloadStore();
    expect(reloaded.getState().notifications).toEqual([]);
  });

  it('reads an inbox written by this version', async () => {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, serializeInbox([{ ...notice('x', 9), read: false }]));
    const reloaded = await reloadStore();
    expect(reloaded.getState().notifications.map((n) => n.id)).toEqual(['x']);
  });
});

describe('useUnreadCount', () => {
  it('counts unread entries and follows changes', () => {
    const { result } = renderHook(() => useUnreadCount());
    expect(result.current).toBe(0);
    act(() => {
      store().add(notice('a', 1));
      store().add(notice('b', 2));
    });
    expect(result.current).toBe(2);
    act(() => {
      store().markRead('b');
    });
    expect(result.current).toBe(1);
  });
});
