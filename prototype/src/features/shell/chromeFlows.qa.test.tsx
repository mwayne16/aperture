import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { ToastViewport } from '../../components/ui/ToastViewport';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { api, resetDemoData } from '../../data/dataLayer';
import { getSimulation, updateSimulation } from '../../data/simulationStore';
import { useAlertStore } from '../alerts/alertStore';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { PrototypeControls } from './PrototypeControls';
import { StatusBar } from './StatusBar';
import { resetShellStores, setConnection } from './testUtils';
import { TopBar } from './TopBar';

/** User flows across the top bar, status bar and simulation controls, as App lays them out. */

function Chrome() {
  return (
    <>
      <header>
        <TopBar />
      </header>
      <footer>
        <StatusBar />
      </footer>
      <PrototypeControls />
      <ToastViewport />
    </>
  );
}

beforeEach(async () => {
  resetShellStores();
  updateSimulation({ apiLatencyMs: 0 });
  await resetDemoData();
});

afterEach(() => {
  vi.useRealTimers();
  resetShellStores();
  act(() => {
    dismissAllToasts();
  });
});

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

function openControls() {
  act(() => {
    useUiStore.getState().setPrototypeControlsOpen(true);
  });
}

/** Replaces both stores' load() with counters, as the reset flow only needs to call them. */
function countLoads() {
  const loads = { watchlists: 0, alerts: 0 };
  act(() => {
    useWatchlistStore.setState({
      load: () => {
        loads.watchlists += 1;
        return Promise.resolve();
      },
    });
    useAlertStore.setState({
      load: () => {
        loads.alerts += 1;
        return Promise.resolve();
      },
    });
  });
  return loads;
}

describe('app chrome flows (QA)', () => {
  it('reaches every top bar control by keyboard and opens the controls with Enter', async () => {
    const user = userEvent.setup();
    render(<Chrome />);
    await user.tab();
    expect(document.activeElement).toHaveTextContent('Simulated data');
    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Search symbols' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.tab();
    const opener = screen.getByRole('button', { name: 'Simulation controls' });
    expect(opener).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Simulation controls' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Live' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('opens the controls from the status bar scenario and returns focus there after Done', async () => {
    const user = userEvent.setup();
    render(<Chrome />);
    const scenarioButton = screen.getByRole('button', { name: 'Scenario: Live' });
    await user.click(scenarioButton);
    const dialog = screen.getByRole('dialog', { name: 'Simulation controls' });
    await user.click(within(dialog).getByRole('radio', { name: 'Stale' }));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(scenarioButton).toHaveFocus();
    expect(scenarioButton).toHaveAccessibleName('Scenario: Stale');
  });

  it('walks every feed scenario with the arrow keys and the status bar follows', async () => {
    const user = userEvent.setup();
    render(<Chrome />);
    openControls();
    expect(screen.getByRole('radio', { name: 'Live' })).toHaveFocus();
    const order = ['delayed', 'stale', 'disconnected', 'flaky', 'live'] as const;
    for (const expected of order) {
      await user.keyboard('{ArrowDown}');
      expect(getSimulation().feedScenario).toBe(expected);
    }
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Scenario: Live' })).toBeInTheDocument();
  });

  it('closes only the reset confirmation on Escape and returns focus to its button', async () => {
    const user = userEvent.setup();
    const loads = countLoads();
    render(<Chrome />);
    openControls();
    const resetButton = screen.getByRole('button', { name: 'Reset demo data…' });
    resetButton.focus();
    await user.keyboard('{Enter}');
    const confirm = screen.getByRole('dialog', { name: 'Reset demo data?' });
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Reset demo data?' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Simulation controls' })).toBeInTheDocument();
    expect(resetButton).toHaveFocus();
    expect(loads).toEqual({ watchlists: 0, alerts: 0 });
    expect(toastTitles()).toEqual([]);
  });

  it('resets by keyboard, reloads both stores, toasts, and can reset again', async () => {
    const user = userEvent.setup();
    const loads = countLoads();
    render(<Chrome />);
    await api.createWatchlist({ name: 'Scratch' });
    openControls();
    const resetButton = screen.getByRole('button', { name: 'Reset demo data…' });
    resetButton.focus();

    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Reset demo data' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(toastTitles()).toEqual(['Demo data reset']);
    });
    expect(screen.queryByRole('dialog', { name: 'Reset demo data?' })).not.toBeInTheDocument();
    expect(resetButton).toHaveFocus();
    expect(loads).toEqual({ watchlists: 1, alerts: 1 });
    expect((await api.listWatchlists()).map((w) => w.name)).not.toContain('Scratch');

    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));
    await waitFor(() => {
      expect(loads).toEqual({ watchlists: 2, alerts: 2 });
    });
    expect(toastTitles()).toEqual(['Demo data reset', 'Demo data reset']);
  });

  it('shows the feed details in the connection tooltip on hover', async () => {
    const user = userEvent.setup();
    render(<Chrome />);
    setConnection({
      state: 'reconnecting',
      reconnectAttempt: 2,
      nextRetryAt: Date.now() + 10_000,
      lastMessageAt: Date.now() - 30_000,
      error: 'Simulated network drop.',
    });
    await user.hover(within(screen.getByRole('banner')).getByRole('status'));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Simulated feed');
    // ** The shared clock can be up to a second behind the moment the connection changed.
    expect(tooltip).toHaveTextContent(/Last message (29|30)s ago/);
    expect(tooltip).toHaveTextContent(/Next retry in (9|10|11)s/);
    expect(tooltip).toHaveTextContent('Simulated network drop.');
  });

  it('keeps both simulated-data markers visible in every connection state', () => {
    render(<Chrome />);
    for (const state of ['connecting', 'connected', 'reconnecting', 'disconnected'] as const) {
      setConnection({ state, reconnectAttempt: state === 'reconnecting' ? 1 : 0 });
      expect(within(screen.getByRole('banner')).getByText('Simulated', { exact: false })).toBeVisible();
      expect(screen.getByText('Simulated data. Not real market prices.')).toBeVisible();
    }
  });

  it('shows the disconnected state before the feed starts', () => {
    render(<Chrome />);
    const banner = within(screen.getByRole('banner'));
    const footer = within(screen.getByRole('contentinfo'));
    expect(banner.getByRole('status')).toHaveTextContent('Disconnected');
    expect(footer.getByText('Disconnected')).toBeInTheDocument();
    expect(footer.getByText('No messages yet')).toBeInTheDocument();
    expect(footer.getByText('0 symbols subscribed')).toBeInTheDocument();
  });

  it('moves the session label from Open to After hours to Closed as the clock ticks', () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-06T15:59:59-05:00') });
    render(<TopBar />);
    expect(screen.getByText('Open')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1010);
    });
    expect(screen.getByText('16:00:00', { exact: false })).toHaveTextContent('16:00:00 ET');
    expect(screen.getByText('After hours')).toBeInTheDocument();
    act(() => {
      vi.setSystemTime(Date.parse('2026-11-06T19:59:59-05:00'));
      vi.advanceTimersByTime(1010);
    });
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });
});
