import { create } from 'zustand';

type NotificationKind = 'alert' | 'connection' | 'system';

interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Epoch ms. */
  at: number;
  read: boolean;
  /** Symbol the notification is about, so the inbox can link to its page. */
  symbol: string | null;
}

/** Most notifications kept; older ones drop off the end. */
const MAX_NOTIFICATIONS = 200;

/**
 * In-app notification inbox, newest first and unique by id. The notifications feature owns what
 * feeds it (alert triggers, connection changes) and may add persistence.
 */
interface NotificationState {
  notifications: AppNotification[];
  add(notification: Omit<AppNotification, 'read'>): void;
  markRead(id: string): void;
  markAllRead(): void;
  clear(): void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  notifications: [],
  add: (notification) => {
    set((s) =>
      s.notifications.some((n) => n.id === notification.id)
        ? s
        : { notifications: [{ ...notification, read: false }, ...s.notifications].slice(0, MAX_NOTIFICATIONS) },
    );
  },
  markRead: (id) => {
    set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
  },
  markAllRead: () => {
    set((s) => ({ notifications: s.notifications.map((n) => (n.read ? n : { ...n, read: true })) }));
  },
  clear: () => {
    set({ notifications: [] });
  },
}));

export function useUnreadCount(): number {
  return useNotificationStore((s) => s.notifications.reduce((count, n) => (n.read ? count : count + 1), 0));
}
