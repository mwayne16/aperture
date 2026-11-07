import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { api } from '../../data/dataLayer';
import { updateSimulation } from '../../data/simulationStore';
import type { AlertEvent } from '../../domain/types';
import { AlertDialogHost } from './AlertDialogHost';
import { AlertsPanel } from './AlertsPanel';
import { useAlertStore } from './alertStore';
import { resetAlertsTestState, setQuote } from './alertsTestHarness';

// ** Multi-step user-event flows can take seconds on a busy machine, and a test that times out
// mid-flow keeps running into the next one.
vi.setConfig({ testTimeout: 20_000 });

interface Fs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as Fs;

const store = () => useAlertStore.getState();

async function loadAndRender() {
  await store().load();
  const user = userEvent.setup();
  const view = render(<AlertsPanel />);
  return { user, ...view };
}

function row(symbol: string, condition: RegExp | string = /./) {
  const rows = screen.getAllByRole('row').filter((r) => {
    const cells = within(r).queryAllByRole('cell');
    return (
      cells.length > 0 &&
      within(r).queryByRole('button', { name: `${symbol}, show details` }) !== null &&
      (typeof condition === 'string' ? r.textContent.includes(condition) : condition.test(r.textContent))
    );
  });
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function event(id: string, symbol: string, triggeredAt: string): AlertEvent {
  return {
    id,
    alertId: 'alert-seed-nvda',
    symbol,
    condition: 'above',
    targetPrice: 100,
    tag: 'buy',
    field: 'last',
    price: 100.25,
    triggeredAt,
  };
}

beforeEach(async () => {
  await resetAlertsTestState();
});

describe('AlertsPanel states', () => {
  it('shows a loading placeholder until alerts arrive', async () => {
    updateSimulation({ apiLatencyMs: 50 });
    const loading = store().load();
    render(<AlertsPanel />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading alerts…');
    // No count until the list is known.
    expect(screen.getByRole('tab', { name: /Alerts/ })).toHaveTextContent(/^Alerts$/);
    await act(() => loading);
    expect(screen.queryByText('Loading alerts…')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Price alerts' })).toBeInTheDocument();
  });

  it('shows a load error with a Retry that recovers and keeps focus in the panel', async () => {
    updateSimulation({ failNextApiCall: true });
    const { user } = await loadAndRender();
    expect(screen.getByText("Couldn't load alerts")).toBeInTheDocument();
    expect(screen.getByText(/temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Alerts/ })).toHaveTextContent(/^Alerts$/);
    updateSimulation({ apiLatencyMs: 20 });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('tabpanel', { name: 'Alerts' })).toHaveFocus();
    expect(await screen.findByRole('table', { name: 'Price alerts' })).toBeInTheDocument();
  });

  it('keeps the list and offers Retry when a refresh fails', async () => {
    const { user } = await loadAndRender();
    updateSimulation({ failNextApiCall: true });
    await act(() => store().load());
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't refresh alerts/);
    expect(row('AAPL')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Alerts' })).toHaveFocus();
  });

  it('offers to create the first alert for the selected symbol', async () => {
    vi.spyOn(api, 'listAlerts').mockResolvedValueOnce([]);
    useUiStore.getState().selectSymbol('AMD');
    const { user } = await loadAndRender();
    expect(screen.getByText('No alerts yet')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'New alert' });
    await user.click(buttons[buttons.length - 1]!);
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'create', presetSymbol: 'AMD' });
  });

  it('returns focus to the dock after creating the first alert from the empty state', async () => {
    vi.spyOn(api, 'listAlerts').mockResolvedValueOnce([]);
    useUiStore.getState().selectSymbol('AMD');
    await store().load();
    const user = userEvent.setup();
    render(
      <>
        <AlertsPanel />
        <AlertDialogHost />
      </>,
    );
    const [barButton, emptyStateButton] = screen.getAllByRole('button', { name: 'New alert' });
    await user.click(emptyStateButton!);
    await user.type(screen.getByRole('textbox', { name: 'Target price' }), '100');
    await user.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row('AMD')).toBeInTheDocument();
    await waitFor(() => {
      expect(barButton).toHaveFocus();
    });
  });

  it('marks the panel as simulated and explains which price is evaluated', async () => {
    await loadAndRender();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(
      screen.getByText(/Alerts are evaluated on the server against the latest trade price \(Last\)\./),
    ).toBeInTheDocument();
  });

  it('warns that prices and triggers may lag while disconnected', async () => {
    await loadAndRender();
    expect(screen.queryByText(/Not connected/)).not.toBeInTheDocument();
    act(() => {
      useConnectionStore.getState().setConnection({ ...INITIAL_CONNECTION, state: 'reconnecting' });
    });
    expect(screen.getByText(/Not connected/)).toBeInTheDocument();
  });
});

