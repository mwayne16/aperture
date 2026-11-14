import { describe, expect, it } from 'vitest';
import { MAX_WATCHLIST_SYMBOLS } from '@aperture/shared/symbols';
import type { Watchlist } from '../../domain/types';
import { watchView } from './watchToggle';

function list(symbols: string[]): Watchlist {
  return { symbols, updatedAt: '' };
}

describe('watchView', () => {
  it('offers to add a symbol the watchlist lacks', () => {
    expect(watchView('ready', list(['MSFT']), 'AAPL')).toEqual({
      action: 'add',
      watching: false,
      label: 'Watch',
      hint: 'Add AAPL to your watchlist',
    });
  });

  it('offers to remove a symbol the watchlist holds', () => {
    expect(watchView('ready', list(['AAPL']), 'AAPL')).toEqual({
      action: 'remove',
      watching: true,
      label: 'Watching',
      hint: 'Remove AAPL from your watchlist',
    });
    expect(watchView('ready', list(['BTC/USD']), 'btc/usd').watching).toBe(true);
  });

  it('explains a full list instead of adding', () => {
    const full = list(Array.from({ length: MAX_WATCHLIST_SYMBOLS }, (_, i) => `X${i}`));
    const view = watchView('ready', full, 'AAPL');
    expect(view.action).toBeNull();
    expect(view.hint).toBe('Your watchlist is full (30 symbols max). Remove a symbol to add AAPL.');
  });

  it('still lets a symbol in a full list be removed', () => {
    const symbols = ['AAPL', ...Array.from({ length: MAX_WATCHLIST_SYMBOLS - 1 }, (_, i) => `X${i}`)];
    expect(watchView('ready', list(symbols), 'AAPL').action).toBe('remove');
  });

  it('explains why the toggle is unavailable before the watchlist has loaded', () => {
    expect(watchView('loading', null, 'AAPL')).toMatchObject({ action: null, hint: 'Loading your watchlist…' });
    expect(watchView('idle', null, 'AAPL')).toMatchObject({ action: null, hint: 'Loading your watchlist…' });
    expect(watchView('error', null, 'AAPL')).toMatchObject({
      action: null,
      hint: "Your watchlist couldn't be loaded, so nothing can be added right now.",
    });
  });
});
