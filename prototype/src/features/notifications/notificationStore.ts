import { create } from 'zustand';
import {
  normalizeInbox,
  parseStoredInbox,
  serializeInbox,
  type AppNotification,
} from './notificationRules';

export const NOTIFICATIONS_STORAGE_KEY = 'aperture.notifications';

type NewNotification = Omit<AppNotification, 'read'>;

function readStoredInbox(): AppNotification[] {
  try {
    return parseStoredInbox(window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeStoredInbox(notifications: readonly AppNotification[]): void {
  try {
    window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, serializeInbox(notifications));
  } catch {
    // ** Storage can be blocked (private mode, quota). The inbox still works for this session.
  }
}

/**
 * In-app notification inbox, newest first, unique by id and capped. notificationFeed.ts fills it
 * from alert triggers and connection changes. It is saved to localStorage on every change and
 * validated on load, so a corrupt or outdated entry is dropped instead of breaking the page.
 */
interface NotificationState {
  notifications: AppNotification[];
  /** Adds an unread entry unless one with the same id exists, so a re-delivered event is ignored. */
  add(notification: NewNotification): void;
  /** Adds or replaces the entry with this id and marks it unread, e.g. a connection outage that changed. */
  upsert(notification: NewNotification): void;
  markRead(id: string): void;
  markAllRead(): void;
  remove(id: string): void;
  clear(): void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  notifications: readStoredInbox(),
  add: (notification) => {
    set((s) =>
      s.notifications.some((n) => n.id === notification.id)
        ? s
        : { notifications: normalizeInbox([{ ...notification, read: false }, ...s.notifications]) },
    );
  },
  upsert: (notification) => {
    set((s) => ({
      notifications: normalizeInbox([
        { ...notification, read: false },
        ...s.notifications.filter((n) => n.id !== notification.id),
      ]),
    }));
  },
  markRead: (id) => {
    set((s) =>
      s.notifications.some((n) => n.id === id && !n.read)
        ? { notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }
        : s,
    );
  },
  markAllRead: () => {
    set((s) =>
      s.notifications.some((n) => !n.read)
        ? { notifications: s.notifications.map((n) => (n.read ? n : { ...n, read: true })) }
        : s,
    );
  },
  remove: (id) => {
    set((s) =>
      s.notifications.some((n) => n.id === id) ? { notifications: s.notifications.filter((n) => n.id !== id) } : s,
    );
  },
  clear: () => {
    set((s) => (s.notifications.length === 0 ? s : { notifications: [] }));
  },
}));

useNotificationStore.subscribe((state, previous) => {
  if (state.notifications !== previous.notifications) writeStoredInbox(state.notifications);
});

export function useUnreadCount(): number {
  return useNotificationStore((s) => s.notifications.reduce((count, n) => (n.read ? count : count + 1), 0));
}
