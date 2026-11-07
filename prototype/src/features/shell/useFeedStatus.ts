import { useMemo } from 'react';
import { useUiStore } from '../../app/uiStore';
import { subscribedSymbols } from '../../app/useQuoteSubscriptions';
import { useQuoteStore } from '../../data/quoteStore';
import { useAlertStore } from '../alerts/alertStore';
import { useActiveWatchlist } from '../watchlists/watchlistStore';
import { quoteFreshness, type QuoteFreshness } from './connectionStatus';

const NO_SYMBOLS: readonly string[] = [];

/** The symbols the app keeps subscribed, derived from the same inputs as useQuoteSubscriptions. */
export function useSubscribedSymbols(): readonly string[] {
  const watchlist = useActiveWatchlist()?.symbols ?? NO_SYMBOLS;
  const selected = useUiStore((s) => s.selectedSymbol);
  const alerts = useAlertStore((s) => s.alerts);
  return useMemo(() => subscribedSymbols(watchlist, selected, alerts), [watchlist, selected, alerts]);
}

/**
 * Freshness of the subscribed symbols' quotes. Symbols the app no longer watches are left out, since
 * their last quote keeps whatever status it had when the subscription ended.
 */
export function useQuoteFreshness(symbols: readonly string[]): QuoteFreshness {
  return useQuoteStore((state) => quoteFreshness(symbols.map((symbol) => state.quotes[symbol]?.status)));
}
