import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { decodeParam, routes } from '../../app/routes';
import { useUiStore } from '../../app/uiStore';
import { useTheme } from '../../components/ui/theme';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { api } from '../../data/dataLayer';
import { useQuoteStore } from '../../data/quoteStore';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import type { ConnectionInfo, Quote, Watchlist } from '../../domain/types';
import { useInstrumentStore } from '../market/instrumentStore';
import { WatchlistPage } from './WatchlistPage';
import { useWatchlistStore, type WatchlistState } from './watchlistStore';

const initialWatchlists = useWatchlistStore.getState();
const initialUi = useUiStore.getState();

function watchlist(symbols: string[]): Watchlist {
  return { symbols, updatedAt: '' };
}

/** Seeds the watchlist store with a list and mock actions that behave like the real optimistic ones. */
function seedWatchlist(patch: Partial<WatchlistState> = {}) {
  const currentSymbols = () => useWatchlistStore.getState().watchlist?.symbols ?? [];
  const updateSymbols = (symbols: readonly string[]) => {
    useWatchlistStore.setState((s) => ({ watchlist: s.watchlist && { ...s.watchlist, symbols: [...symbols] } }));
  };
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    reorder: vi.fn((symbols: readonly string[]) => {
      updateSymbols(symbols);
      return Promise.resolve();
    }),
    removeSymbol: vi.fn((symbol: string) => {
      updateSymbols(currentSymbols().filter((s) => s !== symbol));
      return Promise.resolve();
    }),
    addSymbol: vi.fn((symbol: string) => {
      updateSymbols([...currentSymbols(), symbol]);
      return Promise.resolve();
    }),
  };
  act(() => {
    useWatchlistStore.setState({
      status: 'ready',
      error: null,
      watchlist: watchlist(['AAPL', 'MSFT', 'NVDA']),
      ...actions,
      ...patch,
    });
  });
  return actions;
}

/** Renders the page at /watchlist, with symbol pages as plain text so navigation shows up. */
function renderPage({ strict = false } = {}) {
  const location = memoryLocation({ path: '/watchlist', record: true });
  const tree = (
    <Router hook={location.hook}>
      <Switch>
        <Route path="/watchlist" component={WatchlistPage} />
        <Route path={routes.symbol}>{(params) => <p>Symbol page {decodeParam(params.symbol)}</p>}</Route>
      </Switch>
    </Router>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return location;
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

/** The row's cells by column. */
const cells = (symbol: string) => {
  const all = [...row(symbol).cells];
  const cell = (index: number) => {
    const found = all[index];
    if (!found) throw new Error(`No cell ${String(index)} for ${symbol}`);
    return found;
  };
  return { last: cell(2), change: cell(3), pct: cell(4), range: cell(5), volume: cell(7), status: cell(8) };
};

const addBox = () => screen.getByRole('combobox', { name: 'Add symbol to watchlist' });
const summary = () => screen.getByRole('region', { name: 'Watchlist summary' });

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

describe('WatchlistPage states', () => {
  it.each(['idle', 'loading'] as const)('shows skeleton rows while the watchlist is %s', (status) => {
    seedWatchlist({ status, watchlist: null });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Watchlist' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Quotes' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading your watchlist');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Watchlist summary' })).not.toBeInTheDocument();
  });

  it('shows a load error with a Retry that reloads the watchlist', async () => {
    const { load } = seedWatchlist({ status: 'error', error: 'Service unavailable.', watchlist: null });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Watchlist' })).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your watchlist");
    expect(alert).toHaveTextContent('Service unavailable.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps showing quotes when a reload fails, with a Retry', async () => {
    const { load } = seedWatchlist({ status: 'error', error: 'Service unavailable.' });
    renderPage();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't refresh your watchlist.");
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with one add box, and its button focuses that box', async () => {
    seedWatchlist({ watchlist: watchlist([]) });
    renderPage();
    expect(screen.getByText('Your watchlist is empty')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Watchlist summary' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add a symbol' }));
    expect(addBox()).toHaveFocus();
  });

  it('keeps focus in the add box after the first symbol is added', async () => {
    const { addSymbol } = seedWatchlist({ watchlist: watchlist([]) });
    const user = userEvent.setup();
    renderPage();
    await user.type(addBox(), 'zzzz{Enter}');
    await waitFor(() => {
      expect(addSymbol).toHaveBeenCalledWith('ZZZZ');
    });
    await waitFor(() => {
      expect(screen.getByRole('grid')).toBeInTheDocument();
    });
    expect(addBox()).toHaveFocus();
  });
});

