import { useEffect } from 'react';
import { startDataLayer } from '../data/dataLayer';
import { useAlertStore } from '../features/alerts/alertStore';
import { useWatchlistStore } from '../features/watchlists/watchlistStore';

/** Connects the realtime feed and loads the watchlist and alerts while the app is mounted. */
export function useAppStartup(): void {
  useEffect(() => {
    const stop = startDataLayer();
    void useWatchlistStore.getState().load();
    void useAlertStore.getState().load();
    return stop;
  }, []);
}
