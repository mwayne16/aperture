import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { useTheme } from '../../components/ui/theme';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { api } from '../../data/dataLayer';
import { useQuoteStore } from '../../data/quoteStore';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import type { ConnectionInfo, Quote, Watchlist } from '../../domain/types';
import { useWatchlistStore, type WatchlistState } from '../watchlists/watchlistStore';
import { useInstrumentStore } from './instrumentStore';
import { MarketTable } from './MarketTable';

const initialWatchlists = useWatchlistStore.getState();
const initialUi = useUiStore.getState();

function watchlist(symbols: string[]): Watchlist {
  return { id: 'wl-1', name: 'Core', symbols, createdAt: '', updatedAt: '' };
}

/** Seeds the watchlist store with a list and mock actions that behave like the real optimistic ones. */
function seedWatchlists(patch: Partial<WatchlistState> = {}) {
  const updateSymbols = (symbols: readonly string[]) => {
    useWatchlistStore.setState((s) => ({
      watchlists: s.watchlists.map((w) => (w.id === 'wl-1' ? { ...w, symbols: [...symbols] } : w)),
    }));
  };
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    reorder: vi.fn((_id: string, symbols: readonly string[]) => {
      updateSymbols(symbols);
      return Promise.resolve();
    }),
    removeSymbol: vi.fn((_id: string, symbol: string) => {
      const current = useWatchlistStore.getState().watchlists[0]?.symbols ?? [];
      updateSymbols(current.filter((s) => s !== symbol));
      return Promise.resolve();
    }),
    addSymbol: vi.fn((_id: string, symbol: string) => {
      const current = useWatchlistStore.getState().watchlists[0]?.symbols ?? [];
      updateSymbols([...current, symbol]);
      return Promise.resolve();
    }),
  };
  act(() => {
    useWatchlistStore.setState({
      status: 'ready',
      error: null,
      watchlists: [watchlist(['AAPL', 'MSFT', 'NVDA'])],
      activeId: 'wl-1',
      ...actions,
      ...patch,
    });
  });
  return actions;
}

function setConnection(patch: Partial<ConnectionInfo>) {
  act(() => {
    useConnectionStore.getState().setConnection({ ...INITIAL_CONNECTION, ...patch });
  });
}

function quote(symbol: string, patch: Partial<Quote> = {}): Quote {
  return {
    symbol,
    last: 100,
    lastTradeAt: Date.now(),
    bid: 99.95,
    bidSize: 100,
    ask: 100.05,
    askSize: 100,
    quoteAt: Date.now(),
    open: 99,
    high: 101,
    low: 98,
    prevClose: 98.5,
    volume: 1_000_000,
    change: 1.5,
    changePct: 1.5228,
    status: 'live',
    updatedAt: Date.now(),
    ...patch,
  };
}

function pushQuotes(...quotes: Quote[]) {
  act(() => {
    useQuoteStore.getState().applyBatch(quotes);
  });
}

const row = (symbol: string) => {
  const element = document.querySelector<HTMLTableRowElement>(`tr[data-symbol="${symbol}"]`);
  if (!element) throw new Error(`No row for ${symbol}`);
  return element;
};
const cells = (symbol: string) => [...row(symbol).cells];

beforeEach(() => {
  updateSimulation({ apiLatencyMs: 0 });
  setConnection({ state: 'connected', lastMessageAt: Date.now() });
});

afterEach(() => {
  act(() => {
    useWatchlistStore.setState(initialWatchlists, true);
    useUiStore.setState(initialUi, true);
    useQuoteStore.getState().clear();
    useConnectionStore.getState().setConnection(INITIAL_CONNECTION);
    useInstrumentStore.setState({ entries: {} });
  });
  resetSimulation();
  vi.useRealTimers();
});

