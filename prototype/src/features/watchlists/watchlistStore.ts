import { create } from 'zustand';
import type { Watchlist } from '../../domain/types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Watchlist state backed by `api` from data/dataLayer.ts. Implemented by the watchlists task.
 *
 * Error contract:
 * - load() never rejects: a failure sets status 'error' and `error`. A call while a load is in flight
 *   returns that load instead of starting another.
 * - create, rename, addSymbol reject with ApiError so forms can show the message inline.
 * - remove, removeSymbol, reorder are optimistic: the UI updates immediately; on failure the
 *   previous state is restored, an error toast is shown, and the promise still resolves.
 * - The active watchlist id is a UI preference persisted in localStorage ('aperture.activeWatchlist').
 *   If it points at a deleted list, the first list becomes active.
 */
export interface WatchlistState {
  status: LoadStatus;
  error: string | null;
  watchlists: Watchlist[];
  activeId: string | null;

  load(): Promise<void>;
  setActive(id: string): void;
  create(name: string): Promise<Watchlist>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  addSymbol(id: string, symbol: string): Promise<void>;
  removeSymbol(id: string, symbol: string): Promise<void>;
  reorder(id: string, symbols: readonly string[]): Promise<void>;
}

const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'));

export const useWatchlistStore = create<WatchlistState>()(() => ({
  status: 'idle',
  error: null,
  watchlists: [],
  activeId: null,
  load: () => Promise.resolve(),
  setActive: () => undefined,
  create: notImplemented,
  rename: notImplemented,
  remove: notImplemented,
  addSymbol: notImplemented,
  removeSymbol: notImplemented,
  reorder: notImplemented,
}));

/** The active watchlist, or null when none exist or they haven't loaded. */
export function useActiveWatchlist(): Watchlist | null {
  return useWatchlistStore((s) => s.watchlists.find((w) => w.id === s.activeId) ?? null);
}
