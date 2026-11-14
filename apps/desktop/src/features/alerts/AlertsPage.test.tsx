import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { useUiStore } from '../../app/uiStore';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { api } from '../../data/dataLayer';
import { updateSimulation } from '../../data/simulationStore';
import type { AlertEvent } from '../../domain/types';
import { AlertDialogHost } from './AlertDialogHost';
import { AlertsPage } from './AlertsPage';
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

function withRouter(children: ReactNode) {
  return <Router hook={useHashLocation}>{children}</Router>;
}

async function loadAndRender(extra?: ReactNode) {
  await store().load();
  const user = userEvent.setup();
  const view = render(
    withRouter(
      <>
        <AlertsPage />
        {extra}
      </>,
    ),
  );
  return { user, ...view };
}

const table = () => screen.getByRole('table', { name: 'Price alerts' });
const listedSymbols = () =>
  within(table())
    .getAllByRole('link', { name: /, open symbol page$/ })
    .map((link) => link.textContent);

function row(symbol: string) {
  const link = within(table()).getByRole('link', { name: `${symbol}, open symbol page` });
  const tr = link.closest('tr');
  if (!tr) throw new Error(`No row for ${symbol}`);
  return tr;
}

function summaryValue(label: string) {
  const term = within(screen.getByLabelText('Alert summary')).getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent;
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

describe('AlertsPage header and states', () => {
  it('explains how alerts are evaluated, marks the page simulated and offers New alert', async () => {
    const { user } = await loadAndRender();
    expect(screen.getByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    expect(
      screen.getByText(/Alerts are evaluated on the server against the last trade price\./),
    ).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New alert' }));
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'create', presetSymbol: null });
  });

  it('shows a loading placeholder until alerts arrive, with no counts yet', async () => {
    updateSimulation({ apiLatencyMs: 50 });
    const loading = store().load();
    render(withRouter(<AlertsPage />));
    expect(screen.getAllByRole('status').some((s) => s.textContent.includes('Loading alerts…'))).toBe(true);
    expect(screen.getByRole('tab', { name: /^Alerts/ })).toHaveTextContent(/^Alerts$/);
    expect(summaryValue('Active')).toBe('Loading');
    await act(() => loading);
    expect(screen.queryByText('Loading alerts…')).not.toBeInTheDocument();
    expect(table()).toBeInTheDocument();
    expect(summaryValue('Active')).toBe('3');
  });

  it('shows a load error with a Retry that recovers and keeps focus in the panel', async () => {
    updateSimulation({ failNextApiCall: true });
    const { user } = await loadAndRender();
    expect(screen.getByText("Couldn't load alerts")).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Alerts/ })).toHaveTextContent(/^Alerts$/);
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
  });

  it('offers to create the first alert, then returns focus to the header button', async () => {
    vi.spyOn(api, 'listAlerts').mockResolvedValueOnce([]);
    const { user } = await loadAndRender(<AlertDialogHost />);
    expect(screen.getByText('No alerts yet')).toBeInTheDocument();
    const [headerButton, emptyStateButton] = screen.getAllByRole('button', { name: 'New alert' });
    await user.click(emptyStateButton!);
    await user.type(screen.getByRole('textbox', { name: 'Symbol' }), 'AMD');
    await user.type(screen.getByRole('textbox', { name: 'Target price' }), '100');
    await user.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row('AMD')).toBeInTheDocument();
    await waitFor(() => {
      expect(headerButton).toHaveFocus();
    });
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

describe('AlertsPage summary', () => {
  it('counts active, triggered-today and disabled alerts and follows pushed changes', async () => {
    await loadAndRender();
    expect(summaryValue('Active')).toBe('3');
    expect(summaryValue('Triggered today')).toBe('0');
    expect(summaryValue('Disabled')).toBe('1');
    expect(screen.getByText('3 armed · 0 waiting to re-arm')).toBeInTheDocument();

    const msft = store().alerts.find((a) => a.symbol === 'MSFT')!;
    act(() => {
      store().applyServerUpdate({
        ...msft,
        armed: false,
        lastTriggeredAt: new Date().toISOString(),
        triggerCount: 1,
        updatedAt: new Date(Date.parse(msft.updatedAt) + 1).toISOString(),
      });
    });
    expect(summaryValue('Triggered today')).toBe('1');
    expect(screen.getByText('2 armed · 1 waiting to re-arm')).toBeInTheDocument();
  });
});

describe('AlertsPage alert table', () => {
  it('lists each alert with its condition, label and status, sorted by symbol, linking to its symbol page', async () => {
    await loadAndRender();
    expect(screen.getByRole('tab', { name: /^Alerts/ })).toHaveTextContent('Alerts4');
    expect(listedSymbols()).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA']);
    expect(row('AAPL')).toHaveTextContent(/Last ≥ [\d,.]+/);
    expect(row('AAPL')).toHaveTextContent('Armed');
    expect(row('AAPL')).toHaveTextContent('Sell');
    expect(row('NVDA')).toHaveTextContent('Disabled');
    expect(row('NVDA')).toHaveTextContent('Never');
    expect(within(table()).getByRole('link', { name: 'AAPL, open symbol page' })).toHaveAttribute(
      'href',
      '#/symbol/AAPL',
    );
  });

  it('explains that Buy and Sell are labels only', async () => {
    const { user } = await loadAndRender();
    await user.hover(within(row('AAPL')).getByText('Sell'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Label only. Aperture never places trades.');
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

  it('rolls a toggle back with an error toast when the server refuses it', async () => {
    const { user } = await loadAndRender();
    updateSimulation({ failNextApiCall: true });
    const toggle = within(row('AAPL')).getByRole('switch');
    await user.click(toggle);
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
    expect((await api.listAlerts()).find((a) => a.symbol === 'AAPL')?.enabled).toBe(true);
  });

  it('opens the edit dialog from the row menu', async () => {
    const { user } = await loadAndRender();
    await user.click(within(row('TSLA')).getByRole('button', { name: /^Actions for TSLA/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'edit', alertId: 'alert-seed-tsla' });
  });

  it('deletes after confirmation and moves focus to the next row', async () => {
    const { user } = await loadAndRender();
    await user.click(within(row('NVDA')).getByRole('button', { name: /^Actions for NVDA/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete alert?' });
    expect(dialog).toHaveAccessibleDescription(/NVDA Last ≤ [\d,.]+ will stop being monitored/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(listedSymbols()).toEqual(['AAPL', 'MSFT', 'TSLA']);
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
});

describe('AlertsPage filters', () => {
  it('filters by status and by symbol, and clears both from the empty result', async () => {
    const { user } = await loadAndRender();
    await user.click(screen.getByRole('radio', { name: 'Disabled' }));
    expect(listedSymbols()).toEqual(['NVDA']);
    await user.click(screen.getByRole('radio', { name: 'Armed' }));
    expect(listedSymbols()).toEqual(['AAPL', 'MSFT', 'TSLA']);

    await user.type(screen.getByRole('searchbox', { name: 'Filter by symbol' }), 'ms');
    expect(listedSymbols()).toEqual(['MSFT']);
    await user.type(screen.getByRole('searchbox', { name: 'Filter by symbol' }), 'zz');
    expect(screen.getByText('No alerts match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(listedSymbols()).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA']);
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
    expect(screen.getByRole('searchbox', { name: 'Filter by symbol' })).toHaveValue('');
    expect(screen.getByRole('searchbox', { name: 'Filter by symbol' })).toHaveFocus();
  });

  it('keeps a row the user toggled visible until the filters change', async () => {
    const { user } = await loadAndRender();
    await user.click(screen.getByRole('radio', { name: 'Armed' }));
    const toggle = within(row('MSFT')).getByRole('switch');
    await user.click(toggle);
    expect(row('MSFT')).toHaveTextContent('Disabled');
    expect(toggle).toHaveFocus();
    // Flipping it back and forth quickly keeps the same row in place.
    await user.click(toggle);
    await user.click(toggle);
    expect(listedSymbols()).toEqual(['AAPL', 'MSFT', 'TSLA']);

    await user.click(screen.getByRole('radio', { name: 'All' }));
    await user.click(screen.getByRole('radio', { name: 'Armed' }));
    expect(listedSymbols()).toEqual(['AAPL', 'TSLA']);
  });
});

describe('AlertsPage trigger history', () => {
  it('lists triggers newest first, filters them by symbol and clears the history', async () => {
    const { user } = await loadAndRender();
    act(() => {
      store().recordEvent(event('e1', 'NVDA', '2026-10-30T18:05:09.000Z'));
      store().recordEvent(event('e2', 'TSLA', '2026-10-30T18:06:10.000Z'));
    });
    await user.click(screen.getByRole('tab', { name: /Trigger history/ }));
    expect(screen.getByRole('tab', { name: /Trigger history/ })).toHaveTextContent('Trigger history2');
    expect(screen.queryByRole('radio', { name: 'Armed' })).not.toBeInTheDocument();
    const history = screen.getByRole('table', { name: /Trigger history/ });
    const rows = within(history).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Oct 30, 14:06:10',
      'Oct 30, 14:05:09',
    ]);
    expect(rows[0]).toHaveTextContent('TSLALast above100.00100.25Buy');
    expect(within(rows[0]!).getByRole('link', { name: 'TSLA, open symbol page' })).toHaveAttribute(
      'href',
      '#/symbol/TSLA',
    );

    await user.type(screen.getByRole('searchbox', { name: 'Filter by symbol' }), 'nv');
    expect(within(screen.getByRole('table', { name: /Trigger history/ })).getAllByRole('row')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(screen.getByText('No triggers yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear history' })).toBeDisabled();
  });

  it('remembers the selected tab across a visit to another page', async () => {
    const { user, unmount } = await loadAndRender();
    await user.click(screen.getByRole('tab', { name: /Trigger history/ }));
    unmount();
    render(withRouter(<AlertsPage />));
    expect(screen.getByRole('tab', { name: /Trigger history/ })).toHaveAttribute('aria-selected', 'true');
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
