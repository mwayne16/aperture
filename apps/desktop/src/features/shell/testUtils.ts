import { act } from '@testing-library/react';
import { useUiStore } from '../../app/uiStore';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { useQuoteStore } from '../../data/quoteStore';
import { resetSimulation } from '../../data/simulationStore';
import type { ConnectionInfo, DataStatus, Quote } from '../../domain/types';
import { useAlertStore } from '../alerts/alertStore';
import { useWatchlistStore } from '../watchlists/watchlistStore';

/** Test helpers for the shell feature. Stores are module singletons, so each test restores them. */

const initialWatchlists = useWatchlistStore.getState();
const initialAlerts = useAlertStore.getState();
const initialUi = useUiStore.getState();

export function resetShellStores(): void {
  act(() => {
    useWatchlistStore.setState(initialWatchlists, true);
    useAlertStore.setState(initialAlerts, true);
    useUiStore.setState(initialUi, true);
    useConnectionStore.setState({ connection: INITIAL_CONNECTION });
    useQuoteStore.getState().clear();
    resetSimulation();
  });
}

export function setConnection(patch: Partial<ConnectionInfo>): void {
  act(() => {
    useConnectionStore.setState({ connection: { ...INITIAL_CONNECTION, ...patch } });
  });
}

/** Makes `symbols` the watchlist, which is what the app subscribes to. */
export function watch(symbols: string[]): void {
  act(() => {
    useWatchlistStore.setState({
      status: 'ready',
      watchlist: { symbols, updatedAt: '' },
    });
  });
}

export function quote(symbol: string, status: DataStatus): Quote {
  return {
    symbol,
    last: 100,
    lastTradeAt: 0,
    bid: 99.99,
    bidSize: 100,
    ask: 100.01,
    askSize: 100,
    quoteAt: 0,
    open: 99,
    high: 101,
    low: 98,
    prevClose: 99,
    volume: 1000,
    change: 1,
    changePct: 1.01,
    status,
    updatedAt: 0,
  };
}

export function setQuotes(quotes: Quote[]): void {
  act(() => {
    useQuoteStore.getState().applyBatch(quotes);
  });
}