describe('WatchlistPage header and summary', () => {
  it('counts the symbols and marks the prices as simulated', () => {
    seedWatchlist();
    renderPage();
    expect(screen.getByText('3 of 30 symbols · drag rows to set your order')).toBeInTheDocument();
    expect(screen.getAllByText('Simulated').length).toBeGreaterThan(0);
    expect(screen.getByText(/^Simulated quotes/)).toBeInTheDocument();
  });

  it('shows how many symbols are up and down, and the best and worst today', () => {
    seedWatchlist({ watchlist: watchlist(['AAPL', 'MSFT', 'NVDA', 'TSLA']) });
    renderPage();
    expect(summary()).toHaveTextContent('Waiting for quotes');
    pushQuotes(
      quote('AAPL', { change: 1.5, changePct: 1.5 }),
      quote('MSFT', { change: -2, changePct: -2 }),
      quote('NVDA', { change: 0.5, changePct: 0.5 }),
      // A stale quote describes a market that has moved on, so it is left out.
      quote('TSLA', { change: 9, changePct: 9, status: 'stale' }),
    );
    expect(summary()).toHaveTextContent('2 up');
    expect(summary()).toHaveTextContent('1 down');
    expect(within(summary()).getByRole('link', { name: 'AAPL' })).toBeInTheDocument();
    expect(within(summary()).getByRole('link', { name: 'MSFT' })).toBeInTheDocument();
    expect(summary()).toHaveTextContent('+1.50 · +1.50%');
    expect(summary()).toHaveTextContent('−2.00 · −2.00%');
  });

  it('opens the best symbol from its tile', async () => {
    seedWatchlist();
    const location = renderPage();
    pushQuotes(quote('AAPL', { changePct: 3 }), quote('MSFT', { changePct: 1 }));
    await userEvent.click(within(summary()).getByRole('link', { name: 'AAPL' }));
    expect(location.history.at(-1)).toBe('/symbol/AAPL');
  });

  it('shows the time of the newest quote', () => {
    seedWatchlist();
    renderPage();
    pushQuotes(quote('AAPL', { lastTradeAt: Date.UTC(2026, 10, 13, 15, 4, 5) }));
    expect(screen.getByText('Simulated quotes · as of 10:04:05 ET')).toBeInTheDocument();
  });
});

