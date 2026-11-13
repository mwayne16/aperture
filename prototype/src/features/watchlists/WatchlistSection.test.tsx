import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { useQuoteStore } from '../../data/quoteStore';
import type { Quote } from '../../domain/types';
import { WatchlistSection } from './WatchlistSection';
import { useWatchlistStore } from './watchlistStore';

function quote(symbol: string, changePct: number): Quote {
  return {
    symbol,
    last: 100,
    lastTradeAt: Date.now(),
    bid: null,
    bidSize: null,
    ask: null,
    askSize: null,
    quoteAt: null,
    open: null,
    high: null,
    low: null,
    prevClose: 100,
    volume: null,
    change: changePct,
    changePct,
    status: 'live',
    updatedAt: Date.now(),
  };
}

function setWatchlist(symbols: string[] | null, status: 'loading' | 'ready' | 'error' = 'ready') {
  act(() => {
    useWatchlistStore.setState({
      status,
      error: status === 'error' ? 'The service is unavailable.' : null,
      watchlist: symbols === null ? null : { symbols, updatedAt: '' },
    });
  });
}

function renderAt(path: string, children: ReactNode = <WatchlistSection />) {
  const location = memoryLocation({ path, record: true });
  render(<Router hook={location.hook}>{children}</Router>);
  return location;
}

const rows = () => within(screen.getByRole('list', { name: 'Watchlist' })).getAllByRole('link');

beforeEach(() => {
  useQuoteStore.getState().clear();
});

afterEach(() => {
  act(() => {
    useWatchlistStore.setState({ status: 'idle', error: null, watchlist: null });
  });
});

describe('WatchlistSection', () => {
  it('lists every watched symbol with its live change, linking to its page', () => {
    setWatchlist(['AAPL', 'MSFT', 'BTC/USD']);
    act(() => {
      useQuoteStore.getState().applyBatch([quote('AAPL', 1.25), quote('MSFT', -0.5)]);
    });
    renderAt('/');
    expect(rows().map((r) => r.textContent)).toEqual(['AAAPL+1.25%', 'MMSFT−0.50%', 'BBTC/USD—']);
    expect(rows()[2]).toHaveAttribute('href', '/symbol/BTC%2FUSD');
    expect(within(rows()[0]!).getByText('+1.25%')).toHaveClass('is-gain');
    expect(within(rows()[1]!).getByText('−0.50%')).toHaveClass('is-loss');
  });

  it("marks the symbol whose page is open", () => {
    setWatchlist(['AAPL', 'MSFT']);
    renderAt('/symbol/MSFT');
    expect(rows()[1]).toHaveAttribute('aria-current', 'page');
    expect(rows()[0]).not.toHaveAttribute('aria-current');
  });

  it('moves through the list with the arrow keys and removes a symbol with Delete', async () => {
    const user = userEvent.setup();
    setWatchlist(['AAPL', 'MSFT', 'NVDA']);
    renderAt('/');
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    rows()[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(rows()[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(rows()[2]).toHaveFocus();

    useWatchlistStore.setState({ removeSymbol: (symbol) => {
      useWatchlistStore.setState({ watchlist: { symbols: ['AAPL', 'MSFT', 'NVDA'].filter((s) => s !== symbol), updatedAt: '' } });
      return Promise.resolve();
    } });
    await user.keyboard('{Home}{Delete}');
    expect(rows().map((r) => r.textContent.slice(1, 5))).toEqual(['MSFT', 'NVDA']);
    // Focus stays in the list, on the row that took the removed one's place.
    expect(rows()[0]).toHaveFocus();
  });

  it('collapses and expands from the heading', async () => {
    const user = userEvent.setup();
    setWatchlist(['AAPL']);
    renderAt('/');
    const toggle = screen.getByRole('button', { name: 'Watchlist' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Watchlist' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(rows()).toHaveLength(1);
  });

  it('opens an add dialog from the + button', async () => {
    const user = userEvent.setup();
    setWatchlist(['AAPL']);
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Add a symbol to your watchlist' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to watchlist' });
    expect(within(dialog).getByRole('combobox', { name: 'Add symbol to watchlist' })).toHaveFocus();
  });

  it('shows loading, empty and error states', async () => {
    setWatchlist(null, 'loading');
    renderAt('/');
    expect(screen.getByRole('button', { name: 'Add a symbol to your watchlist' })).toBeDisabled();

    setWatchlist([]);
    expect(screen.getByText(/No symbols yet/)).toBeInTheDocument();

    setWatchlist(null, 'error');
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your watchlist.");
    const load = { calls: 0 };
    useWatchlistStore.setState({ load: () => { load.calls += 1; return Promise.resolve(); } });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(load.calls).toBe(1);
  });
});
