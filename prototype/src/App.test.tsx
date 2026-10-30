import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { useUiStore } from './app/uiStore';
import { useConnectionStore } from './data/connectionStore';
import { realtime } from './data/dataLayer';
import { useWatchlistStore } from './features/watchlists/watchlistStore';

afterEach(() => {
  act(() => {
    useWatchlistStore.setState({ watchlists: [], activeId: null });
    useUiStore.setState({ selectedSymbol: null, searchFocusRequest: 0 });
  });
  vi.restoreAllMocks();
});

describe('App layout', () => {
  it('gives every area a landmark', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Watchlists' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Market' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Stock details' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Alerts' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('connects the realtime feed while mounted and disconnects on unmount', () => {
    const { unmount } = render(<App />);
    expect(useConnectionStore.getState().connection.state).not.toBe('disconnected');
    unmount();
    expect(useConnectionStore.getState().connection.state).toBe('disconnected');
  });

  it('subscribes to the active watchlist and the selected symbol', () => {
    const setSubscriptions = vi.spyOn(realtime, 'setSubscriptions');
    render(<App />);
    act(() => {
      useWatchlistStore.setState({
        watchlists: [{ id: 'wl', name: 'Test', symbols: ['MSFT', 'AAPL'], createdAt: '', updatedAt: '' }],
        activeId: 'wl',
      });
      useUiStore.getState().selectSymbol('NVDA');
    });
    expect(setSubscriptions).toHaveBeenLastCalledWith(['AAPL', 'MSFT', 'NVDA']);
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
