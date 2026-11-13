import { describe, expect, it, vi } from 'vitest';
import { MAX_WATCHLIST_SYMBOLS } from '../../domain/symbols';
import type { PriceAlert, Watchlist } from '../../domain/types';
import { createMockMarket } from './market';
import { createRepository, parsePersisted, STORAGE_KEY, type StorageLike } from './repository';
import { roundPrice } from './priceModel';
import {
  buildSeedData,
  DEMO_FIRST_TRIGGER_TRADES,
  DEMO_HORIZON_TRADES,
  demoFireTrades,
  SEED_WATCHLIST_SYMBOLS,
} from './seed';

const NOW = Date.UTC(2026, 9, 21, 15, 0);
const ISO = new Date(NOW).toISOString();

function stored(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function watchlist(overrides: Partial<Watchlist> = {}): Watchlist {
  return { symbols: ['AAPL'], updatedAt: ISO, ...overrides };
}

/** `count` distinct valid symbols, in a fixed order. */
function tickers(count: number): string[] {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: count }, (_, i) => `Q${letters[Math.floor(i / 26)]}${letters[i % 26]}`);
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

  it('has one watchlist with the ten demo tech symbols in order', () => {
    expect(seed.watchlist).toEqual({
      symbols: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX'],
      updatedAt: ISO,
    });
  });

  it('has two demo alerts (MSFT above/buy, TSLA below/sell), one far armed alert, and one disabled alert', () => {
    const market = createMockMarket();
    const [buy, sell, far, disabled] = seed.alerts;
    expect(seed.alerts).toHaveLength(4);
    expect(buy).toMatchObject({
      id: 'alert-seed-msft',
      symbol: 'MSFT',
      condition: 'above',
      tag: 'buy',
      enabled: true,
      armed: true,
      triggerCount: 0,
    });
    expect(sell).toMatchObject({
      id: 'alert-seed-tsla',
      symbol: 'TSLA',
      condition: 'below',
      tag: 'sell',
      enabled: true,
    });
    expect(far).toMatchObject({ symbol: 'AAPL', enabled: true, armed: true });
    expect(disabled).toMatchObject({ symbol: 'NVDA', enabled: false });

    const price = (symbol: string): number => market.getState(symbol)!.last;
    const distance = (a: PriceAlert): number => Math.abs(a.targetPrice / price(a.symbol) - 1);
    // Not already satisfied at the seeded price, so they fire on a later trade, and still close by.
    expect(buy!.targetPrice).toBeGreaterThan(price('MSFT'));
    expect(sell!.targetPrice).toBeLessThan(price('TSLA'));
    expect(distance(buy!)).toBeLessThan(0.03);
    expect(distance(sell!)).toBeLessThan(0.03);
    expect(distance(far!)).toBeGreaterThan(0.1);
    expect(seed.alerts.every((a) => a.lastTriggeredAt === null && a.lastTriggeredPrice === null)).toBe(true);
    expect(new Set(seed.alerts.map((a) => a.id)).size).toBe(4);
  });

  it('places the demo alerts on the deterministic path: first trigger in the window, then re-fires minutes apart', () => {
    const market = createMockMarket();
    // At default settings each watchlist symbol trades about 1.2 times a second.
    const twoMinutes = 144;
    for (const alert of seed.alerts.slice(0, 2)) {
      const path = market.peekPrices(alert.symbol, DEMO_HORIZON_TRADES);
      const fires = demoFireTrades(path, alert.condition, alert.targetPrice);
      expect(fires[0]).toBeGreaterThanOrEqual(DEMO_FIRST_TRIGGER_TRADES.min);
      expect(fires[0]).toBeLessThanOrEqual(DEMO_FIRST_TRIGGER_TRADES.max);
      for (let i = 1; i < fires.length; i++)
        expect(fires[i]! - fires[i - 1]!).toBeGreaterThanOrEqual(twoMinutes);
    }
    // The far alert is not reached anywhere near that soon.
    const far = seed.alerts[2]!;
    expect(market.peekPrices(far.symbol, 5000).some((p) => p >= far.targetPrice)).toBe(false);
  });

  it('places the demo alerts relative to the current price of a market that has already traded', () => {
    const market = createMockMarket();
    for (let i = 0; i < 300; i++) {
      market.trade('MSFT', NOW + i);
      market.trade('TSLA', NOW + i);
    }
    const [buy, sell] = buildSeedData({ market, now: NOW }).alerts;
    expect(buy!.targetPrice).toBeGreaterThan(market.getState('MSFT')!.last);
    expect(sell!.targetPrice).toBeLessThan(market.getState('TSLA')!.last);
    for (const alert of [buy!, sell!]) {
      const fires = demoFireTrades(
        market.peekPrices(alert.symbol, DEMO_HORIZON_TRADES),
        alert.condition,
        alert.targetPrice,
      );
      expect(fires[0]).toBeGreaterThanOrEqual(DEMO_FIRST_TRIGGER_TRADES.min);
      expect(fires[0]).toBeLessThanOrEqual(DEMO_FIRST_TRIGGER_TRADES.max);
    }
  });

  it('falls back to a target just beyond the price when the path never moves that way', () => {
    const market = createMockMarket();
    // Every TSLA trade ahead prints above the current price, so no "below" target is ever reached.
    const peek = market.peekPrices.bind(market);
    market.peekPrices = (symbol, count) =>
      symbol === 'TSLA' ? Array<number>(count).fill(400) : peek(symbol, count);
    const sell = buildSeedData({ market, now: NOW }).alerts[1]!;
    expect(sell.targetPrice).toBe(roundPrice(market.getState('TSLA')!.last * 0.999));
  });

  it('matches the exported symbols without sharing the array', () => {
    const fresh = buildSeedData({ now: NOW });
    expect(fresh.watchlist.symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
    fresh.watchlist.symbols.push('ZZZ');
    expect(SEED_WATCHLIST_SYMBOLS).not.toContain('ZZZ');
    expect(buildSeedData({ now: NOW }).watchlist.symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
  });
});

