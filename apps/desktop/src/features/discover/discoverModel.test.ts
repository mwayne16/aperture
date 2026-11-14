import { describe, expect, it } from 'vitest';
import { MAX_WATCHLIST_SYMBOLS } from '../../domain/symbols';
import type { Instrument, Quote, Watchlist } from '../../domain/types';
import {
  ariaSort,
  DEFAULT_SORT,
  filterInstruments,
  nextSort,
  sortRows,
  watchToggleView,
  type DiscoverRow,
} from './discoverModel';

function instrument(symbol: string, name: string): Instrument {
  return { symbol, name, exchange: 'NASDAQ', assetClass: symbol.includes('/') ? 'crypto' : 'stock' };
}

const INSTRUMENTS = [
  instrument('AAPL', 'Apple Inc.'),
  instrument('MSFT', 'Microsoft Corporation'),
  instrument('BTC/USD', 'Bitcoin'),
  instrument('PAPL', 'Pineapple Holdings'),
];

function row(symbol: string, values: Partial<Quote> | null): DiscoverRow {
  const quote =
    values === null
      ? undefined
      : ({ symbol, last: null, change: null, changePct: null, volume: null, ...values } as Quote);
  return { instrument: instrument(symbol, symbol), quote };
}

function symbols(rows: readonly DiscoverRow[]): string[] {
  return rows.map((r) => r.instrument.symbol);
}

describe('filterInstruments', () => {
  it('keeps everything for a blank query', () => {
    expect(filterInstruments(INSTRUMENTS, '   ')).toEqual(INSTRUMENTS);
  });

  it('matches symbol or name, ignoring case and surrounding spaces', () => {
    expect(filterInstruments(INSTRUMENTS, ' msft ').map((i) => i.symbol)).toEqual(['MSFT']);
    expect(filterInstruments(INSTRUMENTS, 'apple').map((i) => i.symbol)).toEqual(['AAPL', 'PAPL']);
    expect(filterInstruments(INSTRUMENTS, 'corp').map((i) => i.symbol)).toEqual(['MSFT']);
  });

  it('finds crypto pairs with or without the slash', () => {
    expect(filterInstruments(INSTRUMENTS, 'btc/u').map((i) => i.symbol)).toEqual(['BTC/USD']);
    expect(filterInstruments(INSTRUMENTS, 'btcusd').map((i) => i.symbol)).toEqual(['BTC/USD']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterInstruments(INSTRUMENTS, 'zzz')).toEqual([]);
  });
});

describe('sortRows', () => {
  const rows = [
    row('MSFT', { last: 400, change: -2, changePct: -0.5, volume: 10 }),
    row('AAPL', { last: 200, change: 3, changePct: 1.5, volume: 30 }),
    row('NVDA', { last: null, change: null, changePct: null, volume: null }),
    row('AMD', null),
    row('INTC', { last: 20, change: 3, changePct: 15, volume: 20 }),
  ];

  it('orders by symbol in either direction', () => {
    expect(symbols(sortRows(rows, DEFAULT_SORT))).toEqual(['AAPL', 'AMD', 'INTC', 'MSFT', 'NVDA']);
    expect(symbols(sortRows(rows, { column: 'symbol', direction: 'desc' }))).toEqual([
      'NVDA',
      'MSFT',
      'INTC',
      'AMD',
      'AAPL',
    ]);
  });

  it('orders by a number and keeps rows without one at the end in both directions', () => {
    expect(symbols(sortRows(rows, { column: 'last', direction: 'desc' }))).toEqual([
      'MSFT',
      'AAPL',
      'INTC',
      'AMD',
      'NVDA',
    ]);
    expect(symbols(sortRows(rows, { column: 'last', direction: 'asc' }))).toEqual([
      'INTC',
      'AAPL',
      'MSFT',
      'AMD',
      'NVDA',
    ]);
  });

  it('breaks ties by symbol so equal rows keep a stable order', () => {
    expect(symbols(sortRows(rows, { column: 'change', direction: 'desc' })).slice(0, 2)).toEqual([
      'AAPL',
      'INTC',
    ]);
    expect(symbols(sortRows(rows, { column: 'change', direction: 'asc' })).slice(1, 3)).toEqual([
      'AAPL',
      'INTC',
    ]);
  });

  it('sorts by percent change and volume', () => {
    expect(symbols(sortRows(rows, { column: 'changePct', direction: 'desc' })).slice(0, 3)).toEqual([
      'INTC',
      'AAPL',
      'MSFT',
    ]);
    expect(symbols(sortRows(rows, { column: 'volume', direction: 'desc' })).slice(0, 3)).toEqual([
      'AAPL',
      'INTC',
      'MSFT',
    ]);
  });

  it('does not change the input', () => {
    const input = [...rows];
    sortRows(input, { column: 'last', direction: 'asc' });
    expect(input).toEqual(rows);
  });
});

describe('nextSort and ariaSort', () => {
  it('flips the direction when the same column is chosen again', () => {
    expect(nextSort(DEFAULT_SORT, 'symbol')).toEqual({ column: 'symbol', direction: 'desc' });
    expect(nextSort({ column: 'last', direction: 'desc' }, 'last')).toEqual({
      column: 'last',
      direction: 'asc',
    });
  });

  it('starts numbers largest first and symbols A to Z', () => {
    expect(nextSort(DEFAULT_SORT, 'changePct')).toEqual({ column: 'changePct', direction: 'desc' });
    expect(nextSort({ column: 'volume', direction: 'asc' }, 'symbol')).toEqual({
      column: 'symbol',
      direction: 'asc',
    });
  });

  it('reports the sort only on the sorted column', () => {
    const sort = { column: 'last', direction: 'desc' } as const;
    expect(ariaSort(sort, 'last')).toBe('descending');
    expect(ariaSort({ ...sort, direction: 'asc' }, 'last')).toBe('ascending');
    expect(ariaSort(sort, 'symbol')).toBe('none');
  });
});

describe('watchToggleView', () => {
  const list = (symbolsInList: string[]): Watchlist => ({ symbols: symbolsInList, updatedAt: '' });

  it('offers to add a symbol the watchlist lacks', () => {
    expect(watchToggleView(list(['MSFT']), 'AAPL', 'ready')).toEqual({
      watching: false,
      disabled: false,
      hint: 'Add to your watchlist',
    });
  });

  it('offers to remove a symbol already in the list', () => {
    expect(watchToggleView(list(['AAPL']), 'AAPL', 'ready')).toEqual({
      watching: true,
      disabled: false,
      hint: 'Remove from your watchlist',
    });
  });

  it('is disabled when the list is full, but still removes a symbol it holds', () => {
    const full = list(
      Array.from({ length: MAX_WATCHLIST_SYMBOLS }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${i}`),
    );
    expect(watchToggleView(full, 'AAPL', 'ready')).toMatchObject({
      disabled: true,
      hint: 'Your watchlist is full (30 symbols max).',
    });
    const holding = list([...full.symbols.slice(1), 'AAPL']);
    expect(watchToggleView(holding, 'AAPL', 'ready')).toMatchObject({ watching: true, disabled: false });
  });

  it('is disabled until the watchlist loads, and says when loading failed', () => {
    expect(watchToggleView(null, 'AAPL', 'loading')).toEqual({
      watching: false,
      disabled: true,
      hint: 'Your watchlist is loading.',
    });
    expect(watchToggleView(null, 'AAPL', 'ready').hint).toBe('Your watchlist is loading.');
    expect(watchToggleView(null, 'AAPL', 'error')).toMatchObject({
      disabled: true,
      hint: "Your watchlist couldn't be loaded.",
    });
  });
});
