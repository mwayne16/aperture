import { describe, expect, it } from 'vitest';
import type { Quote } from '../../domain/types';
import { newestDataTime, summarizeQuotes } from './summaryModel';

function quote(symbol: string, changePct: number | null, patch: Partial<Quote> = {}): Quote {
  return {
    symbol,
    last: 100,
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
    volume: null,
    change: changePct,
    changePct,
    status: 'live',
    updatedAt: 1,
    ...patch,
  };
}

describe('summarizeQuotes', () => {
  it('counts symbols up, down and unchanged, and finds the biggest moves both ways', () => {
    const summary = summarizeQuotes([quote('A', 1.2), quote('B', -0.4), quote('C', 0), quote('D', 2.5), quote('E', -3)]);
    expect(summary).toMatchObject({ up: 2, down: 2, unchanged: 1 });
    expect(summary.best?.symbol).toBe('D');
    expect(summary.worst?.symbol).toBe('E');
  });

  it('leaves out missing, stale and unavailable quotes and ones without a change', () => {
    const summary = summarizeQuotes([
      undefined,
      quote('A', 9, { status: 'stale' }),
      quote('B', -9, { status: 'unavailable' }),
      quote('C', null),
      quote('D', 0.5, { status: 'delayed' }),
    ]);
    expect(summary).toMatchObject({ up: 1, down: 0, unchanged: 0 });
    expect(summary.best?.symbol).toBe('D');
  });

  it('names one symbol only once when it is the only quote', () => {
    const summary = summarizeQuotes([quote('A', -1)]);
    expect(summary.best?.symbol).toBe('A');
    expect(summary.worst).toBeNull();
  });

  it('has no movers without current quotes', () => {
    expect(summarizeQuotes([])).toEqual({ up: 0, down: 0, unchanged: 0, best: null, worst: null });
  });
});

describe('newestDataTime', () => {
  it('takes the newest trade, falling back to the quote time', () => {
    expect(
      newestDataTime([
        quote('A', 0, { lastTradeAt: 10 }),
        quote('B', 0, { lastTradeAt: null, quoteAt: 30 }),
        undefined,
        quote('C', 0, { lastTradeAt: 20 }),
      ]),
    ).toBe(30);
  });

  it('is null without any market data', () => {
    expect(newestDataTime([undefined, quote('A', 0, { lastTradeAt: null, quoteAt: null })])).toBeNull();
  });
});
