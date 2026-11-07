import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { realtime } from '../data/dataLayer';
import type { PriceAlert, Watchlist } from '../domain/types';
import { useAlertStore } from '../features/alerts/alertStore';
import { useWatchlistStore } from '../features/watchlists/watchlistStore';
import { useUiStore } from './uiStore';
import { subscribedSymbols, useQuoteSubscriptions, useSubscribedSymbols } from './useQuoteSubscriptions';

function alert(symbol: string, enabled: boolean, id = symbol): PriceAlert {
  return { id, symbol, enabled } as PriceAlert;
}

function watchlist(symbols: string[]): Watchlist {
  return { id: 'w1', name: 'Mine', symbols, createdAt: '', updatedAt: '' };
}

afterEach(() => {
  act(() => {
    useWatchlistStore.setState(useWatchlistStore.getInitialState(), true);
    useAlertStore.setState(useAlertStore.getInitialState(), true);
    useUiStore.setState(useUiStore.getInitialState(), true);
  });
});

describe('subscribedSymbols', () => {
  it('combines the watchlist, the selected symbol and enabled alerts, sorted and unique', () => {
    expect(subscribedSymbols(['MSFT', 'AAPL'], 'AAPL', [alert('TSLA', true), alert('MSFT', true)])).toEqual([
      'AAPL',
      'MSFT',
      'TSLA',
    ]);
  });

  it('skips disabled alerts', () => {
    expect(subscribedSymbols([], null, [alert('AMD', false)])).toEqual([]);
  });

  it('subscribes to the selected symbol even when no watchlist is active', () => {
    expect(subscribedSymbols([], 'NVDA', [])).toEqual(['NVDA']);
  });
});

describe('useSubscribedSymbols', () => {
  it('keeps the same list while the set of symbols stays the same', () => {
    act(() => {
      useWatchlistStore.setState({ watchlists: [watchlist(['MSFT', 'AAPL'])], activeId: 'w1' });
      useAlertStore.setState({ alerts: [alert('TSLA', true)] });
    });
    const { result } = renderHook(() => useSubscribedSymbols());
    const first = result.current;
    expect(first).toEqual(['AAPL', 'MSFT', 'TSLA']);

    // A pushed alert update and a second alert on a watched symbol leave the set unchanged.
    act(() => {
      useAlertStore.setState({ alerts: [alert('TSLA', true), alert('AAPL', true, 'second')] });
    });
    expect(result.current).toBe(first);

    act(() => {
      useUiStore.getState().selectSymbol('NVDA');
    });
    expect(result.current).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA']);
  });
});

describe('useQuoteSubscriptions', () => {
  it('updates the realtime subscriptions only when the set of symbols changes', () => {
    const setSubscriptions = vi.spyOn(realtime, 'setSubscriptions').mockImplementation(() => undefined);
    act(() => {
      useWatchlistStore.setState({ watchlists: [watchlist(['AAPL'])], activeId: 'w1' });
    });
    renderHook(() => {
      useQuoteSubscriptions();
    });
    expect(setSubscriptions.mock.calls).toEqual([[['AAPL']]]);

    act(() => {
      useAlertStore.setState({ alerts: [alert('AAPL', true)] });
    });
    expect(setSubscriptions).toHaveBeenCalledTimes(1);

    act(() => {
      useUiStore.getState().selectSymbol('AMD');
    });
    expect(setSubscriptions.mock.calls.at(-1)).toEqual([['AAPL', 'AMD']]);
  });
});
