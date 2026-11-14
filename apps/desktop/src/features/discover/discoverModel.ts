import type { Instrument, Quote, Watchlist } from '../../domain/types';
import { MAX_WATCHLIST_SYMBOLS } from '@aperture/shared/symbols';

/**
 * Pure rules behind the Discover table: filtering by symbol or name, column sorting, and what the
 * watch star can do for a row.
 */

export type SortColumn = 'symbol' | 'last' | 'change' | 'changePct' | 'volume';
type SortDirection = 'asc' | 'desc';

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

export interface DiscoverRow {
  instrument: Instrument;
  /** Latest snapshot, or undefined while prices load or when the symbol has none. */
  quote: Quote | undefined;
}

export const DEFAULT_SORT: SortState = { column: 'symbol', direction: 'asc' };

function searchable(value: string): string {
  return value.toLowerCase();
}

/**
 * Instruments whose symbol or name contains `query`, ignoring case and surrounding spaces. The slash
 * in crypto pairs is optional, so "btcusd" finds BTC/USD. A blank query keeps everything.
 */
export function filterInstruments(instruments: readonly Instrument[], query: string): Instrument[] {
  const needle = searchable(query.trim());
  if (needle === '') return [...instruments];
  return instruments.filter((instrument) => {
    const symbol = searchable(instrument.symbol);
    return (
      symbol.includes(needle) ||
      symbol.replace('/', '').includes(needle) ||
      searchable(instrument.name).includes(needle)
    );
  });
}

function sortValue(row: DiscoverRow, column: Exclude<SortColumn, 'symbol'>): number | null {
  const value = row.quote?.[column];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Rows ordered by `sort`. Rows without a value for the column always go last, whichever the
 * direction, and ties fall back to symbol order so rows don't swap places between refreshes.
 */
export function sortRows(rows: readonly DiscoverRow[], sort: SortState): DiscoverRow[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const bySymbol = (a: DiscoverRow, b: DiscoverRow) => a.instrument.symbol.localeCompare(b.instrument.symbol);
  const { column } = sort;
  if (column === 'symbol') return [...rows].sort((a, b) => sign * bySymbol(a, b));
  return [...rows].sort((a, b) => {
    const left = sortValue(a, column);
    const right = sortValue(b, column);
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
      return bySymbol(a, b);
    }
    return sign * (left - right) || bySymbol(a, b);
  });
}

/**
 * The sort after a header click: the same column flips direction, a new column starts A to Z for
 * symbols and largest first for numbers.
 */
export function nextSort(current: SortState, column: SortColumn): SortState {
  if (current.column === column) return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { column, direction: column === 'symbol' ? 'asc' : 'desc' };
}

export function ariaSort(sort: SortState, column: SortColumn): 'ascending' | 'descending' | 'none' {
  if (sort.column !== column) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

export interface WatchToggleView {
  /** The symbol is in the watchlist. */
  watching: boolean;
  /** Pressing it can't do anything right now; `hint` says why. */
  disabled: boolean;
  /** Tooltip text: what pressing does, or why it can't. */
  hint: string;
}

type WatchlistsLoad = 'loading' | 'ready' | 'error';

const NO_LIST_HINT: Readonly<Record<WatchlistsLoad, string>> = {
  loading: 'Your watchlist is loading.',
  error: "Your watchlist couldn't be loaded.",
  ready: 'Your watchlist is loading.',
};

/**
 * What the watch star does for `symbol`: add it to the watchlist, remove it, or nothing while the
 * list hasn't loaded or is full. `load` explains a missing list.
 */
export function watchToggleView(
  watchlist: Watchlist | null,
  symbol: string,
  load: WatchlistsLoad,
): WatchToggleView {
  if (watchlist === null) {
    return { watching: false, disabled: true, hint: NO_LIST_HINT[load] };
  }
  if (watchlist.symbols.includes(symbol)) {
    return { watching: true, disabled: false, hint: 'Remove from your watchlist' };
  }
  if (watchlist.symbols.length >= MAX_WATCHLIST_SYMBOLS) {
    return {
      watching: false,
      disabled: true,
      hint: `Your watchlist is full (${MAX_WATCHLIST_SYMBOLS} symbols max).`,
    };
  }
  return { watching: false, disabled: false, hint: 'Add to your watchlist' };
}
