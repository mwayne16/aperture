import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as LightweightCharts from 'lightweight-charts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { dismissAllToasts } from '../../components/ui/toastStore';
import { api, resetDemoData } from '../../data/dataLayer';
import { parsePersisted, STORAGE_KEY } from '../../data/mock/repository';
import { SEED_WATCHLIST_SYMBOLS } from '../../data/mock/seed';
import { useQuoteStore } from '../../data/quoteStore';
import { updateSimulation } from '../../data/simulationStore';
import { MAX_WATCHLIST_SYMBOLS } from '../../domain/symbols';
import { resetShellStores } from '../../features/shell/testUtils';

/**
 * The watchlist and the market table together, through the whole app on the real mock data layer:
 * the table, the sidebar and the live subscriptions follow the list, and changes persist.
 */

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof LightweightCharts>();
  const mock = await import('../../features/details/chartMock');
  return { ...actual, createChart: mock.createChart };
});

const FEED_TIMEOUT = { timeout: 3000 };

const grid = () => screen.findByRole('grid', { name: 'Quotes in your watchlist' }, FEED_TIMEOUT);
const rowSymbols = () =>
  [...document.querySelectorAll<HTMLElement>('tr[data-symbol]')].map((r) => r.dataset.symbol);
const sidebarSymbols = () =>
  [...document.querySelectorAll<HTMLElement>('[data-watch-symbol]')].map((r) => r.dataset.watchSymbol);
const row = (symbol: string) => {
  const element = document.querySelector<HTMLElement>(`tr[data-symbol="${symbol}"]`);
  if (!element) throw new Error(`No row for ${symbol}`);
  return element;
};
const addBox = () => screen.getByRole('combobox', { name: 'Add symbol to watchlist' });
const detailHeading = () =>
  within(screen.getByRole('region', { name: 'Stock details' })).getByRole('heading', { level: 2 });

function persistedSymbols(): string[] | undefined {
  return parsePersisted(localStorage.getItem(STORAGE_KEY), new Date().toISOString())?.watchlist.symbols;
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
  // These flows run on the watchlist page, where the quote table lives.
  window.location.hash = '#/watchlist';
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

describe('the watchlist and the market table (QA)', () => {
  it('streams live quotes for the watchlist and a symbol added to it, and keeps the list after a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await grid();
    expect(rowSymbols()).toEqual(SEED_WATCHLIST_SYMBOLS);

    await user.type(addBox(), 'spy');
    await screen.findByRole('option', { name: /^SPY, SPDR/ }, FEED_TIMEOUT);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(rowSymbols()).toContain('SPY');
    });
    await waitFor(() => {
      for (const symbol of [...SEED_WATCHLIST_SYMBOLS, 'SPY']) {
        expect(useQuoteStore.getState().quotes[symbol]?.last).toEqual(expect.any(Number));
      }
    }, FEED_TIMEOUT);
    await waitFor(() => {
      expect(within(row('SPY')).getByText('Live')).toBeInTheDocument();
    }, FEED_TIMEOUT);

    reload(unmount);
    await grid();
    expect(rowSymbols()).toEqual([...SEED_WATCHLIST_SYMBOLS, 'SPY']);
  });

  it('keeps a watchlist emptied from the table empty after a reload instead of reseeding it', async () => {
    for (const symbol of SEED_WATCHLIST_SYMBOLS.slice(1)) await api.removeSymbol(symbol);
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await grid();
    expect(rowSymbols()).toEqual(['AAPL']);

    const menu = await openRowMenu(user, 'Actions for AAPL');
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove from watchlist' }));
    expect(await screen.findByText('Your watchlist is empty')).toBeInTheDocument();
    await waitFor(() => {
      expect(persistedSymbols()).toEqual([]);
    });

    reload(unmount);
    expect(await screen.findByText('Your watchlist is empty', {}, FEED_TIMEOUT)).toBeInTheDocument();
    expect(rowSymbols()).toEqual([]);
  });

  it('keeps an order changed through the row menu, and a removal, across a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await grid();

    let menu = await openRowMenu(user, 'Actions for MSFT');
    await user.click(within(menu).getByRole('menuitem', { name: 'Move up' }));
    menu = await openRowMenu(user, 'Actions for NVDA');
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove from watchlist' }));

    const expected = ['MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX'];
    expect(rowSymbols()).toEqual(expected);
    // The sidebar shows the same list as the table.
    expect(sidebarSymbols()).toEqual(expected);
    await waitFor(() => {
      expect(persistedSymbols()).toEqual(expected);
    });

    reload(unmount);
    await grid();
    expect(rowSymbols()).toEqual(expected);
  });

  it('adds with Shift+Enter in the top bar to the watchlist and saves it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await grid();

    const search = screen.getByRole('combobox', { name: 'Search symbols' });
    await user.type(search, 'intc');
    await screen.findByRole('option', { name: /^INTC, Intel/ }, FEED_TIMEOUT);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    await waitFor(() => {
      expect(rowSymbols()).toContain('INTC');
    });
    expect(await screen.findByText('Added INTC to your watchlist')).toBeInTheDocument();
    await waitFor(() => {
      expect(persistedSymbols()?.at(-1)).toBe('INTC');
    });
  });

  it('explains duplicates, bad symbols and a failed save in the add box, then saves on retry', async () => {
    const user = userEvent.setup();
    render(<App />);
    await grid();
    const box = addBox();

    await user.type(box, 'aapl{Enter}');
    expect(
      await screen.findByText('AAPL is already in this watchlist.', { selector: 'p' }),
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

  it('refuses to add to a full watchlist in the add box and the top bar', async () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = SEED_WATCHLIST_SYMBOLS.length; i < MAX_WATCHLIST_SYMBOLS; i++) {
      await api.addSymbol(`Q${letters[Math.floor(i / 26)] ?? 'Z'}${letters[i % 26] ?? 'Z'}`);
    }
    const user = userEvent.setup();
    render(<App />);
    await grid();
    expect(rowSymbols()).toHaveLength(MAX_WATCHLIST_SYMBOLS);

    await user.type(addBox(), 'intc{Enter}');
    expect(
      await screen.findByText('This watchlist is full (100 symbols max).', { selector: 'p' }),
    ).toBeInTheDocument();

    await user.type(screen.getByRole('combobox', { name: 'Search symbols' }), 'intc');
    await screen.findByRole('option', { name: /^INTC, Intel/ }, FEED_TIMEOUT);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(
      await screen.findByText('This watchlist is full (100 symbols max).', { selector: '.ui-toast__title' }),
    ).toBeInTheDocument();
    expect(rowSymbols()).toHaveLength(MAX_WATCHLIST_SYMBOLS);
  });

  it('drives the detail panel from row clicks and the arrow keys', async () => {
    const user = userEvent.setup();
    render(<App />);
    await grid();

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
