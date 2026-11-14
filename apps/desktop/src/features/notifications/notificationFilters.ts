import type { AppNotification, NotificationKind } from './notificationRules';

export type NotificationFilter = 'all' | NotificationKind;

export const NOTIFICATION_FILTERS: readonly { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'alert', label: 'Alerts' },
  { value: 'connection', label: 'Connection' },
];

export function filterNotifications(
  notifications: readonly AppNotification[],
  filter: NotificationFilter,
): readonly AppNotification[] {
  return filter === 'all' ? notifications : notifications.filter((n) => n.kind === filter);
}

/** Unread entries under each filter tab. */
export function unreadCounts(notifications: readonly AppNotification[]): Record<NotificationFilter, number> {
  const counts: Record<NotificationFilter, number> = { all: 0, alert: 0, connection: 0 };
  for (const n of notifications) {
    if (n.read) continue;
    counts.all += 1;
    counts[n.kind] += 1;
  }
  return counts;
}
