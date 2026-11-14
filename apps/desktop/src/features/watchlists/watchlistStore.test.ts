import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { ApiError, isApiError } from '../../data/api';
import { api, resetDemoData } from '../../data/dataLayer';
import { SEED_WATCHLIST_SYMBOLS } from '../../data/mock/seed';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import { MAX_WATCHLIST_SYMBOLS } from '@aperture/shared/symbols';
import { useWatchlistStore } from './watchlistStore';

const state = () => useWatchlistStore.getState();
const symbols = () => state().watchlist?.symbols;
const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);
const serverSymbols = async () => (await api.getWatchlist()).symbols;
const failNextCall = () => {
  updateSimulation({ failNextApiCall: true });
};

/** Holds each call until its gate opens, then runs the real mock, so the server sees calls in release order. */
function hold(method: 'removeSymbol' | 'reorderSymbols' | 'addSymbol') {
  const real = api[method].bind(api) as (arg: never) => Promise<unknown>;
  const gates: (() => void)[] = [];
  vi.spyOn(api, method).mockImplementation((async (arg: never) => {
    await new Promise<void>((resolve) => gates.push(resolve));
    return real(arg);
  }) as never);
  return gates;
}

const SEED = [...SEED_WATCHLIST_SYMBOLS];

beforeEach(async () => {
  updateSimulation({ apiLatencyMs: 0, failNextApiCall: false });
  await resetDemoData();
  useWatchlistStore.setState({ status: 'idle', error: null, watchlist: null });
  dismissAllToasts();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSimulation();
});

async function loaded() {
  await state().load();
  expect(state().status).toBe('ready');
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe('load', () => {
  it('loads the seeded watchlist', async () => {
    await loaded();
    expect(symbols()).toEqual(SEED);
  });

  it('shares one request between concurrent calls, and never rejects on failure', async () => {
    const getWatchlist = vi.spyOn(api, 'getWatchlist');
    await Promise.all([state().load(), state().load()]);
    expect(getWatchlist).toHaveBeenCalledTimes(1);

    failNextCall();
    await expect(state().load()).resolves.toBeUndefined();
    expect(state().status).toBe('error');
    expect(state().error).toMatch(/unavailable/i);
    // ** The list loaded earlier stays on screen while the refresh failed.
    expect(symbols()).toEqual(SEED);
  });

  it('lets a forced load replace one in flight, ignoring the older result', async () => {
    const real = api.getWatchlist.bind(api);
    let releaseFirst: () => void = () => undefined;
    vi.spyOn(api, 'getWatchlist')
      .mockImplementationOnce(async () => {
        const stale = await real();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return { ...stale, symbols: ['STALE'] };
      })
      .mockImplementation(real);
    const first = state().load();
    await Promise.resolve();
    await state().load({ force: true });
    releaseFirst();
    await first;
    expect(symbols()).toEqual(SEED);
  });
});

describe('addSymbol', () => {
  it('adds a normalized symbol and keeps the server copy', async () => {
    await loaded();
    await state().addSymbol(' jpm ');
    expect(symbols()).toEqual([...SEED, 'JPM']);
    expect(await serverSymbols()).toEqual([...SEED, 'JPM']);
  });

  it('rejects a duplicate, a bad symbol and a full list without a request', async () => {
    await loaded();
    const addSymbol = vi.spyOn(api, 'addSymbol');
    const duplicate = await caught(state().addSymbol('aapl'));
    expect(isApiError(duplicate) && duplicate.code).toBe('CONFLICT');
    const bad = await caught(state().addSymbol('TOOLONG'));
    expect(isApiError(bad) && bad.code).toBe('VALIDATION_ERROR');

    const full = Array.from({ length: MAX_WATCHLIST_SYMBOLS }, (_, i) => `Z${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    useWatchlistStore.setState({ watchlist: { symbols: full, updatedAt: '' } });
    const overflow = await caught(state().addSymbol('JPM'));
    expect(isApiError(overflow) && overflow.message).toMatch(/full/);
    expect(addSymbol).not.toHaveBeenCalled();
  });

  it('passes server errors through and leaves the list as it was', async () => {
    await loaded();
    failNextCall();
    const error = await caught(state().addSymbol('JPM'));
    expect(error).toBeInstanceOf(ApiError);
    expect(symbols()).toEqual(SEED);
  });

  it('joins a repeated add of the same symbol', async () => {
    await loaded();
    const addSymbol = vi.spyOn(api, 'addSymbol');
    await Promise.all([state().addSymbol('JPM'), state().addSymbol('jpm')]);
    expect(addSymbol).toHaveBeenCalledTimes(1);
    expect(symbols()).toEqual([...SEED, 'JPM']);
  });
});

describe('removeSymbol', () => {
  it('removes at once and keeps the removal when the server agrees', async () => {
    await loaded();
    const gates = hold('removeSymbol');
    const removal = state().removeSymbol('msft');
    expect(symbols()).not.toContain('MSFT');
    gates[0]?.();
    await removal;
    expect(await serverSymbols()).not.toContain('MSFT');
  });

  it('puts the symbol back where it was and says so when the server fails', async () => {
    await loaded();
    failNextCall();
    await state().removeSymbol('NVDA');
    expect(symbols()).toEqual(SEED);
    expect(toastTitles()).toContain("Couldn't remove NVDA");
  });

  it('treats a symbol the server already dropped as removed', async () => {
    await loaded();
    vi.spyOn(api, 'removeSymbol').mockRejectedValueOnce(new ApiError('NOT_FOUND', 'Not in the watchlist.', 404));
    await state().removeSymbol('AMD');
    expect(symbols()).not.toContain('AMD');
    expect(toastTitles()).toEqual([]);
  });

  it("doesn't let one response undo another removal still in flight", async () => {
    await loaded();
    const gates = hold('removeSymbol');
    const first = state().removeSymbol('AAPL');
    const second = state().removeSymbol('MSFT');
    gates[0]?.();
    await first;
    expect(symbols()).not.toContain('MSFT');
    gates[1]?.();
    await second;
    expect(symbols()).toEqual(SEED.filter((s) => s !== 'AAPL' && s !== 'MSFT'));
  });
});

describe('reorder', () => {
  it('applies a new order at once and saves it', async () => {
    await loaded();
    const next = [...SEED].reverse();
    await state().reorder(next);
    expect(symbols()).toEqual(next);
    expect(await serverSymbols()).toEqual(next);
  });

  it('restores the order and says so when the server fails', async () => {
    await loaded();
    failNextCall();
    await state().reorder([...SEED].reverse());
    expect(symbols()).toEqual(SEED);
    expect(toastTitles()).toContain("Couldn't reorder symbols");
  });

  it('refuses an order that is not the same symbols, without a request', async () => {
    await loaded();
    const reorderSymbols = vi.spyOn(api, 'reorderSymbols');
    await state().reorder(['AAPL']);
    expect(reorderSymbols).not.toHaveBeenCalled();
    expect(symbols()).toEqual(SEED);
    expect(toastTitles()).toContain("Couldn't reorder symbols");
  });
});
