import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { decodeParam, routes } from '../../app/routes';
import { useToastStore } from '../../components/ui/toastStore';
import { ApiError } from '../../data/api';
import { api, resetDemoData } from '../../data/dataLayer';
import { updateSimulation } from '../../data/simulationStore';
import { MAX_WATCHLIST_SYMBOLS } from '../../domain/symbols';
import type { Instrument } from '../../domain/types';
import { resetShellStores } from '../shell/testUtils';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { DiscoverPage } from './DiscoverPage';
import { instrumentCatalog } from './instrumentCatalog';
import { sparklineCache } from './sparklineCache';

function renderDiscover(path = '/discover/stocks', { strict = false } = {}) {
  const location = memoryLocation({ path, record: true });
  const tree = (
    <Router hook={location.hook}>
      <Switch>
        <Route path={routes.discover} component={DiscoverPage} />
        <Route path={routes.symbol}>{(params) => <p>Symbol page {decodeParam(params.symbol)}</p>}</Route>
      </Switch>
    </Router>
  );
  const utils = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  const currentPath = () => location.history[location.history.length - 1];
  return { ...utils, location, currentPath };
}

async function loadWatchlist(): Promise<void> {
  await act(() => useWatchlistStore.getState().load());
}

/** The symbols of the table rows, top to bottom. */
function rowSymbols(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('.discover-row__symbol')?.textContent ?? '');
}

function rowFor(symbol: string): HTMLElement {
  const link = screen.getByRole('link', { name: new RegExp(`^${symbol.replace('/', '\\/')}\\b`) });
  const row = link.closest('tr');
  if (!row) throw new Error(`No row for ${symbol}`);
  return row;
}

