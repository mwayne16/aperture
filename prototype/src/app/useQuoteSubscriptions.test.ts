import { describe, expect, it } from 'vitest';
import type { PriceAlert } from '../domain/types';
import { subscribedSymbols } from './useQuoteSubscriptions';

function alert(symbol: string, enabled: boolean): PriceAlert {
  return { symbol, enabled } as PriceAlert;
}

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
