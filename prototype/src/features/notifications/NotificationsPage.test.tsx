import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import type { AppNotification } from './notificationRules';
import { NOTIFICATIONS_STORAGE_KEY, useNotificationStore } from './notificationStore';
import { NotificationsPage } from './NotificationsPage';

vi.setConfig({ testTimeout: 20_000 });

interface Fs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as Fs;

const NOW = Date.parse('2026-10-30T18:10:00.000Z');

const seed: AppNotification[] = [
  {
    id: 'alert:e2',
    kind: 'alert',
    title: 'MSFT above 420.00 · Buy',
    body: 'Last trade 420.12 at 14:09:30 ET (simulated)',
    at: NOW - 30_000,
    read: false,
    symbol: 'MSFT',
  },
  {
    id: 'connection:1',
    kind: 'connection',
    title: 'Connection restored',
    body: 'Simulated feed is back after 4s offline (lost at 14:05:00 ET).',
    at: NOW - 5 * 60_000,
    read: false,
    symbol: null,
  },
  {
    id: 'alert:e1',
    kind: 'alert',
    title: 'TSLA below 250.00 · Sell',
    body: 'Last trade 249.90 at 12:10:00 ET (simulated)',
    at: NOW - 2 * 3_600_000,
    read: true,
    symbol: 'TSLA',
  },
];

function renderPage() {
  const user = userEvent.setup();
  const view = render(
    <Router hook={useHashLocation}>
      <NotificationsPage />
    </Router>,
  );
  return { user, ...view };
}

const items = () => within(screen.getByRole('list', { name: /notifications, newest first$/ })).getAllByRole('listitem');
const item = (title: string) => {
  const found = items().find((li) => li.textContent.includes(title));
  if (!found) throw new Error(`No notification "${title}"`);
  return found;
};
const notifications = () => useNotificationStore.getState().notifications;

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  useNotificationStore.setState({ notifications: seed.map((n) => ({ ...n })) });
  useConnectionStore.setState({ connection: { ...INITIAL_CONNECTION, state: 'connected' } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NotificationsPage', () => {
  it('lists entries newest first with relative times, unread styling and a simulated marker', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(items().map((li) => li.querySelector('.notice__time')?.textContent)).toEqual(['30s ago', '5m ago', '2h ago']);
    expect(item('MSFT above')).toHaveClass('is-unread');
    expect(item('MSFT above')).toHaveTextContent(/^Unread: MSFT above 420\.00 · Buy/);
    expect(item('TSLA below')).not.toHaveClass('is-unread');
    expect(within(item('MSFT above')).getByText('Last trade 420.12 at 14:09:30 ET (simulated)')).toBeInTheDocument();
  });

  it('filters by kind, with unread counts on the tabs', async () => {
    const { user } = renderPage();
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveTextContent('All2');
    expect(screen.getByRole('tab', { name: /^Alerts/ })).toHaveTextContent('Alerts1');
    expect(screen.getByRole('tab', { name: /^Connection/ })).toHaveTextContent('Connection1');

    await user.click(screen.getByRole('tab', { name: /^Alerts/ }));
    expect(items()).toHaveLength(2);
    expect(screen.getByRole('tabpanel', { name: 'Alerts' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^Connection/ }));
    expect(items().map((li) => li.querySelector('.notice__title')?.textContent)).toEqual([
      'Unread: Connection restored',
    ]);
  });

  it('opens an alert entry on its symbol page and marks it read', async () => {
    const { user } = renderPage();
    const link = within(item('MSFT above')).getByRole('link', { name: 'MSFT above 420.00 · Buy' });
    expect(link).toHaveAttribute('href', '#/symbol/MSFT');
    await user.click(link);
    expect(window.location.hash).toBe('#/symbol/MSFT');
    expect(notifications().find((n) => n.id === 'alert:e2')?.read).toBe(true);
  });

  it('marks an entry read when it is clicked, or with its Mark as read button', async () => {
    const { user } = renderPage();
    await user.click(within(item('Connection restored')).getByText(/back after 4s/));
    expect(item('Connection restored')).not.toHaveClass('is-unread');

    const markRead = within(item('MSFT above')).getByRole('button', { name: 'Mark as read' });
    await user.click(markRead);
    expect(item('MSFT above')).not.toHaveClass('is-unread');
    expect(within(item('MSFT above')).queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
    expect(within(item('MSFT above')).getByRole('button', { name: 'Remove notification' })).toHaveFocus();
  });

  it('marks all read', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(notifications().every((n) => n.read)).toBe(true);
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveTextContent(/^All$/);
  });

  it('removes one entry and moves focus to the next one', async () => {
    const { user } = renderPage();
    await user.click(within(item('Connection restored')).getByRole('button', { name: 'Remove notification' }));
    expect(items()).toHaveLength(2);
    expect(within(item('TSLA below')).getByRole('button', { name: 'Remove notification' })).toHaveFocus();
  });

  it('clears everything only after confirmation, then shows the empty state', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Clear all…' }));
    const dialog = screen.getByRole('dialog', { name: 'Clear all notifications?' });
    expect(dialog).toHaveAccessibleDescription(/All 3 notifications are removed from this device/);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(items()).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Clear all…' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear all…' })).toBeDisabled();
    expect(screen.getByRole('tabpanel', { name: 'All' })).toHaveFocus();
    expect(JSON.parse(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) ?? '{}')).toEqual({ version: 1, notifications: [] });
  });

  it('shows an empty state for each filter', async () => {
    useNotificationStore.setState({ notifications: [seed[0]!] });
    const { user } = renderPage();
    await user.click(screen.getByRole('tab', { name: /^Connection/ }));
    expect(screen.getByText('No connection notifications')).toBeInTheDocument();
    act(() => {
      useNotificationStore.getState().clear();
    });
    await user.click(screen.getByRole('tab', { name: /^Alerts/ }));
    expect(screen.getByText('No alert notifications')).toBeInTheDocument();
  });

  it('shows new entries as they arrive', () => {
    renderPage();
    act(() => {
      useNotificationStore.getState().add({
        id: 'connection:2',
        kind: 'connection',
        title: 'Connection lost',
        body: 'Simulated feed stopped at 14:10:00 ET.',
        at: NOW,
        symbol: null,
      });
    });
    expect(items()[0]).toHaveTextContent('Connection lost');
    expect(items()[0]?.querySelector('.notice__time')?.textContent).toBe('just now');
  });
});

describe('notifications.css', () => {
  it('uses theme tokens only, so both themes work', () => {
    const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
    const css = fs.readFileSync(`${dirname}/notifications.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
  });
});