describe('createRepository', () => {
  it('writes the seed on first run with version 2', () => {
    const repo = createRepository({ now: () => NOW });
    expect(repo.getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
    expect(repo.listAlerts()).toHaveLength(4);
    const persisted = stored() as Record<string, unknown>;
    expect(Object.keys(persisted).sort()).toEqual(['alerts', 'version', 'watchlist']);
    expect(persisted).toMatchObject({
      version: 2,
      watchlist: { symbols: SEED_WATCHLIST_SYMBOLS, updatedAt: ISO },
    });
    expect(persisted.alerts).toHaveLength(4);
  });

  it('round-trips mutations through localStorage to a new instance', () => {
    const repo = createRepository({ now: () => NOW });
    repo.saveWatchlist(watchlist({ symbols: ['F', 'AAPL'] }));
    repo.saveAlert(alert({ id: 'mine' }));
    expect(repo.deleteAlert('alert-seed-msft')).toBe(true);

    const reloaded = createRepository({ now: () => NOW });
    expect(reloaded.getWatchlist()).toEqual(watchlist({ symbols: ['F', 'AAPL'] }));
    expect(reloaded.getAlert('mine')).toEqual(alert({ id: 'mine' }));
    expect(reloaded.getAlert('alert-seed-msft')).toBeUndefined();
  });

  it('keeps an empty watchlist instead of reseeding it', () => {
    const repo = createRepository({ now: () => NOW });
    repo.saveWatchlist(watchlist({ symbols: [] }));
    expect(createRepository({ now: () => NOW }).getWatchlist().symbols).toEqual([]);
  });

  it('returns false when deleting an alert that does not exist, without notifying', () => {
    const repo = createRepository({ now: () => NOW });
    const listener = vi.fn();
    repo.subscribe(listener);
    expect(repo.deleteAlert('nope')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns copies so callers cannot mutate stored state', () => {
    const repo = createRepository({ now: () => NOW });
    repo.getWatchlist().symbols.push('ZZZ');
    repo.getAlert('alert-seed-nvda')!.armed = false;
    expect(repo.getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
    expect(repo.getAlert('alert-seed-nvda')?.armed).toBe(true);

    const input = watchlist();
    repo.saveWatchlist(input);
    input.symbols.push('MSFT');
    expect(repo.getWatchlist().symbols).toEqual(['AAPL']);
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

  it('notifies listeners after a watchlist save, with the new watchlist readable', () => {
    const repo = createRepository({ now: () => NOW });
    const seen: string[][] = [];
    repo.subscribe(() => seen.push(repo.getWatchlist().symbols));
    repo.saveWatchlist(watchlist({ symbols: ['SPY'] }));
    expect(seen).toEqual([['SPY']]);
  });

  it('reset restores the seed, persists it and notifies', () => {
    const repo = createRepository({ now: () => NOW });
    repo.saveWatchlist(watchlist({ symbols: [] }));
    repo.saveAlert(alert({ id: 'extra' }));
    const listener = vi.fn();
    repo.subscribe(listener);
    repo.reset();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(repo.getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
    expect(repo.getAlert('extra')).toBeUndefined();
    expect(createRepository({ now: () => NOW }).getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
  });

  it('uses an injected seed and storage key', () => {
    const seed = { watchlist: watchlist(), alerts: [] };
    const repo = createRepository({ key: 'custom', seed: () => seed, now: () => NOW });
    expect(repo.getWatchlist()).toEqual(watchlist());
    expect(localStorage.getItem('custom')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  describe('corrupted or unusable storage', () => {
    it.each([
      ['invalid JSON', '{not json'],
      ['JSON null', 'null'],
      ['a number', '42'],
      ['an array', '[]'],
      ['an unknown version', JSON.stringify({ version: 3, watchlist: { symbols: [] }, alerts: [] })],
      ['a missing version', JSON.stringify({ watchlist: { symbols: [] }, alerts: [] })],
      ['a version 2 payload without a watchlist', JSON.stringify({ version: 2, alerts: [] })],
      [
        'a watchlist without a symbols list',
        JSON.stringify({ version: 2, watchlist: { symbols: 'AAPL' }, alerts: [] }),
      ],
      [
        'a version 2 payload with a watchlists array',
        JSON.stringify({ version: 2, watchlists: [], alerts: [] }),
      ],
      ['non-array version 1 watchlists', JSON.stringify({ version: 1, watchlists: {}, alerts: [] })],
      ['missing alerts', JSON.stringify({ version: 2, watchlist: { symbols: [] } })],
    ])('falls back to the seed for %s and rewrites storage', (_label, raw) => {
      persist(raw);
      const repo = createRepository({ now: () => NOW });
      expect(repo.getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
      expect(repo.listAlerts()).toHaveLength(4);
      expect(stored()).toMatchObject({ version: 2 });
    });

    it('keeps valid entries and drops invalid and duplicate ones', () => {
      persist({
        version: 2,
        watchlist: watchlist({ symbols: ['aapl', ' msft ', 'AAPL', 'bad symbol!', 7] as string[] }),
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
      expect(repo.getWatchlist()).toEqual(watchlist({ symbols: ['AAPL', 'MSFT'] }));
      expect(repo.listAlerts()).toEqual([alert({ id: 'good' })]);
    });

    it('caps the watchlist at the symbol limit and repairs a bad updatedAt', () => {
      const many = tickers(MAX_WATCHLIST_SYMBOLS + 5);
      persist({ version: 2, watchlist: { symbols: many, updatedAt: 'yesterday' }, alerts: [] });
      expect(createRepository({ now: () => NOW }).getWatchlist()).toEqual({
        symbols: many.slice(0, MAX_WATCHLIST_SYMBOLS),
        updatedAt: ISO,
      });
    });

    it('repairs optional alert fields with safe defaults', () => {
      const { armed: _armed, ...withoutArmed } = alert({ id: 'x' });
      persist({
        version: 2,
        watchlist: watchlist({ symbols: [] }),
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
      expect(repo.getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
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
        repo.saveWatchlist(watchlist({ symbols: ['MEM'] }));
      }).not.toThrow();
      expect(repo.getWatchlist().symbols).toEqual(['MEM']);
      expect(() => {
        repo.reset();
      }).not.toThrow();
      expect(repo.getWatchlist().symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
    });

    it('works with no storage at all', () => {
      const repo = createRepository({ storage: null, now: () => NOW });
      repo.saveAlert(alert());
      expect(repo.getAlert('a1')).toBeDefined();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('version 1 data with several watchlists', () => {
    const legacyList = (name: string, symbols: unknown[]) => ({
      id: `wl-${name}`,
      name,
      symbols,
      createdAt: ISO,
      updatedAt: ISO,
    });

    it('merges every list into one watchlist in order, dropping duplicates, and keeps the alerts', () => {
      persist({
        version: 1,
        watchlists: [
          legacyList('Core', ['AAPL', 'MSFT']),
          legacyList('Ideas', []),
          legacyList('ETFs', ['spy', 'AAPL', 'QQQ']),
          legacyList('More', ['MSFT', 'bad symbol!', 7, 'BRK.B']),
        ],
        alerts: [alert({ id: 'kept' })],
      });
      const repo = createRepository({ now: () => NOW + 60_000 });
      expect(repo.getWatchlist()).toEqual({
        symbols: ['AAPL', 'MSFT', 'SPY', 'QQQ', 'BRK.B'],
        updatedAt: new Date(NOW + 60_000).toISOString(),
      });
      expect(repo.listAlerts()).toEqual([alert({ id: 'kept' })]);
    });

    it('rewrites storage as version 2 so the merge happens only once', () => {
      persist({
        version: 1,
        watchlists: [legacyList('Core', ['AAPL']), legacyList('ETFs', ['SPY'])],
        alerts: [],
      });
      createRepository({ now: () => NOW });
      const persisted = stored() as Record<string, unknown>;
      expect(Object.keys(persisted).sort()).toEqual(['alerts', 'version', 'watchlist']);
      expect(persisted).toMatchObject({ version: 2, watchlist: { symbols: ['AAPL', 'SPY'] } });
    });

    it('caps the merged watchlist at the symbol limit, keeping the earliest symbols', () => {
      const all = tickers(MAX_WATCHLIST_SYMBOLS + 20);
      persist({
        version: 1,
        watchlists: [legacyList('First', all.slice(0, 60)), legacyList('Second', all.slice(60))],
        alerts: [],
      });
      expect(createRepository({ now: () => NOW }).getWatchlist().symbols).toEqual(
        all.slice(0, MAX_WATCHLIST_SYMBOLS),
      );
    });

    it('skips entries that are not lists and gives an empty watchlist when no list has symbols', () => {
      persist({
        version: 1,
        watchlists: ['garbage', null, { name: 'No symbols' }, legacyList('Ideas', [])],
        alerts: [],
      });
      expect(createRepository({ now: () => NOW }).getWatchlist()).toEqual({ symbols: [], updatedAt: ISO });
    });
  });
});

describe('parsePersisted', () => {
  it('returns null for missing data and keeps an empty but valid payload', () => {
    expect(parsePersisted(null, ISO)).toBeNull();
    expect(
      parsePersisted(
        JSON.stringify({ version: 2, watchlist: { symbols: [], updatedAt: ISO }, alerts: [] }),
        ISO,
      ),
    ).toEqual({ watchlist: { symbols: [], updatedAt: ISO }, alerts: [] });
  });
});
