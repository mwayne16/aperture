import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { useUiStore } from './app/uiStore';
import { useConnectionStore } from './data/connectionStore';
import { realtime } from './data/dataLayer';
import { useWatchlistStore } from './features/watchlists/watchlistStore';

afterEach(() => {
  act(() => {
    useWatchlistStore.setState({ status: 'idle', watchlist: null });
    useUiStore.setState({ selectedSymbol: null, searchFocusRequest: 0 });
  });
  vi.restoreAllMocks();
});

describe('App layout', () => {
  it('gives every area a landmark', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('shows the watchlist page with its table and quick view', () => {
    window.location.hash = '#/watchlist';
    act(() => {
      useWatchlistStore.setState({ status: 'ready', watchlist: { symbols: ['AAPL'], updatedAt: '' } });
    });
    render(<App />);
    expect(screen.getByRole('region', { name: 'Market' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Stock details' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(/^Watchlist$/);
  });

  it('connects the realtime feed while mounted and disconnects on unmount', () => {
    const { unmount } = render(<App />);
    expect(useConnectionStore.getState().connection.state).not.toBe('disconnected');
    unmount();
    expect(useConnectionStore.getState().connection.state).toBe('disconnected');
  });

  it('subscribes to the watchlist and the selected symbol', () => {
    const setSubscriptions = vi.spyOn(realtime, 'setSubscriptions');
    render(<App />);
    act(() => {
      useWatchlistStore.setState({ watchlist: { symbols: ['MSFT', 'AAPL'], updatedAt: '' } });
      useUiStore.getState().selectSymbol('NVDA');
    });
    expect(setSubscriptions).toHaveBeenLastCalledWith(['AAPL', 'MSFT', 'NVDA']);
  });
});

describe('navigation', () => {
  it('marks the current page in the sidebar and follows links', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(window.location.hash).toBe('#/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('opens the watchlist page from the main menu and marks it current', async () => {
    const user = userEvent.setup();
    render(<App />);
    const menu = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(menu).getByRole('link', { name: 'Watchlist' }));
    expect(window.location.hash).toBe('#/watchlist');
    expect(within(menu).getByRole('link', { name: 'Watchlist' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Market' })).toBeInTheDocument();
  });

  it('opens a symbol page from its address, selecting the symbol', () => {
    window.location.hash = '#/symbol/BTC%2FUSD';
    render(<App />);
    expect(useUiStore.getState().selectedSymbol).toBe('BTC/USD');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('CryptoBTC/USD');
  });

  it('shows a popped-out symbol window without the app navigation', () => {
    window.location.hash = '#/window/symbol/AAPL';
    render(<App />);
    expect(useUiStore.getState().selectedSymbol).toBe('AAPL');
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open AAPL in a new window' })).not.toBeInTheDocument();
  });

  it('sends old multi-watchlist addresses to the one watchlist', () => {
    for (const old of ['#/watchlists', '#/watchlists/wl-core-tech']) {
      window.location.hash = old;
      const { unmount } = render(<App />);
      expect(window.location.hash).toBe('#/watchlist');
      unmount();
    }
  });

  it('shows a not-found page for an unknown address', () => {
    window.location.hash = '#/nowhere';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('Ctrl+K', () => {
  it('asks the global search to take focus', async () => {
    render(<App />);
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(useUiStore.getState().searchFocusRequest).toBe(1);
  });

  it('ignores other modifier combinations', async () => {
    render(<App />);
    await userEvent.keyboard('{Control>}{Shift>}k{/Shift}{/Control}');
    await userEvent.keyboard('{Control>}{Alt>}k{/Alt}{/Control}');
    await userEvent.keyboard('k');
    expect(useUiStore.getState().searchFocusRequest).toBe(0);
  });

  it('does nothing while a modal dialog is open', async () => {
    render(<App />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    await userEvent.keyboard('{Control>}k{/Control}');
    dialog.remove();
    expect(useUiStore.getState().searchFocusRequest).toBe(0);
  });
});
