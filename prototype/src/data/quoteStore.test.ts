import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Quote } from '../domain/types';
import { getQuote, sameQuoteData, useQuote, useQuoteStore } from './quoteStore';

function quote(symbol: string, last: number, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    last,
    lastTradeAt: 1000,
    bid: last - 0.01,
    bidSize: 100,
    ask: last + 0.01,
    askSize: 200,
    quoteAt: 1000,
    open: 100,
    high: 110,
    low: 90,
    prevClose: 100,
    volume: 5000,
    change: last - 100,
    changePct: last - 100,
    status: 'live',
    updatedAt: 1000,
    ...overrides,
  };
}

const apply = (quotes: Quote[]): void => {
  useQuoteStore.getState().applyBatch(quotes);
};

beforeEach(() => {
  useQuoteStore.getState().clear();
});

describe('quoteStore.applyBatch', () => {
  it('adds new symbols', () => {
    apply([quote('AAPL', 101), quote('MSFT', 201)]);
    expect(Object.keys(useQuoteStore.getState().quotes).sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('replaces only changed symbols; unchanged symbols keep their object identity', () => {
    apply([quote('AAPL', 101), quote('MSFT', 201), quote('NVDA', 301)]);
    const before = useQuoteStore.getState().quotes;
    const nextAapl = quote('AAPL', 102);
    apply([nextAapl]);
    const after = useQuoteStore.getState().quotes;
    expect(after).not.toBe(before);
    expect(after.AAPL).toBe(nextAapl);
    expect(after.MSFT).toBe(before.MSFT);
    expect(after.NVDA).toBe(before.NVDA);
  });

  it('keeps identity and skips the update when a quote is re-sent with only a new updatedAt', () => {
    apply([quote('AAPL', 101)]);
    const before = useQuoteStore.getState().quotes;
    apply([quote('AAPL', 101, { updatedAt: 9999 })]);
    expect(useQuoteStore.getState().quotes).toBe(before);
  });

  it('treats a status change alone as a change', () => {
    apply([quote('AAPL', 101)]);
    const stale = quote('AAPL', 101, { status: 'stale' });
    apply([stale]);
    expect(useQuoteStore.getState().quotes.AAPL).toBe(stale);
  });

  it('does nothing for an empty batch', () => {
    apply([quote('AAPL', 101)]);
    const before = useQuoteStore.getState().quotes;
    apply([]);
    expect(useQuoteStore.getState().quotes).toBe(before);
  });

  it('lets the last quote win when a batch repeats a symbol', () => {
    const last = quote('AAPL', 103);
    apply([quote('AAPL', 101), quote('AAPL', 102), last]);
    expect(useQuoteStore.getState().quotes.AAPL).toBe(last);
  });

  it('does not mutate the previous state object', () => {
    apply([quote('AAPL', 101)]);
    const before = useQuoteStore.getState().quotes;
    apply([quote('MSFT', 201)]);
    expect(Object.keys(before)).toEqual(['AAPL']);
  });

  it('compares null and NaN fields correctly', () => {
    const empty = quote('ZZZZ', 0, { last: null, status: 'unavailable' });
    expect(sameQuoteData(empty, { ...empty, updatedAt: 5 })).toBe(true);
    expect(sameQuoteData(empty, { ...empty, last: 0 })).toBe(false);
    const nan = quote('X', Number.NaN);
    expect(sameQuoteData(nan, { ...nan })).toBe(true);
  });
});

describe('getQuote', () => {
  it('reads a quote by normalized symbol and returns undefined for unknown symbols', () => {
    apply([quote('BRK.B', 480)]);
    expect(getQuote(' brk.b ')?.last).toBe(480);
    expect(getQuote('MSFT')).toBeUndefined();
  });
});

describe('useQuote', () => {
  it('re-renders only when that symbol’s quote object changes', () => {
    apply([quote('AAPL', 101), quote('MSFT', 201)]);
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useQuote('aapl');
    });
    expect(result.current?.last).toBe(101);
    const initialRenders = renders;

    act(() => {
      apply([quote('MSFT', 202)]);
    });
    expect(renders).toBe(initialRenders);

    act(() => {
      apply([quote('AAPL', 101, { updatedAt: 5000 })]);
    });
    expect(renders).toBe(initialRenders);

    act(() => {
      apply([quote('AAPL', 105)]);
    });
    expect(renders).toBe(initialRenders + 1);
    expect(result.current?.last).toBe(105);
  });

  it('returns undefined until the symbol arrives', () => {
    const { result } = renderHook(() => useQuote('NVDA'));
    expect(result.current).toBeUndefined();
    act(() => {
      apply([quote('NVDA', 300)]);
    });
    expect(result.current?.last).toBe(300);
  });
});
