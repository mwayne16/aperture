import { useEffect, useMemo } from 'react';
import type { PriceAlert } from '../domain/types';
import { realtime } from '../data/dataLayer';
import { useAlertStore } from '../features/alerts/alertStore';
import { useActiveWatchlist } from '../features/watchlists/watchlistStore';
import { useUiStore } from './uiStore';

const NO_SYMBOLS: readonly string[] = [];

/**
 * Symbols the UI needs live quotes for: the active watchlist, the selected symbol, and enabled
 * alerts so the alerts panel can show the current price. Sorted and unique.
 */
export function subscribedSymbols(
  watchlist: readonly string[],
  selected: string | null,
  alerts: readonly PriceAlert[],
): string[] {
  const symbols = new Set(watchlist);
  if (selected !== null) symbols.add(selected);
  for (const alert of alerts) if (alert.enabled) symbols.add(alert.symbol);
  return [...symbols].sort();
}

/**
 * The symbols the app keeps subscribed. The list keeps its identity until the set of symbols
 * changes, so alert pushes or watchlist edits that keep the same symbols don't look like a change.
 */
export function useSubscribedSymbols(): readonly string[] {
  const watchlist = useActiveWatchlist()?.symbols ?? NO_SYMBOLS;
  const selected = useUiStore((s) => s.selectedSymbol);
  const alerts = useAlertStore((s) => s.alerts);
  // ** Symbols never contain a comma, so the joined string identifies the set.
  const key = useMemo(
    () => subscribedSymbols(watchlist, selected, alerts).join(','),
    [watchlist, selected, alerts],
  );
  return useMemo(() => (key === '' ? NO_SYMBOLS : key.split(',')), [key]);
}

/** Keeps the realtime subscriptions in step with what the UI shows. */
export function useQuoteSubscriptions(): void {
  const symbols = useSubscribedSymbols();
  useEffect(() => {
    realtime.setSubscriptions(symbols);
  }, [symbols]);
}
