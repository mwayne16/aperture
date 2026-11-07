import { describe, expect, it } from 'vitest';
import { isApiError } from '../../data/api';
import { MAX_WATCHLIST_SYMBOLS } from '../../domain/symbols';
import type { Watchlist } from '../../domain/types';
import {
  checkWatchlistName,
  checkWatchlistSymbol,
  isPermutation,
  neighbourId,
  pickActiveId,
  reinsertAt,
  undoReorder,
} from './watchlistRules';

const list = (id: string): Watchlist => ({ id, name: id, symbols: [], createdAt: '', updatedAt: '' });
const lists = ['a', 'b', 'c'].map(list);

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('checkWatchlistName', () => {
  it('returns the trimmed name', () => {
    expect(checkWatchlistName('  Energy  ', ['Tech'])).toBe('Energy');
  });

  it('reports a blank name as a validation error on the name field', () => {
    const error = thrown(() => checkWatchlistName('   ', []));
    expect(isApiError(error) && error.code).toBe('VALIDATION_ERROR');
    expect(isApiError(error) && error.details).toEqual([
      { field: 'name', message: 'Enter a watchlist name.' },
    ]);
  });

  it('reports a duplicate (ignoring case) as a conflict', () => {
    const error = thrown(() => checkWatchlistName('core tech', ['Core Tech']));
    expect(isApiError(error) && error.code).toBe('CONFLICT');
    expect(isApiError(error) && error.message).toBe('You already have a watchlist with this name.');
  });
});

describe('checkWatchlistSymbol', () => {
  it('returns the normalized symbol', () => {
    expect(checkWatchlistSymbol(' brk.b ', ['AAPL'])).toBe('BRK.B');
  });

  it('reports a bad format as a validation error', () => {
    const error = thrown(() => checkWatchlistSymbol('TOOLONG', []));
    expect(isApiError(error) && error.code).toBe('VALIDATION_ERROR');
    expect(isApiError(error) && error.details[0]?.field).toBe('symbol');
  });

  it('reports a duplicate as a conflict', () => {
    const error = thrown(() => checkWatchlistSymbol('aapl', ['AAPL']));
    expect(isApiError(error) && error.code).toBe('CONFLICT');
    expect(isApiError(error) && error.message).toBe('AAPL is already in this watchlist.');
  });

  it('reports a full list as a validation error', () => {
    const letters = (i: number) => String.fromCharCode(65 + (i % 26), 65 + Math.floor(i / 26));
    const full = Array.from({ length: MAX_WATCHLIST_SYMBOLS }, (_, i) => `S${letters(i)}`);
    const error = thrown(() => checkWatchlistSymbol('ZZZZ', full));
    expect(isApiError(error) && error.code).toBe('VALIDATION_ERROR');
  });
});

describe('pickActiveId', () => {
  it('uses the first candidate that still exists', () => {
    expect(pickActiveId(lists, [null, 'gone', 'b'])).toBe('b');
  });

  it('falls back to the first list, or null when there are none', () => {
    expect(pickActiveId(lists, ['gone'])).toBe('a');
    expect(pickActiveId([], ['a'])).toBeNull();
  });
});

describe('neighbourId', () => {
  it('prefers the next list and falls back to the previous one', () => {
    expect(neighbourId(lists, 'a')).toBe('b');
    expect(neighbourId(lists, 'c')).toBe('b');
  });

  it('returns null for the only list or an unknown id', () => {
    expect(neighbourId([list('a')], 'a')).toBeNull();
    expect(neighbourId(lists, 'x')).toBeNull();
  });
});

describe('reinsertAt', () => {
  const same = (a: string, b: string) => a === b;

  it('puts an item back at its index, clamped to the end', () => {
    expect(reinsertAt(['a', 'c'], 'b', 1, same)).toEqual(['a', 'b', 'c']);
    expect(reinsertAt(['a'], 'b', 5, same)).toEqual(['a', 'b']);
  });

  it('does not duplicate an item that is already back', () => {
    expect(reinsertAt(['a', 'b'], 'b', 0, same)).toEqual(['a', 'b']);
  });
});

describe('isPermutation', () => {
  it('accepts the same symbols in another order', () => {
    expect(isPermutation(['B', 'A'], ['A', 'B'])).toBe(true);
  });

  it('rejects missing, extra and repeated symbols', () => {
    expect(isPermutation(['A'], ['A', 'B'])).toBe(false);
    expect(isPermutation(['A', 'C'], ['A', 'B'])).toBe(false);
    expect(isPermutation(['A', 'A'], ['A', 'B'])).toBe(false);
  });
});

describe('undoReorder', () => {
  it('restores the previous order', () => {
    expect(undoReorder(['C', 'A', 'B'], ['C', 'A', 'B'], ['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('keeps symbols added since at the end and drops removed ones', () => {
    expect(undoReorder(['C', 'B', 'D'], ['C', 'A', 'B'], ['A', 'B', 'C'])).toEqual(['B', 'C', 'D']);
  });

  it('keeps a later reorder', () => {
    expect(undoReorder(['B', 'C', 'A'], ['C', 'A', 'B'], ['A', 'B', 'C'])).toEqual(['B', 'C', 'A']);
  });
});
