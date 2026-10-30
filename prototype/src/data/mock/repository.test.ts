import { describe, expect, it, vi } from 'vitest';
import type { PriceAlert, Watchlist } from '../../domain/types';
import { createMockMarket } from './market';
import { createRepository, parsePersisted, STORAGE_KEY, type StorageLike } from './repository';
import { buildSeedData, NEAR_ALERT_LOOKAHEAD, NEAR_ALERT_MAX_DISTANCE, SEED_WATCHLISTS } from './seed';

const NOW = Date.UTC(2026, 9, 21, 15, 0);
const ISO = new Date(NOW).toISOString();

function stored(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function watchlist(overrides: Partial<Watchlist> = {}): Watchlist {
  return { id: 'w1', name: 'Mine', symbols: ['AAPL'], createdAt: ISO, updatedAt: ISO, ...overrides };
}

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 'a1',
    symbol: 'AAPL',
    condition: 'above',
    targetPrice: 300,
    tag: 'sell',
    field: 'last',
    enabled: true,
    armed: false,
    note: null,
    createdAt: ISO,
    updatedAt: ISO,
    lastTriggeredAt: ISO,
    lastTriggeredPrice: 301,
    triggerCount: 2,
    ...overrides,
  };
}

function persist(payload: unknown): void {
  localStorage.setItem(STORAGE_KEY, typeof payload === 'string' ? payload : JSON.stringify(payload));
}

