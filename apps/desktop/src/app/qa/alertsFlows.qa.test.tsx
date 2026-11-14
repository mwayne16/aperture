import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type * as LightweightCharts from 'lightweight-charts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { resetDemoData } from '../../data/dataLayer';
import { getQuote } from '../../data/quoteStore';
import { updateSimulation } from '../../data/simulationStore';
import { useAlertStore } from '../../features/alerts/alertStore';
import { useNotificationStore } from '../../features/notifications/notificationStore';
import { DEFAULT_SETTINGS } from '../../features/settings/settingsRules';
import { useSettingsStore } from '../../features/settings/settingsStore';
import { resetShellStores } from '../../features/shell/testUtils';
import { useWatchlistStore } from '../../features/watchlists/watchlistStore';
import { useUiStore } from '../uiStore';

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof LightweightCharts>();
  const mock = await import('../../features/details/chartMock');
  return { ...actual, createChart: mock.createChart };
});

/**
 * Alerts end to end on the real mock data layer: the dialog, the alerts page, server-side evaluation
 * in the mock realtime, trigger toasts, the trigger history and the notification inbox, as a user
 * drives them across pages in the full app.
 */

// ** fireEvent rather than user-event: Testing Library's async wrapper waits on a timer that the fake
// clock never runs. The Menu wrapper opens on a detail-0 click, like a screen reader activation.

let clock = Math.ceil(Date.now() / 1000) * 1000;

