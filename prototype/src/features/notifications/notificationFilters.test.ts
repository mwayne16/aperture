import { describe, expect, it } from 'vitest';
import { filterNotifications, unreadCounts } from './notificationFilters';
import type { AppNotification } from './notificationRules';

const list: AppNotification[] = [
  { id: 'a1', kind: 'alert', title: '', body: '', at: 3, read: false, symbol: 'AAPL' },
  { id: 'c1', kind: 'connection', title: '', body: '', at: 2, read: false, symbol: null },
  { id: 'a2', kind: 'alert', title: '', body: '', at: 1, read: true, symbol: 'MSFT' },
];

describe('notification filters', () => {
  it('filters by kind and keeps the order', () => {
    expect(filterNotifications(list, 'all')).toBe(list);
    expect(filterNotifications(list, 'alert').map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(filterNotifications(list, 'connection').map((n) => n.id)).toEqual(['c1']);
  });

  it('counts unread entries per tab', () => {
    expect(unreadCounts(list)).toEqual({ all: 2, alert: 1, connection: 1 });
    expect(unreadCounts([])).toEqual({ all: 0, alert: 0, connection: 0 });
  });
});
