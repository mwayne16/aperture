import { create } from 'zustand';
import { showToast } from '../../components/ui/toastStore';
import { ApiError, isApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import { normalizeSymbol } from '../../domain/symbols';
import type { Watchlist } from '../../domain/types';
import {
  checkWatchlistName,
  checkWatchlistSymbol,
  isPermutation,
  neighbourId,
  pickActiveId,
  reinsertAt,
  undoReorder,
} from './watchlistRules';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Watchlist state backed by `api` from data/dataLayer.ts.
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

const ACTIVE_STORAGE_KEY = 'aperture.activeWatchlist';

function readStoredActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeActiveId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_STORAGE_KEY);
    else localStorage.setItem(ACTIVE_STORAGE_KEY, id);
  } catch {
    // ** Blocked storage only loses the preference; the in-memory choice still applies.
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'Something went wrong. Try again.';
}

function notFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Watchlist not found.', 404);
}

/** The server no longer has what the optimistic write removed, so the removal already holds. */
function alreadyGone(error: unknown): boolean {
  return isApiError(error) && error.code === 'NOT_FOUND';
}

let inFlightLoad: Promise<void> | null = null;
/** Lists whose optimistic delete is in flight, so a load that lands meanwhile doesn't bring them back. */
const pendingDeletes = new Set<string>();
/** Writes in flight per watchlist id. */
const pendingWrites = new Map<string, number>();
/** Adds in flight per "listId symbol", so a repeated add joins the first. */
const pendingAdds = new Map<string, Promise<void>>();

function beginWrite(id: string): void {
  pendingWrites.set(id, (pendingWrites.get(id) ?? 0) + 1);
}

/** Ends a write and tells whether it was the last one in flight for that list. */
function endWrite(id: string): boolean {
  const left = (pendingWrites.get(id) ?? 1) - 1;
  if (left > 0) pendingWrites.set(id, left);
  else pendingWrites.delete(id);
  return left <= 0;
}

