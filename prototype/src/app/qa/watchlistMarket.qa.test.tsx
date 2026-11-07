import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as LightweightCharts from 'lightweight-charts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { dismissAllToasts } from '../../components/ui/toastStore';
import { api, resetDemoData } from '../../data/dataLayer';
import { parsePersisted, STORAGE_KEY } from '../../data/mock/repository';
import { useQuoteStore } from '../../data/quoteStore';
import { updateSimulation } from '../../data/simulationStore';
import { MAX_WATCHLIST_SYMBOLS } from '../../domain/symbols';
import { resetShellStores } from '../../features/shell/testUtils';

/**
 * Watchlists and the market table together, through the whole app on the real mock data layer:
 * the sidebar picks the list, the table and subscriptions follow it, and changes persist.
 */

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof LightweightCharts>();
  const mock = await import('../../features/details/chartMock');
  return { ...actual, createChart: mock.createChart };
});

const FEED_TIMEOUT = { timeout: 3000 };

const grid = (name: string) => screen.findByRole('grid', { name: `Quotes in ${name}` }, FEED_TIMEOUT);
const rowSymbols = () =>
  [...document.querySelectorAll<HTMLElement>('tr[data-symbol]')].map((r) => r.dataset.symbol);
const row = (symbol: string) => {
  const element = document.querySelector<HTMLElement>(`tr[data-symbol="${symbol}"]`);
  if (!element) throw new Error(`No row for ${symbol}`);
  return element;
};
const listButton = (name: RegExp) => screen.getByRole('button', { name });
const addBox = (name: string) => screen.getByRole('combobox', { name: `Add symbol to ${name}` });
const detailHeading = () =>
  within(screen.getByRole('region', { name: 'Stock details' })).getByRole('heading', { level: 2 });

function persistedSymbols(id: string): string[] | undefined {
  return parsePersisted(localStorage.getItem(STORAGE_KEY), new Date().toISOString())?.watchlists.find(
    (w) => w.id === id,
  )?.symbols;
}

/** Restarts the app the way a reload does: fresh stores, same browser storage. */
function reload(unmount: () => void) {
  unmount();
  resetShellStores();
  updateSimulation({ apiLatencyMs: 0 });
  return render(<App />);
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: label }));
  return screen.findByRole('menu');
}

beforeEach(async () => {
  resetShellStores();
  updateSimulation({ apiLatencyMs: 0 });
  await resetDemoData();
});

afterEach(() => {
  resetShellStores();
  act(() => {
    dismissAllToasts();
  });
});

