import { isCryptoSymbol, type ProviderLimits } from './provider.js';

/** Symbols that need prices, by why they need them. */
export interface Demand {
  /** Symbols open on screen, e.g. a stock page. */
  focus: readonly string[];
  /** Symbols of enabled alerts. */
  alerts: readonly string[];
  /** Watchlist rows. */
  watchlist: readonly string[];
  /** Other symbols the app shows, e.g. search results or the movers list. */
  viewed: readonly string[];
}

export interface SubscriptionPlan {
  /** Symbols to subscribe to on each live stream. */
  streamed: { stocks: string[]; crypto: string[] };
  /** Symbols that didn't fit a stream and are polled instead. */
  polled: string[];
}

/**
 * Splits demand between the live streams and polling. Symbols are placed in priority order, each once,
 * into its asset class's stream while that stream has room; whatever doesn't fit is polled. The watchlist
 * goes first: it holds at most 30 symbols, a stream's cap, so it always streams in full. The remaining room
 * goes to the open stock page, then to enabled alerts, then to other symbols the app shows.
 */
export function planSubscriptions(
  demand: Demand,
  caps: ProviderLimits['streamSymbolsPerConnection'],
): SubscriptionPlan {
  const plan: SubscriptionPlan = { streamed: { stocks: [], crypto: [] }, polled: [] };
  const seen = new Set<string>();
  for (const symbol of [...demand.watchlist, ...demand.focus, ...demand.alerts, ...demand.viewed]) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const kind = isCryptoSymbol(symbol) ? 'crypto' : 'stocks';
    const cap = caps[kind];
    if (cap === null || plan.streamed[kind].length < cap) plan.streamed[kind].push(symbol);
    else plan.polled.push(symbol);
  }
  return plan;
}
