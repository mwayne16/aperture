import { create } from 'zustand';
import { showToast } from '../../components/ui/toastStore';
import { isApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import { normalizeSymbol } from '../../domain/symbols';
import type { Watchlist } from '../../domain/types';
import { checkWatchlistSymbol, isPermutation, reinsertAt, undoReorder } from './watchlistRules';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface LoadOptions {
  /** Start a new request even if a load is in flight, e.g. after the server data was reset. */
  force?: boolean;
}

/**
 * The user's single watchlist, backed by `api` from data/dataLayer.ts.
 *
 * Error contract:
 * - load() never rejects: a failure sets status 'error' and `error`. A call while a load is in flight
 *   returns that load instead of starting another. load({ force: true }) always starts a new request,
 *   and the result of the load it replaces is ignored.
 * - addSymbol rejects with ApiError so forms can show the message inline. Adding a symbol that is
 *   already being added joins that request.
 * - removeSymbol and reorder are optimistic: the UI updates immediately; on failure the previous
 *   state is restored, an error toast is shown, and the promise still resolves.
 */
export interface WatchlistState {
  status: LoadStatus;
  error: string | null;
  /** Null until the first load succeeds. */
  watchlist: Watchlist | null;

  load(options?: LoadOptions): Promise<void>;
  addSymbol(symbol: string): Promise<void>;
  removeSymbol(symbol: string): Promise<void>;
  reorder(symbols: readonly string[]): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'Something went wrong. Try again.';
}

/** The server no longer has what the optimistic write removed, so the removal already holds. */
function alreadyGone(error: unknown): boolean {
  return isApiError(error) && error.code === 'NOT_FOUND';
}

let inFlightLoad: Promise<void> | null = null;
/** Numbers each load, so only the newest one may apply its result. */
let loadSeq = 0;
/** Writes in flight. A server copy is adopted only once the last of them settles. */
let pendingWrites = 0;
/** Adds in flight by symbol, so a repeated add joins the first. */
const pendingAdds = new Map<string, Promise<void>>();

export const useWatchlistStore = create<WatchlistState>()((set, get) => {
  function updateSymbols(update: (symbols: string[]) => string[]): void {
    set((s) => (s.watchlist ? { watchlist: { ...s.watchlist, symbols: update(s.watchlist.symbols) } } : s));
  }

  // Adopts the server's copy once no other write is in flight. Until then only this write's own
  // change is applied, so a response can't undo optimistic changes still pending.
  function settle(server: Watchlist, ownChange: (symbols: string[]) => string[] = (symbols) => symbols): void {
    pendingWrites -= 1;
    if (pendingWrites <= 0) {
      pendingWrites = 0;
      set({ watchlist: server });
    } else {
      updateSymbols(ownChange);
    }
  }

  async function sendAdd(symbol: string): Promise<void> {
    pendingWrites += 1;
    let server: Watchlist;
    try {
      server = await api.addSymbol(symbol);
    } catch (error) {
      pendingWrites -= 1;
      throw error;
    }
    settle(server, (symbols) => (symbols.includes(symbol) ? symbols : [...symbols, symbol]));
  }

  return {
    status: 'idle',
    error: null,
    watchlist: null,

    load({ force = false } = {}) {
      if (inFlightLoad && !force) return inFlightLoad;
      loadSeq += 1;
      const seq = loadSeq;
      const isCurrent = () => seq === loadSeq;
      set({ status: 'loading', error: null });
      const request = (async () => {
        // ** Yield first, so `inFlightLoad` points at this load before it can finish.
        await Promise.resolve();
        try {
          const watchlist = await api.getWatchlist();
          if (isCurrent()) set({ status: 'ready', error: null, watchlist });
        } catch (error) {
          if (isCurrent()) set({ status: 'error', error: messageOf(error) });
        } finally {
          if (isCurrent()) inFlightLoad = null;
        }
      })();
      inFlightLoad = request;
      return request;
    },

    async addSymbol(symbol) {
      const normalized = checkWatchlistSymbol(symbol, get().watchlist?.symbols ?? []);
      let request = pendingAdds.get(normalized);
      if (!request) {
        request = sendAdd(normalized).finally(() => pendingAdds.delete(normalized));
        pendingAdds.set(normalized, request);
      }
      return request;
    },

    async removeSymbol(symbol) {
      const normalized = normalizeSymbol(symbol);
      const index = get().watchlist?.symbols.indexOf(normalized) ?? -1;
      if (index === -1) return;
      pendingWrites += 1;
      updateSymbols((symbols) => symbols.filter((s) => s !== normalized));
      try {
        settle(await api.removeSymbol(normalized));
      } catch (error) {
        pendingWrites -= 1;
        if (alreadyGone(error)) return;
        updateSymbols((symbols) => reinsertAt(symbols, normalized, index, (a, b) => a === b));
        showToast({ tone: 'error', title: `Couldn't remove ${normalized}`, description: messageOf(error) });
      }
    },

    async reorder(symbols) {
      const previous = get().watchlist?.symbols;
      if (!previous) return;
      const attempted = symbols.map(normalizeSymbol);
      if (!isPermutation(attempted, previous)) {
        showToast({
          tone: 'error',
          title: "Couldn't reorder symbols",
          description: 'The new order does not match the symbols in your watchlist.',
        });
        return;
      }
      if (attempted.every((s, i) => s === previous[i])) return;
      pendingWrites += 1;
      updateSymbols(() => attempted);
      try {
        settle(await api.reorderSymbols(attempted));
      } catch (error) {
        pendingWrites -= 1;
        updateSymbols((current) => undoReorder(current, attempted, previous));
        showToast({ tone: 'error', title: "Couldn't reorder symbols", description: messageOf(error) });
      }
    },
  };
});

const NO_SYMBOLS: readonly string[] = [];

/** The watchlist's symbols in order; empty until it loads. */
export function useWatchlistSymbols(): readonly string[] {
  return useWatchlistStore((s) => s.watchlist?.symbols ?? NO_SYMBOLS);
}