describe('watchlists and the market table (QA)', () => {
  it('switches the table and the live quotes to the chosen list and restores it after a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await grid('Core Tech');

    await user.click(listButton(/^Index ETFs,/));
    await grid('Index ETFs');
    expect(rowSymbols()).toEqual(['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'XLK', 'XLF']);
    await waitFor(() => {
      for (const symbol of ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'XLK', 'XLF']) {
        expect(useQuoteStore.getState().quotes[symbol]?.last).toEqual(expect.any(Number));
      }
    }, FEED_TIMEOUT);
    await waitFor(() => {
      expect(within(row('SPY')).getByText('Live')).toBeInTheDocument();
    }, FEED_TIMEOUT);

    reload(unmount);
    await grid('Index ETFs');
    expect(listButton(/^Index ETFs,/)).toHaveAttribute('aria-current', 'true');
  });

  it('moves the table to the next list when the active list is deleted, and remembers it', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await grid('Core Tech');

    const menu = await openRowMenu(user, 'Actions for Core Tech');
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete watchlist?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await grid('Index ETFs');
    expect(listButton(/^Index ETFs,/)).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: /^Core Tech,/ })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(persistedSymbols('wl-core-tech')).toBeUndefined();
    });

    reload(unmount);
    await grid('Index ETFs');
  });

  it('keeps an order changed through the row menu, and a removal, across a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await grid('Core Tech');
    await user.click(listButton(/^Financials,/));
    await grid('Financials');

    let menu = await openRowMenu(user, 'Actions for BAC');
    await user.click(within(menu).getByRole('menuitem', { name: 'Move up' }));
    menu = await openRowMenu(user, 'Actions for GS');
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove from watchlist' }));

    const expected = ['BAC', 'JPM', 'MS', 'V', 'MA', 'BRK.B'];
    expect(rowSymbols()).toEqual(expected);
    await waitFor(() => {
      expect(persistedSymbols('wl-financials')).toEqual(expected);
    });

    reload(unmount);
    await grid('Financials');
    expect(rowSymbols()).toEqual(expected);
  });

  it('adds with Shift+Enter in the top bar to the list that is active now', async () => {
    const user = userEvent.setup();
    render(<App />);
    await grid('Core Tech');
    await user.click(listButton(/^Index ETFs,/));
    await grid('Index ETFs');

    const search = screen.getByRole('combobox', { name: 'Search symbols' });
    await user.type(search, 'intc');
    await screen.findByRole('option', { name: /^INTC, Intel/ }, FEED_TIMEOUT);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    await waitFor(() => {
      expect(rowSymbols()).toContain('INTC');
    });
    expect(await screen.findByText('Added INTC to Index ETFs')).toBeInTheDocument();
    expect(persistedSymbols('wl-core-tech')).not.toContain('INTC');
  });

  it('explains duplicates, bad symbols and a failed save in the add box, then saves on retry', async () => {
    const user = userEvent.setup();
    render(<App />);
    await grid('Core Tech');
    await user.click(listButton(/^Financials,/));
    await grid('Financials');
    const box = addBox('Financials');

    await user.type(box, 'jpm{Enter}');
    expect(
      await screen.findByText('JPM is already in this watchlist.', { selector: 'p' }),
    ).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, '12{Enter}');
    expect(await screen.findByText(/^Use 1-5 letters/, { selector: 'p' })).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, 'intc');
    await screen.findByRole('option', { name: /^INTC, Intel/ }, FEED_TIMEOUT);
    updateSimulation({ failNextApiCall: true });
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/temporarily unavailable/, { selector: 'p' })).toBeInTheDocument();
    expect(box).toHaveValue('intc');
    expect(rowSymbols()).not.toContain('INTC');

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(rowSymbols()).toContain('INTC');
    });
    expect(box).toHaveValue('');
  });

  it('refuses to add to a full list in the add box and the top bar', async () => {
    const full = await api.createWatchlist({ name: 'Full' });
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < MAX_WATCHLIST_SYMBOLS; i++) {
      await api.addSymbol(full.id, `Q${letters[Math.floor(i / 26)] ?? 'Z'}${letters[i % 26] ?? 'Z'}`);
    }
    localStorage.setItem('aperture.activeWatchlist', full.id);
    const user = userEvent.setup();
    render(<App />);
    await grid('Full');
    expect(rowSymbols()).toHaveLength(MAX_WATCHLIST_SYMBOLS);

    await user.type(addBox('Full'), 'nvda{Enter}');
    expect(
      await screen.findByText('This watchlist is full (100 symbols max).', { selector: 'p' }),
    ).toBeInTheDocument();

    await user.type(screen.getByRole('combobox', { name: 'Search symbols' }), 'nvda');
    await screen.findByRole('option', { name: /^NVDA, NVIDIA/ }, FEED_TIMEOUT);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(
      await screen.findByText('This watchlist is full (100 symbols max).', { selector: '.ui-toast__title' }),
    ).toBeInTheDocument();
    expect(rowSymbols()).toHaveLength(MAX_WATCHLIST_SYMBOLS);
  });

  it('drives the detail panel from row clicks and the arrow keys', async () => {
    const user = userEvent.setup();
    render(<App />);
    await grid('Core Tech');

    await user.click(within(row('MSFT')).getByText('MSFT'));
    expect(detailHeading()).toHaveTextContent('MSFT');
    expect(row('MSFT')).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(detailHeading()).toHaveTextContent('NVDA');
    expect(row('NVDA')).toHaveFocus();
    await user.keyboard('{End}');
    expect(detailHeading()).toHaveTextContent('NFLX');
    await user.keyboard('{Home}');
    expect(detailHeading()).toHaveTextContent('AAPL');
    expect(row('AAPL')).toHaveAttribute('aria-selected', 'true');
  });
});
