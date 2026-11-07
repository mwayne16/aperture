import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { ApiError } from '../../data/api';
import { api, resetDemoData } from '../../data/dataLayer';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import { useWatchlistStore } from './watchlistStore';

const ACTIVE_KEY = 'aperture.activeWatchlist';
const state = () => useWatchlistStore.getState();
const ids = () => state().watchlists.map((w) => w.id);
const symbolsOf = (id: string) => state().watchlists.find((w) => w.id === id)?.symbols;
const nameOf = (id: string) => state().watchlists.find((w) => w.id === id)?.name;
const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);
const serverSymbols = async (id: string) => (await api.listWatchlists()).find((w) => w.id === id)?.symbols;
const failNextCall = () => {
  updateSimulation({ failNextApiCall: true });
};

/** Holds each call until its gate opens, then runs the real mock, so the server sees calls in release order. */
function holdRemoveSymbol() {
  const real = api.removeSymbol.bind(api);
  const gates: (() => void)[] = [];
  vi.spyOn(api, 'removeSymbol').mockImplementation(async (id, symbol) => {
    await new Promise<void>((resolve) => gates.push(resolve));
    return real(id, symbol);
  });
  return gates;
}

function holdReorder() {
  const real = api.reorderSymbols.bind(api);
  const gates: (() => void)[] = [];
  vi.spyOn(api, 'reorderSymbols').mockImplementation(async (id, symbols) => {
    await new Promise<void>((resolve) => gates.push(resolve));
    return real(id, symbols);
  });
  return gates;
}

const CORE = 'wl-core-tech';
const CORE_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX'];
const SEED_IDS = [CORE, 'wl-index-etfs', 'wl-financials', 'wl-ideas'];

beforeEach(async () => {
  updateSimulation({ apiLatencyMs: 0, failNextApiCall: false });
  await resetDemoData();
  useWatchlistStore.setState({ status: 'idle', error: null, watchlists: [], activeId: null });
  dismissAllToasts();
});

afterEach(() => {
  resetSimulation();
});

async function loaded() {
  await state().load();
  expect(state().status).toBe('ready');
}

