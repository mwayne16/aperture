import { useEffect, useMemo } from 'react';
import type { PriceAlert } from '../domain/types';
import { realtime } from '../data/dataLayer';
import { useAlertStore } from '../features/alerts/alertStore';
import { useWatchlistSymbols } from '../features/watchlists/watchlistStore';
import { useUiStore } from './uiStore';

const NO_SYMBOLS: readonly string[] = [];

interface SubscriptionSources {
  watchlist: readonly string[];
  selected: string | null;
  alertDraft: string | null;
  alerts: readonly PriceAlert[];
}

/**
 * Symbols the UI needs live quotes for: the watchlist, the selected symbol, the symbol typed
 * into the alert dialog, and every alert's symbol. Disabled alerts are included so the alerts panel
 * never shows a frozen last price as current.
 * Sorted and unique.
 */
export function subscribedSymbols({
  watchlist,
  selected,
  alertDraft,
  alerts,
}: SubscriptionSources): string[] {
  const symbols = new Set(watchlist);
  if (selected !== null) symbols.add(selected);
  if (alertDraft !== null) symbols.add(alertDraft);
  for (const alert of alerts) symbols.add(alert.symbol);
  return [...symbols].sort();
}

/**
 * The symbols the app keeps subscribed. The list keeps its identity until the set of symbols
 * changes, so alert pushes or watchlist edits that keep the same symbols don't look like a change.
 */
export function useSubscribedSymbols(): readonly string[] {
  const watchlist = useWatchlistSymbols();
  const selected = useUiStore((s) => s.selectedSymbol);
  const alertDraft = useUiStore((s) => s.alertDraftSymbol);
  const alerts = useAlertStore((s) => s.alerts);
  // ** Symbols never contain a comma, so the joined string identifies the set.
  const key = useMemo(
    () => subscribedSymbols({ watchlist, selected, alertDraft, alerts }).join(','),
    [watchlist, selected, alertDraft, alerts],
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
