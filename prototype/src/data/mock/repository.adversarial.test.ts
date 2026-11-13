/** Adversarial checks of the persisted repository: corrupted payloads and storage failures. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRepository, STORAGE_KEY, type StorageLike } from './repository';
import { SEED_WATCHLIST_SYMBOLS } from './seed';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('corrupted storage falls back to the seed without throwing', () => {
  it.each([
    ['not json', '{oops'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"hello"'],
    ['a number', '42'],
    ['an unknown version', JSON.stringify({ version: 3, watchlist: { symbols: [] }, alerts: [] })],
    ['a string version', JSON.stringify({ version: '2', watchlist: { symbols: [] }, alerts: [] })],
    ['a string legacy version', JSON.stringify({ version: '1', watchlists: [], alerts: [] })],
    ['missing fields', JSON.stringify({ version: 2 })],
    ['the watchlist as an array', JSON.stringify({ version: 2, watchlist: ['AAPL'], alerts: [] })],
    ['legacy watchlists as an object', JSON.stringify({ version: 1, watchlists: {}, alerts: [] })],
    ['alerts as null', JSON.stringify({ version: 2, watchlist: { symbols: [] }, alerts: null })],
    ['an empty string', ''],
  ])('%s', (_label, raw) => {
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const repo = createRepository({ storage });
    expect(repo.getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
    expect(repo.listAlerts()).toHaveLength(4);
    // The repaired payload is valid version-2 JSON again.
    const stored = JSON.parse(storage.data.get(STORAGE_KEY)!) as { version: number };
    expect(stored.version).toBe(2);
  });

  it('survives prototype-polluting keys without polluting Object.prototype', () => {
    const raw =
      '{"version":2,"__proto__":{"polluted":true},"watchlist":{"symbols":["AAPL"],"__proto__":{"x":1}},"alerts":[]}';
    const repo = createRepository({ storage: memoryStorage({ [STORAGE_KEY]: raw }) });
    expect(repo.getWatchlist().symbols).toEqual(['AAPL']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('does not throw when every storage method throws, and still serves and mutates in memory', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const repo = createRepository({ storage });
    expect(repo.getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
    expect(() => {
      repo.saveWatchlist({ ...repo.getWatchlist(), symbols: ['SPY'] });
    }).not.toThrow();
    expect(repo.getWatchlist().symbols).toEqual(['SPY']);
    expect(() => {
      repo.reset();
    }).not.toThrow();
    expect(repo.getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
  });

  it('does not throw when merely touching window.localStorage throws (blocked site data)', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => createRepository()).not.toThrow();
  });
});

describe('persistence round trip', () => {
  it('stores { version: 2, watchlist, alerts } under aperture.prototype.v1 and a restart reads it back', () => {
    const storage = memoryStorage();
    const repo = createRepository({ storage });
    const alert = repo.listAlerts()[0]!;
    repo.saveAlert({ ...alert, armed: false, triggerCount: 3, lastTriggeredPrice: 12.34 });
    const raw = JSON.parse(storage.data.get('aperture.prototype.v1')!) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['alerts', 'version', 'watchlist']);
    const restarted = createRepository({ storage });
    expect(restarted.getAlert(alert.id)).toMatchObject({
      armed: false,
      triggerCount: 3,
      lastTriggeredPrice: 12.34,
    });
  });
});