export const useWatchlistStore = create<WatchlistState>()((set, get) => {
  function find(id: string): Watchlist | undefined {
    return get().watchlists.find((w) => w.id === id);
  }

  function updateList(id: string, update: (watchlist: Watchlist) => Watchlist): void {
    set((s) => ({ watchlists: s.watchlists.map((w) => (w.id === id ? update(w) : w)) }));
  }

  // Adopts the server's copy once no other write for the list is in flight. Until then only this
  // write's own change is applied, so a response can't undo optimistic changes still pending.
  function settle(server: Watchlist, ownChange: (watchlist: Watchlist) => Watchlist = (w) => w): void {
    const last = endWrite(server.id);
    updateList(server.id, (w) => (last ? server : ownChange(w)));
  }

  function setActiveId(id: string | null): void {
    set({ activeId: id });
    storeActiveId(id);
  }

  async function sendAdd(id: string, symbol: string): Promise<void> {
    beginWrite(id);
    let server: Watchlist;
    try {
      server = await api.addSymbol(id, symbol);
    } catch (error) {
      endWrite(id);
      throw error;
    }
    settle(server, (w) => (w.symbols.includes(symbol) ? w : { ...w, symbols: [...w.symbols, symbol] }));
  }

  return {
    status: 'idle',
    error: null,
    watchlists: [],
    activeId: null,

    load() {
      if (inFlightLoad) return inFlightLoad;
      set({ status: 'loading', error: null });
      inFlightLoad = (async () => {
        try {
          const watchlists = (await api.listWatchlists()).filter((w) => !pendingDeletes.has(w.id));
          // ** The in-memory choice wins over storage, which may be blocked or stale.
          const activeId = pickActiveId(watchlists, [get().activeId, readStoredActiveId()]);
          set({ status: 'ready', error: null, watchlists });
          setActiveId(activeId);
        } catch (error) {
          set({ status: 'error', error: messageOf(error) });
        } finally {
          inFlightLoad = null;
        }
      })();
      return inFlightLoad;
    },

    setActive(id) {
      if (get().activeId === id || !find(id)) return;
      setActiveId(id);
    },

    async create(name) {
      const validName = checkWatchlistName(
        name,
        get().watchlists.map((w) => w.name),
      );
      const created = await api.createWatchlist({ name: validName });
      set((s) => ({
        watchlists: s.watchlists.some((w) => w.id === created.id) ? s.watchlists : [...s.watchlists, created],
      }));
      setActiveId(created.id);
      return created;
    },

    async rename(id, name) {
      const current = find(id);
      if (!current) throw notFound();
      const others = get()
        .watchlists.filter((w) => w.id !== id)
        .map((w) => w.name);
      const validName = checkWatchlistName(name, others);
      if (validName === current.name) return;
      beginWrite(id);
      let server: Watchlist;
      try {
        server = await api.renameWatchlist(id, validName);
      } catch (error) {
        endWrite(id);
        throw error;
      }
      settle(server, (w) => ({ ...w, name: server.name }));
    },

    async remove(id) {
      const { watchlists, activeId } = get();
      const index = watchlists.findIndex((w) => w.id === id);
      const removed = watchlists[index];
      if (!removed) return;
      const wasActive = activeId === id;
      const successor = wasActive ? neighbourId(watchlists, id) : activeId;
      set({ watchlists: watchlists.filter((w) => w.id !== id) });
      if (wasActive) setActiveId(successor);
      pendingDeletes.add(id);
      try {
        await api.deleteWatchlist(id);
        pendingDeletes.delete(id);
      } catch (error) {
        pendingDeletes.delete(id);
        if (alreadyGone(error)) return;
        set((s) => ({ watchlists: reinsertAt(s.watchlists, removed, index, (a, b) => a.id === b.id) }));
        // ** Give the list its active state back unless the user has picked another list since.
        if (wasActive && get().activeId === successor) setActiveId(id);
        showToast({
          tone: 'error',
          title: `Couldn't delete “${removed.name}”`,
          description: messageOf(error),
        });
      }
    },

    async addSymbol(id, symbol) {
      const current = find(id);
      if (!current) throw notFound();
      const normalized = checkWatchlistSymbol(symbol, current.symbols);
      const key = `${id} ${normalized}`;
      let request = pendingAdds.get(key);
      if (!request) {
        request = sendAdd(id, normalized).finally(() => pendingAdds.delete(key));
        pendingAdds.set(key, request);
      }
      return request;
    },

    async removeSymbol(id, symbol) {
      const normalized = normalizeSymbol(symbol);
      const index = find(id)?.symbols.indexOf(normalized) ?? -1;
      if (index === -1) return;
      beginWrite(id);
      updateList(id, (w) => ({ ...w, symbols: w.symbols.filter((s) => s !== normalized) }));
      try {
        settle(await api.removeSymbol(id, normalized));
      } catch (error) {
        endWrite(id);
        if (alreadyGone(error)) return;
        updateList(id, (w) => ({
          ...w,
          symbols: reinsertAt(w.symbols, normalized, index, (a, b) => a === b),
        }));
        showToast({ tone: 'error', title: `Couldn't remove ${normalized}`, description: messageOf(error) });
      }
    },

    async reorder(id, symbols) {
      const current = find(id);
      if (!current) return;
      const attempted = symbols.map(normalizeSymbol);
      if (!isPermutation(attempted, current.symbols)) {
        showToast({
          tone: 'error',
          title: "Couldn't reorder symbols",
          description: 'The new order does not match the symbols in this watchlist.',
        });
        return;
      }
      const previous = current.symbols;
      if (attempted.every((s, i) => s === previous[i])) return;
      beginWrite(id);
      updateList(id, (w) => ({ ...w, symbols: attempted }));
      try {
        settle(await api.reorderSymbols(id, attempted));
      } catch (error) {
        endWrite(id);
        updateList(id, (w) => ({ ...w, symbols: undoReorder(w.symbols, attempted, previous) }));
        showToast({ tone: 'error', title: "Couldn't reorder symbols", description: messageOf(error) });
      }
    },
  };
});

/** The active watchlist, or null when none exist or they haven't loaded. */
export function useActiveWatchlist(): Watchlist | null {
  return useWatchlistStore((s) => s.watchlists.find((w) => w.id === s.activeId) ?? null);
}
