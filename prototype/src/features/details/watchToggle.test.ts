import { describe, expect, it } from 'vitest';
import { MAX_WATCHLIST_SYMBOLS } from '../../domain/symbols';
import type { Watchlist } from '../../domain/types';
import { watchView } from './watchToggle';

function list(symbols: string[], name = 'Core Tech'): Watchlist {
  return { id: 'wl', name, symbols, createdAt: '', updatedAt: '' };
}

describe('watchView', () => {
  it('offers to add a symbol the active list lacks, naming the list', () => {
    expect(watchView('ready', list(['MSFT']), 'AAPL')).toEqual({
      action: 'add',
      watching: false,
      label: 'Watch',
      hint: 'Add AAPL to Core Tech',
    });
  });

  it('offers to remove a symbol the active list holds', () => {
    expect(watchView('ready', list(['AAPL']), 'AAPL')).toEqual({
      action: 'remove',
      watching: true,
      label: 'Watching',
      hint: 'Remove AAPL from Core Tech',
    });
    expect(watchView('ready', list(['BTC/USD']), 'btc/usd').watching).toBe(true);
  });

  it('explains a full list instead of adding', () => {
    const full = list(Array.from({ length: MAX_WATCHLIST_SYMBOLS }, (_, i) => `X${i}`));
    const view = watchView('ready', full, 'AAPL');
    expect(view.action).toBeNull();
    expect(view.hint).toBe('Core Tech is full (100 symbols max). Remove a symbol to add AAPL.');
  });

  it('still lets a symbol in a full list be removed', () => {
    const symbols = ['AAPL', ...Array.from({ length: MAX_WATCHLIST_SYMBOLS - 1 }, (_, i) => `X${i}`)];
    expect(watchView('ready', list(symbols), 'AAPL').action).toBe('remove');
  });

  it('explains why the toggle is unavailable without an active list', () => {
    expect(watchView('ready', null, 'AAPL')).toMatchObject({ action: null, hint: 'Create a watchlist to watch AAPL.' });
    expect(watchView('loading', null, 'AAPL')).toMatchObject({ action: null, hint: 'Loading your watchlists…' });
    expect(watchView('idle', null, 'AAPL').action).toBeNull();
    expect(watchView('error', null, 'AAPL').hint).toMatch(/couldn't be loaded/);
  });
});