describe('AlertsPanel alert table', () => {
  it('lists each alert with its condition, tag and status, sorted by symbol', async () => {
    await loadAndRender();
    expect(screen.getByRole('tab', { name: /Alerts/ })).toHaveTextContent('Alerts4');
    const symbols = screen.getAllByRole('button', { name: /, show details$/ }).map((b) => b.textContent);
    expect(symbols).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA']);
    expect(row('AAPL')).toHaveTextContent(/Last ≥ [\d,.]+/);
    expect(row('AAPL')).toHaveTextContent('Armed');
    expect(row('AAPL')).toHaveTextContent('Sell');
    expect(row('NVDA')).toHaveTextContent(/Last ≤ [\d,.]+/);
    expect(row('NVDA')).toHaveTextContent('Disabled');
    expect(row('NVDA')).toHaveTextContent('Never');
  });

  it('shows the current price and the distance to the target from live quotes', async () => {
    await loadAndRender();
    const target = store().alerts.find((a) => a.symbol === 'AAPL')!.targetPrice;
    setQuote('AAPL', target / 1.25, { change: 1 });
    const cells = within(row('AAPL')).getAllByRole('cell');
    expect(cells[2]).toHaveClass('is-gain');
    expect(cells[3]).toHaveTextContent('+25.00%');
    setQuote('AAPL', target + 1);
    expect(within(row('AAPL')).getAllByRole('cell')[3]).toHaveTextContent('Met');
  });

  it('shows a triggered alert as waiting to re-arm, with its trigger time and count', async () => {
    await loadAndRender();
    const msft = store().alerts.find((a) => a.symbol === 'MSFT')!;
    act(() => {
      store().applyServerUpdate({
        ...msft,
        armed: false,
        lastTriggeredAt: '2026-10-30T18:05:09.000Z',
        triggerCount: 2,
        updatedAt: new Date(Date.parse(msft.updatedAt) + 1).toISOString(),
      });
    });
    expect(row('MSFT')).toHaveTextContent('Triggered, waiting to re-arm');
    expect(row('MSFT')).toHaveTextContent('Oct 30, 14:05:09 · 2×');
  });

  it('disables and re-enables an alert with its switch', async () => {
    const { user } = await loadAndRender();
    const toggle = within(row('MSFT')).getByRole('switch');
    expect(toggle).toHaveAccessibleName(/^Enabled: MSFT Last ≥/);
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(row('MSFT')).toHaveTextContent('Disabled');
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect((await api.listAlerts()).find((a) => a.symbol === 'MSFT')?.enabled).toBe(true);
  });

  it('opens the edit dialog from the row menu', async () => {
    const { user } = await loadAndRender();
    await user.click(within(row('TSLA')).getByRole('button', { name: /^Actions for TSLA/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(useUiStore.getState().alertDialog).toEqual({
      open: true,
      mode: 'edit',
      alertId: 'alert-seed-tsla',
    });
  });

  it('deletes after confirmation and moves focus to the next row', async () => {
    const { user } = await loadAndRender();
    await user.click(within(row('NVDA')).getByRole('button', { name: /^Actions for NVDA/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete alert?' });
    expect(dialog).toHaveAccessibleDescription(/NVDA Last ≤ [\d,.]+ will stop being monitored/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('button', { name: 'NVDA, show details' })).not.toBeInTheDocument();
    expect(within(row('TSLA')).getByRole('button', { name: /^Actions for TSLA/ })).toHaveFocus();
    expect((await api.listAlerts()).some((a) => a.symbol === 'NVDA')).toBe(false);
  });

  it('keeps the alert when the delete is cancelled', async () => {
    const { user } = await loadAndRender();
    await user.click(within(row('NVDA')).getByRole('button', { name: /^Actions for NVDA/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row('NVDA')).toBeInTheDocument();
  });

  it('focuses the empty state after deleting the last alert', async () => {
    const only = (await api.listAlerts()).filter((a) => a.symbol === 'AAPL');
    vi.spyOn(api, 'listAlerts').mockResolvedValueOnce(only);
    const { user } = await loadAndRender();
    await user.click(screen.getByRole('button', { name: /^Actions for AAPL/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('No alerts yet')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'New alert' });
    expect(buttons[buttons.length - 1]).toHaveFocus();
  });

  it('opens the create dialog for the selected symbol', async () => {
    const { user } = await loadAndRender();
    act(() => {
      useUiStore.getState().selectSymbol('GOOGL');
    });
    await user.click(screen.getByRole('button', { name: 'New alert' }));
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'create', presetSymbol: 'GOOGL' });
  });
});

describe('AlertsPanel dock and trigger log', () => {
  it('collapses to the tab bar and expands again from a tab', async () => {
    const { user } = await loadAndRender();
    await user.click(screen.getByRole('button', { name: 'Collapse alerts panel' }));
    expect(useUiStore.getState().bottomDockOpen).toBe(false);
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand alerts panel' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await user.click(screen.getByRole('tab', { name: /Trigger log/ }));
    expect(useUiStore.getState()).toMatchObject({ bottomDockOpen: true, bottomDockTab: 'log' });
    expect(screen.getByRole('tabpanel', { name: 'Trigger log' })).toBeInTheDocument();
  });

  it('lists triggers newest first and clears the log', async () => {
    const { user } = await loadAndRender();
    act(() => {
      store().recordEvent(event('e1', 'NVDA', '2026-10-30T18:05:09.000Z'));
      store().recordEvent(event('e2', 'TSLA', '2026-10-30T18:06:10.000Z'));
    });
    await user.click(screen.getByRole('tab', { name: /Trigger log/ }));
    expect(screen.getByRole('tab', { name: /Trigger log/ })).toHaveTextContent('Trigger log2');
    const rows = within(screen.getByRole('table', { name: /Trigger log/ }))
      .getAllByRole('row')
      .slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Oct 30, 14:06:10',
      'Oct 30, 14:05:09',
    ]);
    expect(rows[0]).toHaveTextContent('TSLALast above100.00100.25Buy');

    await user.click(screen.getByRole('button', { name: 'Clear log' }));
    expect(screen.getByText('No triggers yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear log' })).toBeDisabled();
  });
});

describe('alerts.css', () => {
  it('uses theme tokens only, so both themes work', () => {
    const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
    const css = fs.readFileSync(`${dirname}/alerts.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
  });
});
