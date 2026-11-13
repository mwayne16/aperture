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
  return { symbols, updatedAt: '' };
}

afterEach(() => {
  act(() => {
    useWatchlistStore.setState(useWatchlistStore.getInitialState(), true);
    useAlertStore.setState(useAlertStore.getInitialState(), true);
    useUiStore.setState(useUiStore.getInitialState(), true);
  });
});

describe('subscribedSymbols', () => {
  const none = { watchlist: [], selected: null, alertDraft: null, alerts: [] };

  it('combines the watchlist, the selection, the alert draft and enabled alerts, sorted and unique', () => {
    expect(
      subscribedSymbols({
        watchlist: ['MSFT', 'AAPL'],
        selected: 'AAPL',
        alertDraft: 'AMD',
        alerts: [alert('TSLA', true), alert('MSFT', true)],
      }),
    ).toEqual(['AAPL', 'AMD', 'MSFT', 'TSLA']);
  });

  it('includes disabled alerts, so the alerts panel keeps a current price for them', () => {
    expect(subscribedSymbols({ ...none, alerts: [alert('AMD', false)] })).toEqual(['AMD']);
  });

  it('subscribes to the selected symbol even when the watchlist is empty', () => {
    expect(subscribedSymbols({ ...none, selected: 'NVDA' })).toEqual(['NVDA']);
  });

  it('subscribes to the symbol typed into the alert dialog on its own', () => {
    expect(subscribedSymbols({ ...none, alertDraft: 'AMD' })).toEqual(['AMD']);
  });
});

describe('useSubscribedSymbols', () => {
  it('keeps the same list while the set of symbols stays the same', () => {
    act(() => {
      useWatchlistStore.setState({ watchlist: watchlist(['MSFT', 'AAPL']) });
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

    // Reordering the watchlist keeps the set too.
    act(() => {
      useWatchlistStore.setState({ watchlist: watchlist(['AAPL', 'MSFT']) });
    });
    expect(result.current).toBe(first);

    act(() => {
      useUiStore.getState().selectSymbol('NVDA');
    });
    expect(result.current).toEqual(['AAPL', 'MSFT', 'NVDA', 'TSLA']);

    act(() => {
      useWatchlistStore.setState({ watchlist: watchlist(['AAPL']) });
    });
    expect(result.current).toEqual(['AAPL', 'NVDA', 'TSLA']);
  });
});

describe('useQuoteSubscriptions', () => {
  it('updates the realtime subscriptions only when the set of symbols changes', () => {
    const setSubscriptions = vi.spyOn(realtime, 'setSubscriptions').mockImplementation(() => undefined);
    act(() => {
      useWatchlistStore.setState({ watchlist: watchlist(['AAPL']) });
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

    act(() => {
      useUiStore.getState().setAlertDraftSymbol('NVDA');
    });
    expect(setSubscriptions.mock.calls.at(-1)).toEqual([['AAPL', 'AMD', 'NVDA']]);
    act(() => {
      useUiStore.getState().closeAlertDialog();
    });
    expect(setSubscriptions.mock.calls.at(-1)).toEqual([['AAPL', 'AMD']]);
  });
});