describe('WatchlistPage rows', () => {
  it('renders one row per symbol in watchlist order', () => {
    seedWatchlist();
    renderPage();
    const rows = within(screen.getByRole('grid', { name: 'Quotes in your watchlist' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.dataset.symbol)).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('formats quote values and colors gains and losses', () => {
    seedWatchlist();
    renderPage();
    pushQuotes(
      quote('AAPL', { last: 1234.5, change: 1.5, changePct: 0.1217, volume: 4_560_000, low: 1220, high: 1240 }),
      quote('MSFT', { last: 0.5, change: -2, changePct: -0.4, low: null }),
      quote('NVDA', { last: 235.12, change: 0.76, changePct: 0.3243 }),
    );
    const aapl = cells('AAPL');
    expect(aapl.last).toHaveTextContent('1,234.50');
    expect(aapl.change).toHaveTextContent('+1.50');
    expect(aapl.change).toHaveClass('is-gain');
    expect(aapl.pct).toHaveTextContent('+0.12%');
    expect(aapl.range).toHaveTextContent('Low 1,220.00, high 1,240.00');
    expect(aapl.volume).toHaveTextContent('4.56M');
    expect(aapl.status).toHaveTextContent('Live');

    // A change prints with the decimals of its price: 4 below a dollar, else 2.
    const msft = cells('MSFT');
    expect(msft.last).toHaveTextContent('0.5000');
    expect(msft.change).toHaveTextContent(/^−2\.0000$/);
    expect(msft.change).toHaveClass('is-loss');
    expect(msft.range).toHaveTextContent('Low —');
    expect(msft.range.querySelector('.day-range__marker')).toBeNull();
    expect(cells('NVDA').change).toHaveTextContent(/^\+0\.76$/);
  });

  it('marks the last price within the day range', () => {
    seedWatchlist();
    renderPage();
    pushQuotes(quote('AAPL', { last: 107.5, low: 100, high: 110 }));
    expect(cells('AAPL').range.querySelector('.day-range__marker')).toHaveStyle({ left: '75%' });
  });

  it('shows Waiting until a first quote arrives', () => {
    seedWatchlist();
    renderPage();
    expect(cells('NVDA').status).toHaveTextContent('Waiting');
    expect(cells('NVDA').last).toHaveTextContent('—');
  });

  it('greys stale and unavailable quotes instead of coloring them', () => {
    seedWatchlist();
    renderPage();
    pushQuotes(quote('AAPL', { status: 'stale' }), quote('MSFT', { status: 'unavailable', last: null, change: null }));
    expect(row('AAPL')).toHaveClass('is-dimmed');
    expect(cells('AAPL').change).not.toHaveClass('is-gain');
    expect(cells('AAPL').status).toHaveTextContent('Stale');
    expect(cells('MSFT').status).toHaveTextContent('Unavailable');
  });

  it('shows company names from the instrument API, and Unknown symbol for unlisted ones', async () => {
    seedWatchlist({ watchlist: watchlist(['AAPL', 'ZZZZ']) });
    renderPage();
    expect(await within(row('AAPL')).findByText('Apple Inc.')).toBeInTheDocument();
    expect(await within(row('ZZZZ')).findByText('Unknown symbol')).toBeInTheDocument();
  });

  it('still renders rows when the instrument API fails', async () => {
    const getInstrument = vi.spyOn(api, 'getInstrument').mockRejectedValue(new Error('down'));
    seedWatchlist();
    renderPage();
    await waitFor(() => {
      expect(getInstrument).toHaveBeenCalledTimes(3);
    });
    expect(row('AAPL')).toHaveTextContent('AAPL');
  });

  it('flashes the last price up or down when it changes', () => {
    seedWatchlist();
    renderPage();
    const t0 = Date.now();
    pushQuotes(quote('AAPL', { last: 100, lastTradeAt: t0 }));
    expect(cells('AAPL').last).not.toHaveClass('flash-up');
    pushQuotes(quote('AAPL', { last: 100.25, lastTradeAt: t0 + 1000 }));
    expect(cells('AAPL').last).toHaveClass('flash-up');
    pushQuotes(quote('AAPL', { last: 100.1, lastTradeAt: t0 + 3000 }));
    expect(cells('AAPL').last).toHaveClass('flash-down');
    expect(cells('MSFT').last).not.toHaveClass('flash-up');
  });

  it('flashes a busy symbol at most once per two seconds of trading, so the price stays readable', () => {
    seedWatchlist();
    renderPage();
    const t0 = Date.now();
    pushQuotes(quote('AAPL', { last: 100, lastTradeAt: t0 }));
    pushQuotes(quote('AAPL', { last: 100.25, lastTradeAt: t0 + 100 }));
    const flashed = cells('AAPL').last;
    expect(flashed).toHaveClass('flash-up');
    pushQuotes(quote('AAPL', { last: 100.1, lastTradeAt: t0 + 600 }));
    expect(cells('AAPL').last).toBe(flashed);
    expect(cells('AAPL').last).toHaveTextContent('100.10');
    expect(cells('AAPL').last).not.toHaveClass('flash-down');
    pushQuotes(quote('AAPL', { last: 99.9, lastTradeAt: t0 + 2100 }));
    expect(cells('AAPL').last).toHaveClass('flash-down');
  });

  it('loads each company name once, also under StrictMode', async () => {
    const getInstrument = vi.spyOn(api, 'getInstrument');
    seedWatchlist();
    renderPage({ strict: true });
    expect(await within(row('NVDA')).findByText('NVIDIA Corporation')).toBeInTheDocument();
    expect(getInstrument).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll('tr[data-symbol="AAPL"]')).toHaveLength(1);
  });

  it('keeps colors in CSS classes so a theme switch restyles the table', () => {
    seedWatchlist();
    renderPage();
    pushQuotes(quote('AAPL', { change: 1 }), quote('MSFT', { change: -1 }));
    const theme = renderHook(() => useTheme());
    act(() => {
      theme.result.current.setPreference('light');
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(cells('AAPL').change).toHaveClass('is-gain');
    expect(cells('MSFT').change).toHaveClass('is-loss');
    expect(document.querySelector('.watchlist-page [style*="color"]')).toBeNull();
    act(() => {
      theme.result.current.setPreference('dark');
    });
  });
});

describe('WatchlistPage opening and keyboard', () => {
  it('opens the symbol page when a row is clicked', async () => {
    seedWatchlist();
    renderPage();
    await userEvent.click(row('MSFT'));
    expect(screen.getByText('Symbol page MSFT')).toBeInTheDocument();
  });

  it('puts one row in the tab order and opens it with Enter', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    renderPage();
    act(() => {
      addBox().focus();
    });
    await user.tab();
    expect(row('AAPL')).toHaveFocus();
    expect(row('MSFT')).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{Enter}');
    expect(screen.getByText('Symbol page AAPL')).toBeInTheDocument();
  });

  it('moves focus with the arrow keys, Home and End, and keeps the tab stop on the last focused row', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    renderPage();
    act(() => {
      row('AAPL').focus();
    });
    await user.keyboard('{ArrowDown}');
    expect(row('MSFT')).toHaveFocus();
    await user.keyboard('{End}');
    expect(row('NVDA')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(row('NVDA')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(row('AAPL')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(row('MSFT')).toHaveAttribute('tabindex', '0');
    expect(row('AAPL')).toHaveAttribute('tabindex', '-1');
  });

  it('moves the focused row with Alt+Up and Alt+Down, keeping focus on it', async () => {
    const { reorder } = seedWatchlist();
    const user = userEvent.setup();
    renderPage();
    act(() => {
      row('AAPL').focus();
    });
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(reorder).toHaveBeenCalledWith(['MSFT', 'AAPL', 'NVDA']);
    expect(row('AAPL')).toHaveFocus();
    await user.keyboard('{Alt>}{ArrowUp}{ArrowUp}{/Alt}');
    expect(reorder).toHaveBeenLastCalledWith(['AAPL', 'MSFT', 'NVDA']);
    expect(reorder).toHaveBeenCalledTimes(2);
  });

  it('removes the focused row with Delete and focuses the next one', async () => {
    const { removeSymbol } = seedWatchlist();
    const user = userEvent.setup();
    renderPage();
    act(() => {
      row('MSFT').focus();
    });
    await user.keyboard('{Delete}');
    expect(removeSymbol).toHaveBeenCalledWith('MSFT');
    await waitFor(() => {
      expect(row('NVDA')).toHaveFocus();
    });
  });
});

describe('WatchlistPage row actions', () => {
  it('opens the create-alert dialog for the row without leaving the page', async () => {
    seedWatchlist();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Create alert for MSFT' }));
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'create', presetSymbol: 'MSFT' });
    expect(screen.queryByText(/^Symbol page/)).not.toBeInTheDocument();
  });

  it('moves rows from the menu and disables moves past the ends', async () => {
    const { reorder } = seedWatchlist();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'More actions for AAPL' }));
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(reorder).toHaveBeenCalledWith(['MSFT', 'AAPL', 'NVDA']);
    expect(row('AAPL').rowIndex).toBe(2);

    await user.click(screen.getByRole('button', { name: 'More actions for NVDA' }));
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(reorder).toHaveBeenLastCalledWith(['MSFT', 'NVDA', 'AAPL']);
    expect(screen.queryByText(/^Symbol page/)).not.toBeInTheDocument();
  });

  it('removes a symbol and moves focus to the next row', async () => {
    const { removeSymbol } = seedWatchlist();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'More actions for MSFT' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from watchlist' }));
    expect(removeSymbol).toHaveBeenCalledWith('MSFT');
    expect(document.querySelector('tr[data-symbol="MSFT"]')).toBeNull();
    await waitFor(() => {
      expect(row('NVDA')).toHaveFocus();
    });
  });

  it('moves focus to the add box after removing the last symbol', async () => {
    seedWatchlist({ watchlist: watchlist(['AAPL']) });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'More actions for AAPL' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from watchlist' }));
    expect(screen.getByText('Your watchlist is empty')).toBeInTheDocument();
    await waitFor(() => {
      expect(addBox()).toHaveFocus();
    });
  });
});

describe('WatchlistPage connection notice', () => {
  it('warns that prices may be stale while the feed reconnects, and clears once connected', () => {
    seedWatchlist();
    renderPage();
    const notice = () => screen.getAllByRole('status').find((el) => el.closest('.market-card'));
    expect(notice()).toBeEmptyDOMElement();
    setConnection({
      state: 'reconnecting',
      lastMessageAt: Date.now(),
      reconnectAttempt: 1,
      // ** Half a second of slack, since the countdown rounds down as the test runs.
      nextRetryAt: Date.now() + 4_500,
      error: 'Simulated network drop.',
    });
    expect(notice()).toHaveTextContent('Prices may be stale');
    expect(notice()).toHaveTextContent('Simulated network drop.');
    expect(screen.getByText('Retrying in 4s')).toBeInTheDocument();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    setConnection({ state: 'connected', lastMessageAt: Date.now() });
    expect(notice()).toBeEmptyDOMElement();
  });
});