beforeEach(async () => {
  // Flows start on the watchlist page, where the quote table and its row menus live.
  window.location.hash = '#/watchlist';
  // ** Each test starts an hour after the previous one, so trade times the shared mock market kept
  // from earlier tests are always in the past.
  clock += 3_600_000;
  vi.useFakeTimers({ now: clock });
  resetShellStores();
  useNotificationStore.setState({ notifications: [] });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  updateSimulation({ apiLatencyMs: 0 });
  await resetDemoData();
  act(() => {
    dismissAllToasts();
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetShellStores();
  useNotificationStore.setState({ notifications: [] });
  act(() => {
    dismissAllToasts();
  });
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Mounts the app on the seeded data and lets the feed connect, load and trade for a moment. */
async function startApp() {
  const view = render(<App />);
  await advance(2000);
  return view;
}

/** Navigates the way a typed URL or a bookmark would. */
async function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
    // ** jsdom queues hashchange on a real timer, which the fake clock never runs.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await advance(300);
}

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);
const dialog = () => screen.getByRole('dialog');
const field = (name: string) => within(dialog()).getByRole('textbox', { name });
const alertsTab = () => screen.getByRole('tab', { name: /^Alerts/ });
const alertFor = (symbol: string) => useAlertStore.getState().alerts.find((a) => a.symbol === symbol);
const eventsFor = (alertId: string) => useAlertStore.getState().events.filter((e) => e.alertId === alertId);
const alertsTable = () => screen.getByRole('table', { name: 'Price alerts' });
const inbox = () => useNotificationStore.getState().notifications;

function alertRow(symbol: string): HTMLElement {
  const row = within(alertsTable()).getByRole('link', { name: `${symbol}, open symbol page` }).closest('tr');
  if (!row) throw new Error(`No alert row for ${symbol}`);
  return row;
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

// ** findByRole polls on timers the fake clock never runs, so advance once and query synchronously.
async function chooseMenuItem(trigger: HTMLElement, item: string) {
  fireEvent.click(trigger);
  await advance(0);
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

async function submitDialog(label: string) {
  fireEvent.click(within(dialog()).getByRole('button', { name: label }));
  await advance(0);
}

/** Opens the alerts page's New alert dialog and creates an alert for `symbol`. */
async function createAlert(
  symbol: string,
  targetPrice: number,
  options: { condition?: 'Above (≥)' | 'Below (≤)'; enabled?: boolean } = {},
) {
  if (window.location.hash !== '#/alerts') await goTo('#/alerts');
  fireEvent.click(screen.getByRole('button', { name: 'New alert' }));
  type(field('Symbol'), symbol);
  if (options.condition) fireEvent.click(within(dialog()).getByRole('radio', { name: options.condition }));
  type(field('Target price'), targetPrice.toFixed(2));
  if (options.enabled === false) fireEvent.click(within(dialog()).getByRole('switch', { name: 'Enabled' }));
  await submitDialog('Create alert');
  const alert = alertFor(symbol);
  if (!alert) throw new Error(`The ${symbol} alert was not created`);
  return alert;
}

/** Advances the feed in steps until `done` holds or `maxMs` passes, checking `invariant` after each step. */
async function runFeedUntil(done: () => boolean, maxMs: number, invariant: () => void = () => undefined) {
  for (let elapsed = 0; elapsed < maxMs && !done(); elapsed += 250) {
    await advance(250);
    invariant();
  }
}

/** Removes a symbol with its row menu on the watchlist page, which drops its quotes unless something else needs them. */
async function removeFromWatchlist(symbol: string) {
  if (window.location.hash !== '#/watchlist') await goTo('#/watchlist');
  await chooseMenuItem(screen.getByRole('button', { name: `More actions for ${symbol}` }), 'Remove from watchlist');
  await advance(500);
}

/** Empties the watchlist in one step, so only the alerts' symbols keep trading. */
async function emptyWatchlist() {
  const { watchlist, removeSymbol } = useWatchlistStore.getState();
  await act(async () => {
    await Promise.all((watchlist?.symbols ?? []).map((symbol) => removeSymbol(symbol)));
  });
  await advance(500);
}

/** The unread count the top bar bell announces, or null when nothing is unread. */
function unreadBadge(): string | null {
  const bell = screen.getByRole('link', { name: /^Notifications/ });
  return /, (\d+) unread$/.exec(bell.getAttribute('aria-label') ?? '')?.[1] ?? null;
}

describe('alerts end to end (QA)', () => {
  it('creates an alert from a watchlist row that triggers once, with one toast, one history entry and one notification', async () => {
    await startApp();
    const last = getQuote('AMD')?.last ?? Number.NaN;
    const target = Math.floor(last) - 5;

    fireEvent.click(screen.getByRole('button', { name: 'Create alert for AMD' }));
    await advance(0);
    expect(dialog()).toHaveAccessibleName('New alert');
    expect(field('Symbol')).toHaveValue('AMD');
    type(field('Target price'), String(target));
    expect(within(dialog()).getByText(/so this alert triggers on the next trade\.$/)).toBeInTheDocument();
    await submitDialog('Create alert');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const alert = alertFor('AMD');
    await runFeedUntil(() => eventsFor(alert!.id).length > 0, 10_000);
    await advance(2000);
    expect(eventsFor(alert!.id)).toHaveLength(1);
    const title = `AMD above ${target}.00 · Buy`;
    expect(toastTitles().filter((t) => t === title)).toHaveLength(1);

    await goTo('#/alerts');
    expect(alertsTab()).toHaveTextContent('Alerts5');
    expect(within(alertRow('AMD')).getByText('Triggered, waiting to re-arm')).toBeInTheDocument();
    expect(within(alertRow('AMD')).getByText('Met')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /^Trigger history/ }));
    const history = screen.getByRole('table', { name: /Trigger history/ });
    const amdRows = within(history)
      .getAllByRole('row')
      .filter((r) => r.textContent.includes('AMD'));
    expect(amdRows).toHaveLength(1);
    expect(amdRows[0]).toHaveTextContent(`Last above${target}.00`);

    expect(inbox().filter((n) => n.title === title)).toHaveLength(1);
    expect(inbox().find((n) => n.title === title)?.symbol).toBe('AMD');
  });

  it('re-arms after the price leaves the condition and fires again, keeping one toast per alert', async () => {
    await startApp();
    const last = getQuote('AMD')?.last ?? Number.NaN;
    // ** An empty watchlist leaves fewer symbols trading, so AMD trades often and hovers around its target.
    await emptyWatchlist();
    const created = await createAlert('AMD', last);
    const armedHistory: boolean[] = [created.armed];
    const off = useAlertStore.subscribe((s) => {
      const armed = s.alerts.find((a) => a.id === created.id)?.armed;
      if (armed !== undefined && armed !== armedHistory[armedHistory.length - 1]) armedHistory.push(armed);
    });
    const amdToasts = () => toastTitles().filter((t) => t.startsWith('AMD above'));
    try {
      await runFeedUntil(
        () => eventsFor(created.id).length >= 3,
        240_000,
        () => {
          expect(amdToasts().length).toBeLessThanOrEqual(1);
        },
      );
    } finally {
      off();
    }

    const events = eventsFor(created.id);
    expect(events.length).toBeGreaterThanOrEqual(3);
    // Each trigger disarms the alert, and it re-arms before the next one.
    expect(armedHistory[0]).toBe(true);
    expect(armedHistory.filter((armed) => !armed)).toHaveLength(events.length);
    expect(alertFor('AMD')?.triggerCount).toBe(events.length);
    expect(alertFor('AMD')?.lastTriggeredAt).toBe(events[0]?.triggeredAt);
    // Every trigger lands in the inbox once, however often the toast was replaced.
    expect(inbox().filter((n) => n.title.startsWith('AMD above'))).toHaveLength(events.length);
  });

  it('shows a live simulated price for a typed symbol outside the watchlist, and stops watching it on close', async () => {
    await startApp();
    await removeFromWatchlist('AMD');
    await goTo('#/alerts');
    fireEvent.click(screen.getByRole('button', { name: 'New alert' }));
    type(field('Symbol'), 'amd');
    await advance(1500);
    expect(useUiStore.getState().alertDraftSymbol).toBe('AMD');
    const quote = within(dialog()).getByText(/^Last/).closest('p');
    expect(quote).toHaveTextContent(/^Last \d+\.\d{2}Simulated$/);
    type(field('Target price'), '1');
    expect(within(dialog()).getByText(/^Last is already above 1\.00/)).toBeInTheDocument();

    type(field('Symbol'), 'zzzz');
    await advance(500);
    expect(within(dialog()).getByText('No price data for ZZZZ. Check the symbol.')).toBeInTheDocument();
    expect(within(dialog()).queryByText(/^Last is already/)).not.toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    await advance(500);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useUiStore.getState().alertDraftSymbol).toBeNull();
  });

  it('keeps a current price for a disabled alert after its symbol leaves the watchlist', async () => {
    await startApp();
    await goTo('#/alerts');
    // NVDA is in the watchlist, so it is streamed and its price shows.
    const cell = () => within(alertRow('NVDA')).getAllByRole('cell')[2]!;
    expect(cell()).toHaveTextContent(/^\d+\.\d{2}$/);
    expect(cell().classList.contains('is-muted')).toBe(getQuote('NVDA')?.status !== 'live');

    // NVDA leaves the watchlist and the alert is disabled; the alert alone keeps NVDA subscribed.
    await removeFromWatchlist('NVDA');
    expect(useWatchlistStore.getState().watchlist?.symbols).not.toContain('NVDA');
    const before = getQuote('NVDA')?.updatedAt;
    await advance(15_000);
    expect(getQuote('NVDA')?.updatedAt, 'NVDA quote kept updating').not.toBe(before);
    await goTo('#/alerts');
    expect(cell()).toHaveTextContent(/^\d+\.\d{2}$/);
    // ** A quiet symbol can turn stale on its own; the price is muted exactly when it isn't live.
    expect(cell().classList.contains('is-muted')).toBe(getQuote('NVDA')?.status !== 'live');
  });

  it('creates an alert from the symbol page and lists it on the alerts page', async () => {
    await startApp();
    await goTo('#/symbol/TSLA');
    await advance(1000);
    // The symbol page has one Create alert action, in its header.
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(dialog()).toHaveAccessibleName('New alert');
    expect(field('Symbol')).toHaveValue('TSLA');
    expect(field('Target price')).toHaveFocus();
    type(field('Target price'), '1');
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Below (≤)' }));
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Sell' }));
    await submitDialog('Create alert');
    expect(toastTitles()).toContain('Alert created');

    await goTo('#/alerts');
    expect(alertsTab()).toHaveTextContent('Alerts5');
    const row = within(alertsTable())
      .getAllByRole('row')
      .find((r) => r.textContent.includes('TSLA') && r.textContent.includes('Last ≤ 1.00'));
    expect(row).toBeDefined();
    expect(within(row!).getByText('Sell')).toBeInTheDocument();

    // The symbol link leads back to the symbol page.
    fireEvent.click(within(row!).getByRole('link', { name: 'TSLA, open symbol page' }));
    await advance(300);
    expect(window.location.hash).toBe('#/symbol/TSLA');
  });

  it('re-arms a triggered alert when its target is edited, and replaces its toast when it fires again', async () => {
    await startApp();
    const last = getQuote('AMD')?.last ?? Number.NaN;
    const alert = await createAlert('AMD', Math.floor(last) - 5);
    await runFeedUntil(() => eventsFor(alert.id).length > 0, 10_000);
    expect(within(alertRow('AMD')).getByText('Triggered, waiting to re-arm')).toBeInTheDocument();

    await chooseMenuItem(within(alertRow('AMD')).getByRole('button', { name: /^Actions for AMD/ }), 'Edit');
    expect(within(dialog()).getByText(/This alert has triggered and re-arms once Last moves back below/)).toBeInTheDocument();
    type(field('Target price'), String(Math.floor(last) - 4));
    expect(within(dialog()).getByText(/so this alert triggers on the next trade\.$/)).toBeInTheDocument();
    await submitDialog('Save changes');
    expect(toastTitles()).toContain('Alert updated');

    await runFeedUntil(() => eventsFor(alert.id).length > 1, 10_000);
    expect(eventsFor(alert.id)).toHaveLength(2);
    expect(toastTitles().filter((t) => t.startsWith('AMD above'))).toEqual([
      `AMD above ${Math.floor(last) - 4}.00 · Buy`,
    ]);
    expect(within(alertRow('AMD')).getByText(/· 2×$/)).toBeInTheDocument();
  });

  it('never fires while disabled, and fires on the next trade once re-enabled from the table', async () => {
    await startApp();
    const last = getQuote('AMD')?.last ?? Number.NaN;
    const alert = await createAlert('AMD', Math.floor(last) - 5, { enabled: false });
    expect(toastTitles()).toContain('Alert created');
    await advance(8000);
    expect(eventsFor(alert.id)).toHaveLength(0);
    expect(within(alertRow('AMD')).getByText('Disabled')).toBeInTheDocument();

    fireEvent.click(within(alertRow('AMD')).getByRole('switch', { name: /^Enabled: AMD/ }));
    expect(within(alertRow('AMD')).getByText('Armed')).toBeInTheDocument();
    await runFeedUntil(() => eventsFor(alert.id).length > 0, 10_000);
    expect(eventsFor(alert.id)).toHaveLength(1);
    expect(toastTitles().filter((t) => t.startsWith('AMD above'))).toHaveLength(1);

    fireEvent.click(within(alertRow('AMD')).getByRole('switch', { name: /^Enabled: AMD/ }));
    await advance(0);
    expect(within(alertRow('AMD')).getByText('Disabled')).toBeInTheDocument();
  });

  it('deletes an alert while its trigger toast is showing, keeping the toast and history entry', async () => {
    await startApp();
    const last = getQuote('AMD')?.last ?? Number.NaN;
    const alert = await createAlert('AMD', Math.floor(last) - 5);
    await runFeedUntil(() => eventsFor(alert.id).length > 0, 10_000);
    const trigger = `AMD above ${Math.floor(last) - 5}.00 · Buy`;
    expect(toastTitles()).toContain(trigger);

    await chooseMenuItem(within(alertRow('AMD')).getByRole('button', { name: /^Actions for AMD/ }), 'Delete');
    const confirm = screen.getByRole('dialog', { name: 'Delete alert?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await advance(0);

    expect(within(alertsTable()).queryByText('AMD')).not.toBeInTheDocument();
    expect(alertsTab()).toHaveTextContent('Alerts4');
    expect(toastTitles()).toContain(trigger);
    expect(useToastStore.getState().toasts.filter((t) => t.tone === 'error')).toHaveLength(0);
    await advance(10_000);
    expect(eventsFor(alert.id)).toHaveLength(1);
    expect(alertFor('AMD')).toBeUndefined();
  });

  it('shows the seeded alerts again after Reset demo data in Settings', async () => {
    await startApp();
    await createAlert('AMD', 1);
    await chooseMenuItem(within(alertRow('MSFT')).getByRole('button', { name: /^Actions for MSFT/ }), 'Delete');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete alert?' })).getByRole('button', { name: 'Delete' }));
    await advance(0);
    fireEvent.click(within(alertRow('AAPL')).getByRole('switch', { name: /^Enabled: AAPL/ }));
    await advance(0);
    expect(alertsTab()).toHaveTextContent('Alerts4');

    await goTo('#/settings');
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo data…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reset demo data?' })).getByRole('button', { name: 'Reset demo data' }));
    await advance(500);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toastTitles()).toContain('Demo data reset');

    await goTo('#/alerts');
    expect(alertsTab()).toHaveTextContent('Alerts4');
    const symbols = within(alertsTable())
      .getAllByRole('link', { name: /, open symbol page$/ })
      .map((link) => link.textContent);
    expect(symbols).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA']);
    expect(within(alertRow('AAPL')).getByRole('switch')).toBeChecked();
    expect(within(alertRow('NVDA')).getByRole('switch')).not.toBeChecked();
    expect(within(alertRow('MSFT')).getByText('Never')).toBeInTheDocument();
  });

  it('records triggers and one coalesced entry for a dropped connection in Notifications, with the unread count on the bell', async () => {
    await startApp();
    // ** Startup can leave an entry in the inbox under heavy load, so it starts empty here: every unread
    // count below then comes from this test's own alert and outage.
    act(() => {
      useNotificationStore.setState({ notifications: [] });
    });
    expect(unreadBadge()).toBeNull();
    const last = getQuote('AMD')?.last ?? Number.NaN;
    const alert = await createAlert('AMD', Math.floor(last) - 5);
    await runFeedUntil(() => eventsFor(alert.id).length > 0, 10_000);
    expect(unreadBadge()).toBe('1');

    // The feed drops twice in quick succession: one inbox entry describes both.
    for (let drop = 0; drop < 2; drop++) {
      fireEvent.click(screen.getByRole('button', { name: 'Simulation controls' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Disconnected' }));
      await advance(3000);
      fireEvent.click(screen.getByRole('radio', { name: 'Live' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Simulation controls' })).getByRole('button', { name: 'Done' }));
      await advance(2000);
    }
    const connection = inbox().filter((n) => n.kind === 'connection');
    expect(connection).toHaveLength(1);
    expect(connection[0]).toMatchObject({ title: 'Connection restored', read: false });
    expect(connection[0]?.body).toMatch(/dropped 2 times since .* and is connected again\./);
    expect(unreadBadge()).toBe('2');

    await goTo('#/notifications');
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /^Connection/ }));
    expect(screen.getByText(/dropped 2 times since/)).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /^All/ }));

    const title = `AMD above ${Math.floor(last) - 5}.00 · Buy`;
    fireEvent.click(screen.getByRole('link', { name: title }));
    await advance(300);
    expect(window.location.hash).toBe('#/symbol/AMD');
    expect(unreadBadge()).toBe('1');
  });

  it('stops trigger toasts once they are turned off in Settings, while the inbox keeps every trigger', async () => {
    await startApp();
    await goTo('#/settings');
    fireEvent.click(screen.getByRole('switch', { name: 'Trigger toasts' }));
    expect(useSettingsStore.getState().settings.triggerToasts).toBe(false);

    const last = getQuote('AMD')?.last ?? Number.NaN;
    const alert = await createAlert('AMD', Math.floor(last) - 5);
    await runFeedUntil(() => eventsFor(alert.id).length > 0, 10_000);
    expect(toastTitles().filter((t) => t.startsWith('AMD above'))).toEqual([]);
    expect(inbox().filter((n) => n.title.startsWith('AMD above'))).toHaveLength(1);
  });
});
