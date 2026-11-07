import { MAX_WATCHLIST_SYMBOLS, normalizeSymbol } from '../../domain/symbols';
import type { Watchlist } from '../../domain/types';

/** What the stock page's watch (star) toggle shows for a symbol and the active watchlist. */

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WatchView {
  /** Add or remove on press, or nothing when the toggle is unavailable. */
  action: 'add' | 'remove' | null;
  /** True while the symbol is in the active list. */
  watching: boolean;
  /** Button text. */
  label: string;
  /** Tooltip: names the list, or explains why the toggle is unavailable. */
  hint: string;
}

export function watchView(status: LoadStatus, list: Watchlist | null, symbol: string): WatchView {
  const unavailable = (hint: string): WatchView => ({ action: null, watching: false, label: 'Watch', hint });
  if (!list) {
    if (status === 'error') return unavailable("Watchlists couldn't be loaded, so nothing can be added right now.");
    if (status !== 'ready') return unavailable('Loading your watchlists…');
    return unavailable(`Create a watchlist to watch ${symbol}.`);
  }
  const key = normalizeSymbol(symbol);
  if (list.symbols.some((s) => normalizeSymbol(s) === key)) {
    return { action: 'remove', watching: true, label: 'Watching', hint: `Remove ${symbol} from ${list.name}` };
  }
  if (list.symbols.length >= MAX_WATCHLIST_SYMBOLS) {
    return unavailable(`${list.name} is full (${MAX_WATCHLIST_SYMBOLS} symbols max). Remove a symbol to add ${symbol}.`);
  }
  return { action: 'add', watching: false, label: 'Watch', hint: `Add ${symbol} to ${list.name}` };
}
