/** Adversarial checks of the persisted repository: corrupted payloads and storage failures. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSeedData } from './seed';
import { createRepository, STORAGE_KEY, type StorageLike } from './repository';

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

const seedNames = buildSeedData().watchlists.map((w) => w.name);

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
    ['an unknown version', JSON.stringify({ version: 2, watchlists: [], alerts: [] })],
    ['a string version', JSON.stringify({ version: '1', watchlists: [], alerts: [] })],
    ['missing arrays', JSON.stringify({ version: 1 })],
    ['watchlists as an object', JSON.stringify({ version: 1, watchlists: {}, alerts: [] })],
    ['alerts as null', JSON.stringify({ version: 1, watchlists: [], alerts: null })],
    ['an empty string', ''],
  ])('%s', (_label, raw) => {
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const repo = createRepository({ storage });
    expect(repo.listWatchlists().map((w) => w.name)).toEqual(seedNames);
    expect(repo.listAlerts()).toHaveLength(4);
    // The repaired payload is valid version-1 JSON again.
    const stored = JSON.parse(storage.data.get(STORAGE_KEY)!) as { version: number };
    expect(stored.version).toBe(1);
  });

  it('survives prototype-polluting keys without polluting Object.prototype', () => {
    const raw =
      '{"version":1,"__proto__":{"polluted":true},"watchlists":[{"id":"w","name":"A","symbols":["AAPL"],"__proto__":{"x":1}}],"alerts":[]}';
    const repo = createRepository({ storage: memoryStorage({ [STORAGE_KEY]: raw }) });
    expect(repo.listWatchlists().map((w) => w.name)).toEqual(['A']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
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
    expect(repo.listWatchlists().map((w) => w.name)).toEqual(seedNames);
    const first = repo.listWatchlists()[0]!;
    expect(() => {
      repo.saveWatchlist({ ...first, name: 'Renamed' });
    }).not.toThrow();
    expect(repo.getWatchlist(first.id)?.name).toBe('Renamed');
    expect(() => {
      repo.reset();
    }).not.toThrow();
    expect(repo.listWatchlists().map((w) => w.name)).toEqual(seedNames);
  });

  it('does not throw when merely touching window.localStorage throws (blocked site data)', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => createRepository()).not.toThrow();
  });
});

describe('persistence round trip', () => {
  it('stores { version: 1, watchlists, alerts } under aperture.prototype.v1 and a restart reads it back', () => {
    const storage = memoryStorage();
    const repo = createRepository({ storage });
    const alert = repo.listAlerts()[0]!;
    repo.saveAlert({ ...alert, armed: false, triggerCount: 3, lastTriggeredPrice: 12.34 });
    const raw = JSON.parse(storage.data.get('aperture.prototype.v1')!) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['alerts', 'version', 'watchlists']);
    const restarted = createRepository({ storage });
    expect(restarted.getAlert(alert.id)).toMatchObject({
      armed: false,
      triggerCount: 3,
      lastTriggeredPrice: 12.34,
    });
  });
});