describe('load', () => {
  it('loads the lists and activates the first one when none is stored', async () => {
    const pending = state().load();
    expect(state().status).toBe('loading');
    await pending;
    expect(ids()).toEqual(SEED_IDS);
    expect(state().activeId).toBe(CORE);
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(CORE);
  });

  it('restores the stored active list', async () => {
    localStorage.setItem(ACTIVE_KEY, 'wl-financials');
    await loaded();
    expect(state().activeId).toBe('wl-financials');
  });

  it('falls back to the first list when the stored one no longer exists', async () => {
    localStorage.setItem(ACTIVE_KEY, 'wl-deleted');
    await loaded();
    expect(state().activeId).toBe(CORE);
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(CORE);
  });

  it('joins a load in flight instead of starting another', async () => {
    const list = vi.spyOn(api, 'listWatchlists');
    const first = state().load();
    const second = state().load();
    expect(second).toBe(first);
    await first;
    expect(list).toHaveBeenCalledTimes(1);

    await state().load();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('starts a new request when forced and ignores the load it replaces', async () => {
    const stale = await api.listWatchlists();
    let releaseStale: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (releaseStale = resolve));
    const list = vi.spyOn(api, 'listWatchlists').mockImplementationOnce(async () => {
      await gate;
      return stale;
    });
    const first = state().load();
    await api.createWatchlist({ name: 'Fresh' });
    const forced = state().load({ force: true });
    expect(forced).not.toBe(first);
    // A plain load joins the forced one.
    expect(state().load()).toBe(forced);
    await forced;
    expect(state().watchlists.map((w) => w.name)).toContain('Fresh');

    releaseStale();
    await expect(first).resolves.toBeUndefined();
    expect(state().watchlists.map((w) => w.name)).toContain('Fresh');
    expect(state().status).toBe('ready');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('ignores a failure of the load a forced one replaced', async () => {
    let failStale: () => void = () => undefined;
    const gate = new Promise<void>((_, reject) => {
      failStale = () => {
        reject(new Error('stale failure'));
      };
    });
    vi.spyOn(api, 'listWatchlists').mockImplementationOnce(async () => {
      await gate;
      return [];
    });
    const first = state().load();
    await state().load({ force: true });
    failStale();
    await first;
    expect(state().status).toBe('ready');
    expect(state().error).toBeNull();
    expect(ids()).toEqual(SEED_IDS);
  });

  it('never rejects: a failure sets the error, and a retry recovers', async () => {
    failNextCall();
    await expect(state().load()).resolves.toBeUndefined();
    expect(state().status).toBe('error');
    expect(state().error).toMatch(/temporarily unavailable/);

    await loaded();
    expect(state().error).toBeNull();
    expect(ids()).toEqual(SEED_IDS);
  });

  it('keeps the lists it has when a reload fails', async () => {
    await loaded();
    failNextCall();
    await state().load();
    expect(state().status).toBe('error');
    expect(ids()).toEqual(SEED_IDS);
    expect(state().activeId).toBe(CORE);
  });

  it('keeps the active list across a demo data reset', async () => {
    await loaded();
    state().setActive('wl-ideas');
    await resetDemoData();
    await state().load();
    expect(state().activeId).toBe('wl-ideas');
  });
});

describe('setActive', () => {
  it('activates a list and remembers it', async () => {
    await loaded();
    state().setActive('wl-index-etfs');
    expect(state().activeId).toBe('wl-index-etfs');
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('wl-index-etfs');
  });

  it('ignores unknown ids', async () => {
    await loaded();
    state().setActive('nope');
    expect(state().activeId).toBe(CORE);
  });
});

describe('create', () => {
  it('adds the list and makes it active', async () => {
    await loaded();
    const created = await state().create('  Energy ');
    expect(created.name).toBe('Energy');
    expect(ids()).toEqual([...SEED_IDS, created.id]);
    expect(state().activeId).toBe(created.id);
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(created.id);
  });

  it('rejects blank and duplicate names without calling the API', async () => {
    await loaded();
    const createWatchlist = vi.spyOn(api, 'createWatchlist');
    await expect(state().create('  ')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Enter a watchlist name.',
    });
    await expect(state().create('core TECH')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(createWatchlist).not.toHaveBeenCalled();
  });

  it('rejects with the API error when the server fails and adds nothing', async () => {
    await loaded();
    failNextCall();
    await expect(state().create('Energy')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(ids()).toEqual(SEED_IDS);
    expect(state().activeId).toBe(CORE);
  });
});

describe('rename', () => {
  it('renames the list on the client and the server', async () => {
    await loaded();
    await state().rename('wl-ideas', 'Watch next');
    expect(nameOf('wl-ideas')).toBe('Watch next');
    expect((await api.listWatchlists()).find((w) => w.id === 'wl-ideas')?.name).toBe('Watch next');
  });

  it("rejects another list's name but allows recasing its own", async () => {
    await loaded();
    await expect(state().rename('wl-ideas', 'financials')).rejects.toMatchObject({ code: 'CONFLICT' });
    await state().rename('wl-ideas', 'IDEAS');
    expect(nameOf('wl-ideas')).toBe('IDEAS');
  });

  it('skips the API when the name is unchanged', async () => {
    await loaded();
    const renameWatchlist = vi.spyOn(api, 'renameWatchlist');
    await state().rename('wl-ideas', ' Ideas ');
    expect(renameWatchlist).not.toHaveBeenCalled();
  });

  it('rejects for a list that no longer exists', async () => {
    await loaded();
    await expect(state().rename('wl-gone', 'Name')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('remove', () => {
  it('removes the active list at once and activates the next one', async () => {
    await loaded();
    const pending = state().remove(CORE);
    expect(ids()).toEqual(SEED_IDS.slice(1));
    expect(state().activeId).toBe('wl-index-etfs');
    await pending;
    expect((await api.listWatchlists()).map((w) => w.id)).toEqual(SEED_IDS.slice(1));
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('wl-index-etfs');
  });

  it('activates the previous list when the last one is deleted', async () => {
    await loaded();
    state().setActive('wl-ideas');
    await state().remove('wl-ideas');
    expect(state().activeId).toBe('wl-financials');
  });

  it('keeps the active list when another one is deleted', async () => {
    await loaded();
    await state().remove('wl-financials');
    expect(state().activeId).toBe(CORE);
  });

  it('leaves no active list after the last list is deleted', async () => {
    await loaded();
    for (const id of SEED_IDS) await state().remove(id);
    expect(state().watchlists).toEqual([]);
    expect(state().activeId).toBeNull();
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
  });

  it('restores the list, its position and its active state when the server fails', async () => {
    await loaded();
    failNextCall();
    await expect(state().remove(CORE)).resolves.toBeUndefined();
    expect(ids()).toEqual(SEED_IDS);
    expect(state().activeId).toBe(CORE);
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(CORE);
    expect(toastTitles()).toEqual(["Couldn't delete “Core Tech”"]);
  });

  it('does not take the active state back after the user picked another list', async () => {
    await loaded();
    failNextCall();
    const pending = state().remove(CORE);
    state().setActive('wl-ideas');
    await pending;
    expect(ids()).toEqual(SEED_IDS);
    expect(state().activeId).toBe('wl-ideas');
  });

  it('ignores a repeated delete of the same list', async () => {
    await loaded();
    const deleteWatchlist = vi.spyOn(api, 'deleteWatchlist');
    await Promise.all([state().remove('wl-ideas'), state().remove('wl-ideas')]);
    expect(deleteWatchlist).toHaveBeenCalledTimes(1);
    expect(toastTitles()).toEqual([]);
  });

  it('does not bring a list back when a reload lands while its delete is in flight', async () => {
    await loaded();
    const real = api.deleteWatchlist.bind(api);
    const gates: (() => void)[] = [];
    vi.spyOn(api, 'deleteWatchlist').mockImplementation(async (id) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return real(id);
    });
    const removal = state().remove(CORE);
    await state().load();
    expect(ids()).toEqual(SEED_IDS.slice(1));
    expect(state().activeId).toBe('wl-index-etfs');

    gates[0]!();
    await removal;
    await state().load();
    expect(ids()).toEqual(SEED_IDS.slice(1));
  });

  it('shows a list again on reload when its delete failed', async () => {
    await loaded();
    const gates: (() => void)[] = [];
    vi.spyOn(api, 'deleteWatchlist').mockImplementation(async () => {
      await new Promise<void>((resolve) => gates.push(resolve));
      throw new ApiError('UNAVAILABLE', 'The service is temporarily unavailable.', 503);
    });
    const removal = state().remove('wl-ideas');
    gates[0]!();
    await removal;
    await state().load();
    expect(ids()).toEqual(SEED_IDS);
  });
});

describe('addSymbol', () => {
  it('appends the normalized symbol', async () => {
    await loaded();
    await state().addSymbol('wl-ideas', ' pltr ');
    expect(symbolsOf('wl-ideas')).toEqual(['PLTR']);
    expect(await serverSymbols('wl-ideas')).toEqual(['PLTR']);
  });

  it('rejects a bad, duplicate or unknown-list request without calling the API', async () => {
    await loaded();
    const addSymbol = vi.spyOn(api, 'addSymbol');
    await expect(state().addSymbol(CORE, 'TOOLONG')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(state().addSymbol(CORE, 'aapl')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'AAPL is already in this watchlist.',
    });
    await expect(state().addSymbol('wl-gone', 'AAPL')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(addSymbol).not.toHaveBeenCalled();
  });

  it('joins a repeated add of the same symbol', async () => {
    await loaded();
    const addSymbol = vi.spyOn(api, 'addSymbol');
    await Promise.all([state().addSymbol('wl-ideas', 'PLTR'), state().addSymbol('wl-ideas', 'pltr')]);
    expect(addSymbol).toHaveBeenCalledTimes(1);
    expect(symbolsOf('wl-ideas')).toEqual(['PLTR']);
  });

  it('rejects with the API error when the server fails and changes nothing', async () => {
    await loaded();
    failNextCall();
    await expect(state().addSymbol('wl-ideas', 'PLTR')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(symbolsOf('wl-ideas')).toEqual([]);
    // A retry is a new request, not the failed one.
    await state().addSymbol('wl-ideas', 'PLTR');
    expect(symbolsOf('wl-ideas')).toEqual(['PLTR']);
  });

  it('keeps an optimistic removal that is still in flight', async () => {
    await loaded();
    const gates = holdRemoveSymbol();
    const removal = state().removeSymbol(CORE, 'AAPL');
    await state().addSymbol(CORE, 'PLTR');
    expect(symbolsOf(CORE)).toEqual([...CORE_SYMBOLS.slice(1), 'PLTR']);
    gates[0]!();
    await removal;
    expect(symbolsOf(CORE)).toEqual([...CORE_SYMBOLS.slice(1), 'PLTR']);
    expect(await serverSymbols(CORE)).toEqual(symbolsOf(CORE));
  });
});

describe('removeSymbol', () => {
  it('removes the symbol at once and confirms with the server', async () => {
    await loaded();
    const pending = state().removeSymbol(CORE, 'msft');
    expect(symbolsOf(CORE)).not.toContain('MSFT');
    await pending;
    expect(await serverSymbols(CORE)).not.toContain('MSFT');
  });

  it('puts the symbol back where it was and shows a toast when the server fails', async () => {
    await loaded();
    failNextCall();
    await expect(state().removeSymbol(CORE, 'NVDA')).resolves.toBeUndefined();
    expect(symbolsOf(CORE)).toEqual(CORE_SYMBOLS);
    expect(toastTitles()).toEqual(["Couldn't remove NVDA"]);
  });

  it('never shows a removed symbol again while rapid removals settle', async () => {
    await loaded();
    const gates = holdRemoveSymbol();
    const first = state().removeSymbol(CORE, 'AAPL');
    const second = state().removeSymbol(CORE, 'MSFT');
    const expected = CORE_SYMBOLS.slice(2);
    expect(symbolsOf(CORE)).toEqual(expected);

    gates[0]!();
    await first;
    expect(symbolsOf(CORE)).toEqual(expected);
    gates[1]!();
    await second;
    expect(symbolsOf(CORE)).toEqual(expected);
    expect(await serverSymbols(CORE)).toEqual(expected);
  });

  it('restores only the symbol whose removal failed', async () => {
    await loaded();
    const gates = holdRemoveSymbol();
    const first = state().removeSymbol(CORE, 'AAPL');
    const second = state().removeSymbol(CORE, 'MSFT');
    failNextCall();
    gates[0]!();
    await first;
    gates[1]!();
    await second;
    const expected = CORE_SYMBOLS.filter((s) => s !== 'MSFT');
    expect(symbolsOf(CORE)).toEqual(expected);
    expect(await serverSymbols(CORE)).toEqual(expected);
  });

  it('ignores a symbol that is not in the list', async () => {
    await loaded();
    const removeSymbol = vi.spyOn(api, 'removeSymbol');
    await state().removeSymbol(CORE, 'PLTR');
    expect(removeSymbol).not.toHaveBeenCalled();
  });
});

describe('reorder', () => {
  const moved = ['MSFT', 'AAPL', ...CORE_SYMBOLS.slice(2)];

  it('applies the new order at once and persists it', async () => {
    await loaded();
    const pending = state().reorder(CORE, moved);
    expect(symbolsOf(CORE)).toEqual(moved);
    await pending;
    expect(await serverSymbols(CORE)).toEqual(moved);
  });

  it('restores the previous order and shows a toast when the server fails', async () => {
    await loaded();
    failNextCall();
    await expect(state().reorder(CORE, moved)).resolves.toBeUndefined();
    expect(symbolsOf(CORE)).toEqual(CORE_SYMBOLS);
    expect(toastTitles()).toEqual(["Couldn't reorder symbols"]);
  });

  it('keeps a later reorder when an earlier one fails', async () => {
    await loaded();
    const gates = holdReorder();
    const later = ['NFLX', ...moved.slice(0, -1)];
    const first = state().reorder(CORE, moved);
    const second = state().reorder(CORE, later);
    failNextCall();
    gates[0]!();
    await first;
    expect(symbolsOf(CORE)).toEqual(later);
    gates[1]!();
    await second;
    expect(symbolsOf(CORE)).toEqual(later);
    expect(await serverSymbols(CORE)).toEqual(later);
  });

  it('settles on the last order after rapid moves', async () => {
    await loaded();
    const gates = holdReorder();
    const later = ['NFLX', ...moved.slice(0, -1)];
    const first = state().reorder(CORE, moved);
    const second = state().reorder(CORE, later);
    gates[0]!();
    await first;
    expect(symbolsOf(CORE)).toEqual(later);
    gates[1]!();
    await second;
    expect(symbolsOf(CORE)).toEqual(later);
  });

  it('refuses an order that is not a permutation, without calling the API', async () => {
    await loaded();
    const reorderSymbols = vi.spyOn(api, 'reorderSymbols');
    await state().reorder(CORE, ['AAPL']);
    expect(reorderSymbols).not.toHaveBeenCalled();
    expect(symbolsOf(CORE)).toEqual(CORE_SYMBOLS);
    expect(toastTitles()).toEqual(["Couldn't reorder symbols"]);
  });

  it('skips the API when the order is unchanged', async () => {
    await loaded();
    const reorderSymbols = vi.spyOn(api, 'reorderSymbols');
    await state().reorder(
      CORE,
      CORE_SYMBOLS.map((s) => s.toLowerCase()),
    );
    expect(reorderSymbols).not.toHaveBeenCalled();
  });
});
