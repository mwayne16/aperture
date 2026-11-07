import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import type * as QuoteStoreModule from '../../data/quoteStore';
import { useQuote, useQuoteStore } from '../../data/quoteStore';
import type { Quote } from '../../domain/types';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { MarketTable } from './MarketTable';

// Counts row renders: every MarketRow render reads its quote through useQuote exactly once.
vi.mock('../../data/quoteStore', async (importOriginal) => {
  const actual = await importOriginal<typeof QuoteStoreModule>();
  return { ...actual, useQuote: vi.fn(actual.useQuote) };
});

const initialWatchlists = useWatchlistStore.getState();
const initialUi = useUiStore.getState();

const renders = (symbol: string) => vi.mocked(useQuote).mock.calls.filter(([s]) => s === symbol).length;

function quote(symbol: string, last: number): Quote {
  return {
    symbol,
    last,
    lastTradeAt: 1,
    bid: null,
    bidSize: null,
    ask: null,
    askSize: null,
    quoteAt: 1,
    open: null,
    high: null,
    low: null,
    prevClose: 100,
    volume: 1,
    change: last - 100,
    changePct: last - 100,
    status: 'live',
    updatedAt: 1,
  };
}

afterEach(() => {
  act(() => {
    useWatchlistStore.setState(initialWatchlists, true);
    useUiStore.setState(initialUi, true);
    useQuoteStore.getState().clear();
    useConnectionStore.getState().setConnection(INITIAL_CONNECTION);
  });
});

it('re-renders only the row whose quote, selection or tab stop changed', () => {
  act(() => {
    useWatchlistStore.setState({
      status: 'ready',
      watchlists: [{ id: 'wl', name: 'Core', symbols: ['AAPL', 'MSFT', 'NVDA'], createdAt: '', updatedAt: '' }],
      activeId: 'wl',
    });
    useQuoteStore.getState().applyBatch([quote('AAPL', 100), quote('MSFT', 100), quote('NVDA', 100)]);
  });
  render(<MarketTable />);

  const before = { AAPL: renders('AAPL'), MSFT: renders('MSFT'), NVDA: renders('NVDA') };
  act(() => {
    useQuoteStore.getState().applyBatch([quote('AAPL', 101)]);
  });
  expect(renders('AAPL')).toBeGreaterThan(before.AAPL);
  expect(renders('MSFT')).toBe(before.MSFT);
  expect(renders('NVDA')).toBe(before.NVDA);

  // The heartbeat changes connection info every second; rows only care about the state.
  const beforeHeartbeat = renders('MSFT');
  act(() => {
    useConnectionStore.getState().setConnection({ ...INITIAL_CONNECTION, lastMessageAt: 123 });
  });
  expect(renders('MSFT')).toBe(beforeHeartbeat);

  act(() => {
    useUiStore.getState().selectSymbol('MSFT');
  });
  const afterFirstSelect = renders('AAPL');
  act(() => {
    useUiStore.getState().selectSymbol('NVDA');
  });
  expect(renders('AAPL')).toBe(afterFirstSelect);
});