describe('seed data', () => {
  const seed = buildSeedData({ now: NOW });

  it('has the four demo watchlists in order, with Ideas empty', () => {
    expect(seed.watchlists.map((w) => w.name)).toEqual(['Core Tech', 'Index ETFs', 'Financials', 'Ideas']);
    expect(seed.watchlists[0]?.symbols).toEqual([
      'AAPL',
      'MSFT',
      'NVDA',
      'GOOGL',
      'AMZN',
      'META',
      'TSLA',
      'AMD',
      'AVGO',
      'NFLX',
    ]);
    expect(seed.watchlists[1]?.symbols).toEqual(['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'XLK', 'XLF']);
    expect(seed.watchlists[2]?.symbols).toEqual(['JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'BRK.B']);
    expect(seed.watchlists[3]?.symbols).toEqual([]);
    for (const w of seed.watchlists) {
      expect(w.createdAt).toBe(ISO);
      expect(w.updatedAt).toBe(ISO);
    }
  });

  it('has two near enabled alerts (above/buy and below/sell), one far armed alert, and one disabled alert', () => {
    const market = createMockMarket();
    const [near1, near2, far, disabled] = seed.alerts;
    expect(seed.alerts).toHaveLength(4);
    expect(near1).toMatchObject({
      condition: 'above',
      tag: 'buy',
      enabled: true,
      armed: true,
      triggerCount: 0,
    });
    expect(near2).toMatchObject({ condition: 'below', tag: 'sell', enabled: true, armed: true });
    expect(far).toMatchObject({ enabled: true, armed: true });
    expect(disabled).toMatchObject({ enabled: false });

    const price = (symbol: string): number => market.getState(symbol)!.last;
    const distance = (a: PriceAlert): number => Math.abs(a.targetPrice / price(a.symbol) - 1);
    expect(distance(near1!)).toBeLessThanOrEqual(NEAR_ALERT_MAX_DISTANCE + 0.0001);
    expect(distance(near2!)).toBeLessThanOrEqual(NEAR_ALERT_MAX_DISTANCE + 0.0001);
    // Not already satisfied at the seeded price, so they fire on a later trade, not instantly.
    expect(near1!.targetPrice).toBeGreaterThan(price(near1!.symbol));
    expect(near2!.targetPrice).toBeLessThan(price(near2!.symbol));
    expect(distance(far!)).toBeGreaterThan(0.1);
    expect(seed.alerts.every((a) => a.lastTriggeredAt === null && a.lastTriggeredPrice === null)).toBe(true);
    expect(new Set(seed.alerts.map((a) => a.id)).size).toBe(4);
  });

  it('places the near alerts on the deterministic path so they trigger within the look-ahead', () => {
    const market = createMockMarket();
    const [above, below] = seed.alerts;
    const abovePath = market.peekPrices(above!.symbol, NEAR_ALERT_LOOKAHEAD);
    const belowPath = market.peekPrices(below!.symbol, NEAR_ALERT_LOOKAHEAD);
    expect(abovePath.some((p) => p >= above!.targetPrice)).toBe(true);
    expect(belowPath.some((p) => p <= below!.targetPrice)).toBe(true);
    // The far alert is not reached anywhere near that soon.
    const far = seed.alerts[2]!;
    expect(market.peekPrices(far.symbol, 5000).some((p) => p >= far.targetPrice)).toBe(false);
  });

  it('places near alerts relative to the current price of a market that has already traded', () => {
    const market = createMockMarket();
    for (let i = 0; i < 300; i++) market.trade('NVDA', NOW + i);
    const fresh = buildSeedData({ market, now: NOW });
    const target = fresh.alerts[0]!.targetPrice;
    const last = market.getState('NVDA')!.last;
    expect(target).toBeGreaterThan(last);
    expect(target / last - 1).toBeLessThanOrEqual(NEAR_ALERT_MAX_DISTANCE + 0.0001);
    expect(market.peekPrices('NVDA', NEAR_ALERT_LOOKAHEAD).some((p) => p >= target)).toBe(true);
  });

  it('matches the exported watchlist definition', () => {
    expect(seed.watchlists.map((w) => w.id)).toEqual(SEED_WATCHLISTS.map((w) => w.id));
  });
});

describe('createRepository', () => {
  it('writes the seed on first run with version 1', () => {
    const repo = createRepository({ now: () => NOW });
    expect(repo.listWatchlists()).toHaveLength(4);
    expect(repo.listAlerts()).toHaveLength(4);
    const persisted = stored() as { version: number; watchlists: unknown[]; alerts: unknown[] };
    expect(persisted.version).toBe(1);
    expect(persisted.watchlists).toHaveLength(4);
    expect(persisted.alerts).toHaveLength(4);
  });

  it('round-trips mutations through localStorage to a new instance', () => {
    const repo = createRepository({ now: () => NOW });
    repo.saveWatchlist(watchlist({ id: 'new', name: 'Fresh', symbols: ['F'] }));
    repo.saveAlert(alert({ id: 'mine' }));
    expect(repo.deleteWatchlist('wl-ideas')).toBe(true);
    expect(repo.deleteAlert('alert-seed-msft')).toBe(true);

    const reloaded = createRepository({ now: () => NOW });
    expect(reloaded.listWatchlists().map((w) => w.id)).toEqual([
      'wl-core-tech',
      'wl-index-etfs',
      'wl-financials',
      'new',
    ]);
    expect(reloaded.getAlert('mine')).toEqual(alert({ id: 'mine' }));
    expect(reloaded.getAlert('alert-seed-msft')).toBeUndefined();
  });

  it('replaces in place by id and keeps order', () => {
    const repo = createRepository({ now: () => NOW });
    const core = repo.getWatchlist('wl-core-tech')!;
    repo.saveWatchlist({ ...core, name: 'Renamed' });
    expect(repo.listWatchlists().map((w) => w.name)).toEqual([
      'Renamed',
      'Index ETFs',
      'Financials',
      'Ideas',
    ]);
  });

  it('returns false when deleting something that does not exist, without notifying', () => {
    const repo = createRepository({ now: () => NOW });
    const listener = vi.fn();
    repo.subscribe(listener);
    expect(repo.deleteWatchlist('nope')).toBe(false);
    expect(repo.deleteAlert('nope')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns copies so callers cannot mutate stored state', () => {
    const repo = createRepository({ now: () => NOW });
    const list = repo.listWatchlists();
    list[0]!.symbols.push('ZZZ');
    list[0]!.name = 'Hacked';
    repo.getAlert('alert-seed-nvda')!.armed = false;
    const input = watchlist({ id: 'x', name: 'X' });
    repo.saveWatchlist(input);
    input.symbols.push('MSFT');

    expect(repo.getWatchlist('wl-core-tech')?.symbols).not.toContain('ZZZ');
    expect(repo.getWatchlist('wl-core-tech')?.name).toBe('Core Tech');
    expect(repo.getAlert('alert-seed-nvda')?.armed).toBe(true);
    expect(repo.getWatchlist('x')?.symbols).toEqual(['AAPL']);
  });

  it('notifies listeners after each change and stops after unsubscribe', () => {
    const repo = createRepository({ now: () => NOW });
    const listener = vi.fn(() => {
      // Listeners see the new state.
      expect(repo.getAlert('a1')).toBeDefined();
    });
    const off = repo.subscribe(listener);
    repo.saveAlert(alert());
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    repo.deleteAlert('a1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reset restores the seed, persists it and notifies', () => {
    const repo = createRepository({ now: () => NOW });
    repo.deleteWatchlist('wl-core-tech');
    repo.saveAlert(alert({ id: 'extra' }));
    const listener = vi.fn();
    repo.subscribe(listener);
    repo.reset();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(repo.listWatchlists()).toHaveLength(4);
    expect(repo.getAlert('extra')).toBeUndefined();
    expect(createRepository({ now: () => NOW }).listWatchlists()).toHaveLength(4);
  });

  it('uses an injected seed and storage key', () => {
    const seed = { watchlists: [watchlist()], alerts: [] };
    const repo = createRepository({ key: 'custom', seed: () => seed, now: () => NOW });
    expect(repo.listWatchlists()).toEqual([watchlist()]);
    expect(localStorage.getItem('custom')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  describe('corrupted or unusable storage', () => {
    it.each([
      ['invalid JSON', '{not json'],
      ['JSON null', 'null'],
      ['a number', '42'],
      ['an array', '[]'],
      ['an unknown version', JSON.stringify({ version: 2, watchlists: [], alerts: [] })],
      ['a missing version', JSON.stringify({ watchlists: [], alerts: [] })],
      ['non-array watchlists', JSON.stringify({ version: 1, watchlists: {}, alerts: [] })],
      ['missing alerts', JSON.stringify({ version: 1, watchlists: [] })],
    ])('falls back to the seed for %s and rewrites storage', (_label, raw) => {
      persist(raw);
      const repo = createRepository({ now: () => NOW });
      expect(repo.listWatchlists().map((w) => w.name)).toContain('Core Tech');
      expect(repo.listAlerts()).toHaveLength(4);
      expect(stored()).toMatchObject({ version: 1 });
    });

    it('keeps valid entries and drops invalid, duplicate-id and duplicate-name ones', () => {
      persist({
        version: 1,
        watchlists: [
          watchlist({
            id: 'ok',
            name: 'Keep',
            symbols: ['aapl', ' msft ', 'AAPL', 'bad symbol!', 7] as string[],
          }),
          watchlist({ id: 'ok', name: 'Same id' }),
          watchlist({ id: 'other', name: 'keep' }),
          { id: 'no-name', symbols: [] },
          watchlist({ id: 'blank', name: '   ' }),
          'garbage',
          null,
        ],
        alerts: [
          alert({ id: 'good' }),
          alert({ id: 'good', targetPrice: 1 }),
          alert({ id: 'neg', targetPrice: -1 }),
          alert({ id: 'cond', condition: 'sideways' as never }),
          alert({ id: 'tag', tag: 'hold' as never }),
          alert({ id: 'sym', symbol: '123' }),
          { ...alert({ id: 'en' }), enabled: 'yes' },
          { ...alert({ id: 'inf' }), targetPrice: 'Infinity' },
        ],
      });
      const repo = createRepository({ now: () => NOW });
      expect(repo.listWatchlists()).toEqual([
        watchlist({ id: 'ok', name: 'Keep', symbols: ['AAPL', 'MSFT'] }),
      ]);
      expect(repo.listAlerts()).toEqual([alert({ id: 'good' })]);
    });

    it('repairs optional alert fields with safe defaults', () => {
      const { armed: _armed, ...withoutArmed } = alert({ id: 'x' });
      persist({
        version: 1,
        watchlists: [],
        alerts: [
          {
            ...withoutArmed,
            symbol: 'tsla',
            note: 5,
            createdAt: 'yesterday',
            lastTriggeredAt: 'never',
            lastTriggeredPrice: Number.NaN,
            triggerCount: -3,
            field: 'bid',
          },
        ],
      });
      const repo = createRepository({ now: () => NOW });
      expect(repo.getAlert('x')).toEqual(
        alert({
          id: 'x',
          symbol: 'TSLA',
          armed: true,
          note: null,
          createdAt: ISO,
          lastTriggeredAt: null,
          lastTriggeredPrice: null,
          triggerCount: 0,
        }),
      );
    });

    it('does not throw when reading storage throws, and serves the seed from memory', () => {
      const storage: StorageLike = {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      const repo = createRepository({ storage, now: () => NOW });
      expect(repo.listWatchlists()).toHaveLength(4);
    });

    it('keeps working from memory when writes throw (quota exceeded)', () => {
      const storage: StorageLike = {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      };
      const repo = createRepository({ storage, now: () => NOW });
      expect(() => {
        repo.saveWatchlist(watchlist({ id: 'mem', name: 'Memory' }));
      }).not.toThrow();
      expect(repo.getWatchlist('mem')?.name).toBe('Memory');
      expect(() => {
        repo.reset();
      }).not.toThrow();
      expect(repo.getWatchlist('mem')).toBeUndefined();
    });

    it('works with no storage at all', () => {
      const repo = createRepository({ storage: null, now: () => NOW });
      repo.saveAlert(alert());
      expect(repo.getAlert('a1')).toBeDefined();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});

describe('parsePersisted', () => {
  it('returns null for missing data and keeps an empty but valid payload', () => {
    expect(parsePersisted(null, ISO)).toBeNull();
    expect(parsePersisted(JSON.stringify({ version: 1, watchlists: [], alerts: [] }), ISO)).toEqual({
      watchlists: [],
      alerts: [],
    });
  });
});