async function waitForPrices(): Promise<void> {
  await screen.findByText(/as of \d{2}:\d{2}:\d{2} ET/);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const unavailable = () => new ApiError('UNAVAILABLE', 'Service down (simulated).', 503);

beforeEach(async () => {
  resetShellStores();
  updateSimulation({ apiLatencyMs: 0 });
  await resetDemoData();
  instrumentCatalog.clear();
  sparklineCache.clear();
  // ** Sparklines have their own tests; here they stay loading so their history requests don't race the page.
  vi.spyOn(sparklineCache, 'load').mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  act(() => {
    useToastStore.setState({ toasts: [] });
  });
});

describe('DiscoverPage', () => {
  it('lists the tab’s instruments with polled prices and a simulated as-of marker', async () => {
    renderDiscover();
    expect(screen.getByRole('heading', { level: 1, name: 'Discover' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^AAPL Apple Inc\./ })).toBeInTheDocument();
    await waitForPrices();
    const last = within(rowFor('AAPL')).getAllByRole('cell')[1];
    expect(last?.textContent).toMatch(/^\d{1,3}(,\d{3})*\.\d{2}$/);
    expect(screen.getByText('54 stocks')).toBeInTheDocument();
    expect(screen.getAllByText('Simulated').length).toBeGreaterThanOrEqual(2);
  });

  it('binds the tabs to the address', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderDiscover();
    await screen.findByRole('link', { name: /^AAPL\b/ });
    await user.click(screen.getByRole('tab', { name: 'Crypto' }));
    expect(currentPath()).toBe('/discover/crypto');
    expect(screen.getByRole('tab', { name: 'Crypto' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('link', { name: /^BTC\/USD Bitcoin/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^AAPL\b/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volume (coins)' })).toBeInTheDocument();
    expect(screen.getByText('Crypto trades 24/7. Volume is in coins.')).toBeInTheDocument();
  });

  it('opens on the tab in the address and sends a missing or unknown tab to Stocks', async () => {
    renderDiscover('/discover/etfs');
    expect(screen.getByRole('tab', { name: 'ETFs' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('link', { name: /^SPY\b/ })).toBeInTheDocument();

    const unknown = renderDiscover('/discover/bonds');
    expect(unknown.currentPath()).toBe('/discover/stocks');
    unknown.unmount();
    const missing = renderDiscover('/discover');
    expect(missing.currentPath()).toBe('/discover/stocks');
  });

  it('filters by symbol or name and offers to clear a filter that matches nothing', async () => {
    const user = userEvent.setup();
    renderDiscover();
    await screen.findByRole('link', { name: /^AAPL\b/ });
    const filter = screen.getByRole('searchbox', { name: 'Filter by symbol or name' });

    await user.type(filter, 'micro');
    expect(rowSymbols()).toEqual(['AMD', 'MSFT', 'MU']);
    expect(screen.getByText('3 of 54 stocks')).toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, 'zzzz');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('No stocks match “zzzz”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(filter).toHaveValue('');
    expect(rowSymbols()).toHaveLength(54);
  });

  it('keeps the filter when switching tabs', async () => {
    const user = userEvent.setup();
    renderDiscover();
    await screen.findByRole('link', { name: /^AAPL\b/ });
    await user.type(screen.getByRole('searchbox'), 'bit');
    await user.click(screen.getByRole('tab', { name: 'Crypto' }));
    await screen.findByRole('link', { name: /^BTC\/USD\b/ });
    expect(rowSymbols()).toEqual(['BTC/USD']);
  });

  it('sorts by a column header, reporting the order with aria-sort', async () => {
    const user = userEvent.setup();
    renderDiscover();
    await screen.findByRole('link', { name: /^AAPL\b/ });
    await waitForPrices();
    const header = (name: string) => screen.getByRole('button', { name }).closest('th');
    expect(header('Symbol')).toHaveAttribute('aria-sort', 'ascending');
    expect(rowSymbols().slice(0, 3)).toEqual(['AAPL', 'ABBV', 'ABNB']);

    await user.click(screen.getByRole('button', { name: 'Last' }));
    expect(header('Last')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Symbol')).toHaveAttribute('aria-sort', 'none');
    const prices = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => Number(row.querySelector('.discover-row__last')?.textContent.replace(/,/g, '')));
    const descending = prices();
    expect(descending).toEqual([...descending].sort((a, b) => b - a));

    await user.click(screen.getByRole('button', { name: 'Last' }));
    expect(header('Last')).toHaveAttribute('aria-sort', 'ascending');
    const ascending = prices();
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
  });

  it('opens the symbol page with Enter on the row link or a click anywhere on the row', async () => {
    const user = userEvent.setup();
    const first = renderDiscover();
    const link = await screen.findByRole('link', { name: /^AAPL\b/ });
    link.focus();
    await user.keyboard('{Enter}');
    expect(first.currentPath()).toBe('/symbol/AAPL');
    expect(screen.getByText('Symbol page AAPL')).toBeInTheDocument();
    first.unmount();

    const second = renderDiscover('/discover/crypto');
    await screen.findByRole('link', { name: /^ETH\/USD\b/ });
    await waitForPrices();
    await user.click(within(rowFor('ETH/USD')).getAllByRole('cell')[2]!);
    expect(second.currentPath()).toBe('/symbol/ETH%2FUSD');
    expect(screen.getByText('Symbol page ETH/USD')).toBeInTheDocument();
  });

  it('stars a symbol into the watchlist and back out without opening the row', async () => {
    const user = userEvent.setup();
    await loadWatchlist();
    const { currentPath } = renderDiscover();
    await screen.findByRole('link', { name: /^JPM\b/ });
    const star = within(rowFor('JPM')).getByRole('button', { name: 'Watch JPM' });
    expect(star).toHaveAttribute('aria-pressed', 'false');

    await user.click(star);
    await waitFor(() => {
      expect(useWatchlistStore.getState().watchlist?.symbols).toContain('JPM');
    });
    expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(currentPath()).toBe('/discover/stocks');

    await user.click(star);
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      expect(useWatchlistStore.getState().watchlist?.symbols).not.toContain('JPM');
    });
  });

  it('shows symbols already in the watchlist as starred', async () => {
    await loadWatchlist();
    renderDiscover();
    await screen.findByRole('link', { name: /^AAPL\b/ });
    expect(within(rowFor('AAPL')).getByRole('button', { name: 'Watch AAPL' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reports a failed add and leaves the star off', async () => {
    const user = userEvent.setup();
    await loadWatchlist();
    vi.spyOn(api, 'addSymbol').mockRejectedValueOnce(unavailable());
    renderDiscover();
    await screen.findByRole('link', { name: /^JPM\b/ });
    const star = within(rowFor('JPM')).getByRole('button', { name: 'Watch JPM' });
    await user.click(star);
    await waitFor(() => {
      expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Couldn't add JPM to your watchlist");
    });
    expect(star).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables the star, with the reason as its tooltip, while the watchlist loads', async () => {
    const user = userEvent.setup();
    act(() => {
      useWatchlistStore.setState({ status: 'loading', watchlist: null });
    });
    const addSymbol = vi.spyOn(useWatchlistStore.getState(), 'addSymbol');
    renderDiscover();
    await screen.findByRole('link', { name: /^AAPL\b/ });
    const star = within(rowFor('AAPL')).getByRole('button', { name: 'Watch AAPL' });
    expect(star).toHaveAttribute('aria-disabled', 'true');
    await user.click(star);
    expect(addSymbol).not.toHaveBeenCalled();
    expect(star).toHaveAttribute('aria-pressed', 'false');

    // Keyboard focus shows the tooltip with the reason.
    within(rowFor('AAPL')).getByRole('link').focus();
    await user.tab();
    expect(star).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Your watchlist is loading.');
  });

  it('disables the star when the watchlist is full', async () => {
    const full = Array.from(
      { length: MAX_WATCHLIST_SYMBOLS },
      (_, i) => `X${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`,
    );
    act(() => {
      useWatchlistStore.setState({ status: 'ready', watchlist: { symbols: full, updatedAt: '' } });
    });
    renderDiscover();
    await screen.findByRole('link', { name: /^AAPL\b/ });
    expect(within(rowFor('AAPL')).getByRole('button', { name: 'Watch AAPL' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('shows an error with Retry when the instruments fail to load', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listInstruments').mockRejectedValueOnce(unavailable());
    renderDiscover();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load stocks");
    expect(alert).toHaveTextContent('Service down (simulated).');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /^AAPL\b/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the rows and offers Retry when prices fail to load', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSnapshots').mockRejectedValueOnce(unavailable());
    renderDiscover();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load prices. Service down (simulated).");
    expect(screen.getByRole('link', { name: /^AAPL\b/ })).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitForPrices();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows only the current tab’s rows when tabs change faster than the server answers', async () => {
    const user = userEvent.setup();
    const stocks = deferred<Instrument[]>();
    const crypto = deferred<Instrument[]>();
    const realList = api.listInstruments.bind(api);
    const realStocks = await realList('stock');
    const realCrypto = await realList('crypto');
    vi.spyOn(api, 'listInstruments').mockImplementation((assetClass) =>
      assetClass === 'stock'
        ? stocks.promise
        : assetClass === 'crypto'
          ? crypto.promise
          : realList(assetClass),
    );
    renderDiscover();
    await user.click(screen.getByRole('tab', { name: 'Crypto' }));
    crypto.resolve(realCrypto);
    await screen.findByRole('link', { name: /^BTC\/USD\b/ });
    stocks.resolve(realStocks);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('link', { name: /^AAPL\b/ })).not.toBeInTheDocument();
    expect(rowSymbols()).toHaveLength(realCrypto.length);
  });

  it('works under StrictMode', async () => {
    renderDiscover('/discover/crypto', { strict: true });
    expect(await screen.findByRole('link', { name: /^BTC\/USD\b/ })).toBeInTheDocument();
    await waitForPrices();
    expect(rowSymbols()).toHaveLength(10);
  });
});

describe('DiscoverPage polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes the visible tab’s prices every 12 seconds', async () => {
    const getSnapshots = vi.spyOn(api, 'getSnapshots');
    renderDiscover('/discover/etfs');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getSnapshots).toHaveBeenCalledTimes(1);
    expect(getSnapshots.mock.calls[0]?.[0]).toContain('SPY');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(getSnapshots).toHaveBeenCalledTimes(2);
  });
});