describe('MarketTable states', () => {
  it('shows skeleton rows while the watchlists load', () => {
    seedWatchlists({ status: 'loading', watchlists: [], activeId: null });
    render(<MarketTable />);
    expect(screen.getByRole('table', { name: 'Quotes' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading watchlists');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('shows a load error with a Retry that reloads the watchlists', async () => {
    const { load } = seedWatchlists({ status: 'error', error: 'Service unavailable.', watchlists: [], activeId: null });
    render(<MarketTable />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load watchlists");
    expect(alert).toHaveTextContent('Service unavailable.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps showing quotes when a reload fails, with a Retry', async () => {
    const { load } = seedWatchlists({ status: 'error', error: 'Service unavailable.' });
    render(<MarketTable />);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('explains what to do when there is no watchlist', () => {
    seedWatchlists({ watchlists: [], activeId: null });
    render(<MarketTable />);
    expect(screen.getByText('No watchlists yet')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('offers one add box inside the empty state when the watchlist has no symbols', () => {
    seedWatchlists({ watchlists: [watchlist([])] });
    render(<MarketTable />);
    expect(screen.getByText('Core is empty')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Add symbol to Core' })).toBeInTheDocument();
  });

  it('moves focus to the header add box after the first symbol is added from the empty state', async () => {
    const { addSymbol } = seedWatchlists({ watchlists: [watchlist([])] });
    const user = userEvent.setup();
    render(<MarketTable />);
    await user.type(screen.getByRole('combobox', { name: 'Add symbol to Core' }), 'zzzz{Enter}');
    await waitFor(() => {
      expect(addSymbol).toHaveBeenCalledWith('wl-1', 'ZZZZ');
    });
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Add symbol to Core' })).toHaveFocus();
    });
  });
});

describe('MarketTable rows', () => {
  it('renders one row per symbol in watchlist order under a labelled header', () => {
    seedWatchlists();
    render(<MarketTable />);
    expect(screen.getByRole('heading', { name: 'Core' })).toBeInTheDocument();
    expect(screen.getByText('3 symbols')).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    const rows = within(screen.getByRole('grid', { name: 'Quotes in Core' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.dataset.symbol)).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('formats quote values and colors gains and losses', () => {
    seedWatchlists();
    render(<MarketTable />);
    pushQuotes(
      quote('AAPL', { last: 1234.5, change: 1.5, changePct: 0.1217, volume: 4_560_000 }),
      quote('MSFT', { last: 0.5, change: -2, changePct: -0.4, bid: null }),
    );
    const [, last, change, pct, bid, , volume, status] = cells('AAPL');
    expect(last).toHaveTextContent('1,234.50');
    expect(change).toHaveTextContent('+1.50');
    expect(change).toHaveClass('is-gain');
    expect(pct).toHaveTextContent('+0.12%');
    expect(bid).toHaveTextContent('99.95');
    expect(volume).toHaveTextContent('4.56M');
    expect(status).toHaveTextContent('Live');

    const msft = cells('MSFT');
    expect(msft[1]).toHaveTextContent('0.5000');
    expect(msft[2]).toHaveTextContent('−2.00');
    expect(msft[2]).toHaveClass('is-loss');
    expect(msft[4]).toHaveTextContent('—');
  });

  it('shows Waiting until a first quote arrives', () => {
    seedWatchlists();
    render(<MarketTable />);
    expect(cells('NVDA')[7]).toHaveTextContent('Waiting');
    expect(cells('NVDA')[1]).toHaveTextContent('—');
  });

  it('greys stale and unavailable quotes instead of coloring them', () => {
    seedWatchlists();
    render(<MarketTable />);
    pushQuotes(quote('AAPL', { status: 'stale' }), quote('MSFT', { status: 'unavailable', last: null, change: null }));
    expect(row('AAPL')).toHaveClass('is-dimmed');
    expect(cells('AAPL')[2]).not.toHaveClass('is-gain');
    expect(cells('AAPL')[7]).toHaveTextContent('Stale');
    expect(cells('MSFT')[7]).toHaveTextContent('Unavailable');
  });

  it('shows company names from the instrument API, and Unknown symbol for unlisted ones', async () => {
    seedWatchlists({ watchlists: [watchlist(['AAPL', 'ZZZZ'])] });
    render(<MarketTable />);
    expect(await within(row('AAPL')).findByText('Apple Inc.')).toBeInTheDocument();
    expect(await within(row('ZZZZ')).findByText('Unknown symbol')).toBeInTheDocument();
  });

  it('still renders rows when the instrument API fails', async () => {
    const getInstrument = vi.spyOn(api, 'getInstrument').mockRejectedValue(new Error('down'));
    seedWatchlists();
    render(<MarketTable />);
    await waitFor(() => {
      expect(getInstrument).toHaveBeenCalledTimes(3);
    });
    expect(row('AAPL')).toHaveTextContent('AAPL');
  });

  it('flashes the last price up or down when it changes', () => {
    seedWatchlists();
    render(<MarketTable />);
    pushQuotes(quote('AAPL', { last: 100 }));
    expect(cells('AAPL')[1]).not.toHaveClass('flash-up');
    pushQuotes(quote('AAPL', { last: 100.25 }));
    expect(cells('AAPL')[1]).toHaveClass('flash-up');
    pushQuotes(quote('AAPL', { last: 100.1 }));
    expect(cells('AAPL')[1]).toHaveClass('flash-down');
    expect(cells('MSFT')[1]).not.toHaveClass('flash-up');
  });

  it('shows how old the data is and updates it every second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T15:00:00Z'));
    seedWatchlists();
    render(<MarketTable />);
    pushQuotes(quote('AAPL', { lastTradeAt: Date.now() - 3_000 }));
    expect(cells('AAPL')[8]).toHaveTextContent('3s ago');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(cells('AAPL')[8]).toHaveTextContent('5s ago');
  });

  it('loads each company name once, also under StrictMode', async () => {
    const getInstrument = vi.spyOn(api, 'getInstrument');
    seedWatchlists();
    render(
      <StrictMode>
        <MarketTable />
      </StrictMode>,
    );
    expect(await within(row('NVDA')).findByText('NVIDIA Corporation')).toBeInTheDocument();
    expect(getInstrument).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll('tr[data-symbol="AAPL"]')).toHaveLength(1);
  });

  it('keeps colors in CSS classes so a theme switch restyles the table', () => {
    seedWatchlists();
    render(<MarketTable />);
    pushQuotes(quote('AAPL', { change: 1 }), quote('MSFT', { change: -1 }));
    const theme = renderHook(() => useTheme());
    act(() => {
      theme.result.current.setPreference('light');
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(cells('AAPL')[2]).toHaveClass('is-gain');
    expect(cells('MSFT')[2]).toHaveClass('is-loss');
    expect(screen.getByRole('grid').querySelector('[style*="color"]')).toBeNull();
    act(() => {
      theme.result.current.setPreference('dark');
    });
  });
});

describe('MarketTable selection and keyboard', () => {
  it('selects and highlights a row on click', async () => {
    seedWatchlists();
    render(<MarketTable />);
    await userEvent.click(row('MSFT'));
    expect(useUiStore.getState().selectedSymbol).toBe('MSFT');
    expect(row('MSFT')).toHaveAttribute('aria-selected', 'true');
    expect(row('AAPL')).toHaveAttribute('aria-selected', 'false');
  });

  it('puts one row in the tab order and selects it with Enter', async () => {
    seedWatchlists();
    const user = userEvent.setup();
    render(<MarketTable />);
    await user.tab();
    await user.tab();
    expect(row('AAPL')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().selectedSymbol).toBe('AAPL');
  });

  it('moves the selection and focus with the arrow keys, Home and End', async () => {
    seedWatchlists();
    const user = userEvent.setup();
    render(<MarketTable />);
    act(() => {
      row('AAPL').focus();
    });
    await user.keyboard('{ArrowDown}');
    expect(useUiStore.getState().selectedSymbol).toBe('AAPL');
    await user.keyboard('{ArrowDown}');
    expect(useUiStore.getState().selectedSymbol).toBe('MSFT');
    expect(row('MSFT')).toHaveFocus();
    await user.keyboard('{End}');
    expect(row('NVDA')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(useUiStore.getState().selectedSymbol).toBe('NVDA');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(useUiStore.getState().selectedSymbol).toBe('AAPL');
    expect(row('AAPL')).toHaveAttribute('tabindex', '0');
    expect(row('NVDA')).toHaveAttribute('tabindex', '-1');
  });

  it('highlights a symbol selected elsewhere', () => {
    seedWatchlists();
    render(<MarketTable />);
    act(() => {
      useUiStore.getState().selectSymbol('NVDA');
    });
    expect(row('NVDA')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('MarketTable row menu', () => {
  it('opens the create-alert dialog for the row without changing the selection', async () => {
    seedWatchlists();
    const user = userEvent.setup();
    render(<MarketTable />);
    await user.click(screen.getByRole('button', { name: 'Actions for MSFT' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create alert' }));
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'create', presetSymbol: 'MSFT' });
    expect(useUiStore.getState().selectedSymbol).toBeNull();
  });

  it('moves rows and disables moves past the ends', async () => {
    const { reorder } = seedWatchlists();
    const user = userEvent.setup();
    render(<MarketTable />);
    await user.click(screen.getByRole('button', { name: 'Actions for AAPL' }));
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(reorder).toHaveBeenCalledWith('wl-1', ['MSFT', 'AAPL', 'NVDA']);
    expect(row('AAPL').rowIndex).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Actions for NVDA' }));
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(reorder).toHaveBeenLastCalledWith('wl-1', ['MSFT', 'NVDA', 'AAPL']);
  });

  it('removes a symbol and moves focus to the next row', async () => {
    const { removeSymbol } = seedWatchlists();
    const user = userEvent.setup();
    render(<MarketTable />);
    await user.click(screen.getByRole('button', { name: 'Actions for MSFT' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from watchlist' }));
    expect(removeSymbol).toHaveBeenCalledWith('wl-1', 'MSFT');
    expect(document.querySelector('tr[data-symbol="MSFT"]')).toBeNull();
    await waitFor(() => {
      expect(row('NVDA')).toHaveFocus();
    });
  });

  it('moves focus to the add box after removing the last symbol', async () => {
    seedWatchlists({ watchlists: [watchlist(['AAPL'])] });
    const user = userEvent.setup();
    render(<MarketTable />);
    await user.click(screen.getByRole('button', { name: 'Actions for AAPL' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from watchlist' }));
    expect(screen.getByText('Core is empty')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Add symbol to Core' })).toHaveFocus();
    });
  });
});

describe('MarketTable connection notice', () => {
  it('warns that prices may be stale while the feed reconnects, and clears once connected', () => {
    seedWatchlists();
    render(<MarketTable />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    setConnection({
      state: 'reconnecting',
      lastMessageAt: Date.now(),
      reconnectAttempt: 1,
      nextRetryAt: Date.now() + 4_000,
      error: 'Simulated network drop.',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Prices may be stale');
    expect(screen.getByRole('status')).toHaveTextContent('Simulated network drop.');
    expect(screen.getByText('Retrying in 4s')).toBeInTheDocument();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    setConnection({ state: 'connected', lastMessageAt: Date.now() });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
