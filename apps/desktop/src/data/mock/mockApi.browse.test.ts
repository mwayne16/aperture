import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApiError } from '../api';
import type { SimulationState } from '../simulation';
import { generateHistory } from './history';
import { createMockMarket } from './market';
import { createMockApi } from './mockApi';
import { createRepository } from './repository';
import { createSimulationSource } from './simulationSource';

const NOW = Date.UTC(2026, 10, 7, 15, 0); // Saturday

function setup(sim: Partial<SimulationState> = {}, now: () => number = () => NOW) {
  const market = createMockMarket();
  const api = createMockApi({
    repo: createRepository({ now }),
    market,
    simulation: createSimulationSource({ apiLatencyMs: 0, ...sim }),
    now,
  });
  return { api, market };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('listInstruments', () => {
  it('lists one asset class, ordered by symbol', async () => {
    const { api } = setup();
    const crypto = await api.listInstruments('crypto');
    expect(crypto.map((i) => i.symbol)).toContain('BTC/USD');
    expect(crypto.every((i) => i.assetClass === 'crypto' && i.exchange === 'CRYPTO')).toBe(true);
    const etfs = await api.listInstruments('etf');
    expect(etfs.map((i) => i.symbol)).toEqual([...etfs.map((i) => i.symbol)].sort());
    expect(etfs.some((i) => i.symbol === 'SPY')).toBe(true);
  });

  it('rejects an unknown asset class', async () => {
    const { api } = setup();
    const error = await api.listInstruments('bond' as never).catch((e: unknown) => e);
    expect(isApiError(error) && error.code).toBe('VALIDATION_ERROR');
  });
});

describe('getSnapshots', () => {
  it('returns one quote per symbol in the order asked, with unknown symbols unavailable', async () => {
    const { api } = setup();
    const quotes = await api.getSnapshots(['msft', 'BTC/USD', 'ZZZZ']);
    expect(quotes.map((q) => q.symbol)).toEqual(['MSFT', 'BTC/USD', 'ZZZZ']);
    expect(quotes[0]?.status).toBe('live');
    expect(quotes[1]?.last).toBeGreaterThan(1000);
    expect(quotes[2]).toMatchObject({ status: 'unavailable', last: null });
  });

  it('labels snapshots delayed when the feed is delayed', async () => {
    const { api } = setup({ feedScenario: 'delayed' });
    expect((await api.getSnapshots(['AAPL']))[0]?.status).toBe('delayed');
  });

  it('moves symbols nobody streams once they have been idle for a while', async () => {
    let now = NOW;
    const { api } = setup({}, () => now);
    const first = (await api.getSnapshots(['XOM']))[0];
    now += 5 * 60_000;
    const later = (await api.getSnapshots(['XOM']))[0];
    expect(later?.last).not.toBe(first?.last);
    expect(later?.lastTradeAt).toBe(now);
  });
});

describe('getMovers', () => {
  it('ranks stocks only: gainers up, losers down, most active by volume', async () => {
    const { api } = setup();
    const movers = await api.getMovers(3);
    expect(movers.simulated).toBe(true);
    expect(movers.gainers.length).toBeLessThanOrEqual(3);
    for (const list of [movers.gainers, movers.losers, movers.mostActive]) {
      expect(list.every((q) => !q.symbol.includes('/'))).toBe(true);
    }
    const gains = movers.gainers.map((q) => q.changePct ?? 0);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
    expect(gains.every((g) => g > 0)).toBe(true);
    const losses = movers.losers.map((q) => q.changePct ?? 0);
    expect(losses).toEqual([...losses].sort((a, b) => a - b));
    expect(losses.every((l) => l < 0)).toBe(true);
    const volumes = movers.mostActive.map((q) => q.volume ?? 0);
    expect(volumes).toEqual([...volumes].sort((a, b) => b - a));
  });

  it('rejects a limit outside 1-50', async () => {
    const { api } = setup();
    for (const limit of [0, 51, 2.5]) {
      const error = await api.getMovers(limit).catch((e: unknown) => e);
      expect(isApiError(error) && error.code, String(limit)).toBe('VALIDATION_ERROR');
    }
  });
});

describe('getNews', () => {
  it('returns simulated items newest first, never claiming a real source or link', async () => {
    const { api } = setup();
    const news = await api.getNews({ limit: 8 });
    expect(news).toHaveLength(8);
    const times = news.map((n) => n.publishedAt);
    expect(times).toEqual([...times].sort().reverse());
    for (const item of news) {
      expect(item.simulated).toBe(true);
      expect(item.url).toBeNull();
      expect(item.source).toBe('Simulated newswire');
      expect(item.headline).toMatch(/^(Sample|Placeholder)/);
    }
  });

  it('filters to the symbols asked for and stays stable within the hour', async () => {
    const { api } = setup();
    const first = await api.getNews({ symbols: ['aapl'], limit: 5 });
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((n) => n.symbols.includes('AAPL'))).toBe(true);
    expect(await api.getNews({ symbols: ['AAPL'], limit: 5 })).toEqual(first);
  });
});

describe('crypto history', () => {
  const crypto = {
    symbol: 'BTC/USD',
    listedYear: 2021,
    volatility: 2,
    averageVolume: 28_000,
    lastPrice: 68_000,
    continuous: true,
  };

  it('has bars on weekends and overnight', () => {
    const { bars } = generateHistory({
      ...crypto,
      timeframe: '1Hour',
      start: new Date(Date.UTC(2026, 10, 7, 0)), // Saturday
      end: new Date(Date.UTC(2026, 10, 8, 23, 59)), // Sunday
      lastSessionOnly: false,
    });
    expect(bars).toHaveLength(48);
    expect(bars.at(-1)?.close).toBe(68_000);
  });

  it('shows the last 24 hours on 1D', () => {
    const { bars } = generateHistory({
      ...crypto,
      timeframe: '5Min',
      start: new Date(NOW - 5 * 86_400_000),
      end: new Date(NOW),
      lastSessionOnly: true,
    });
    expect(bars).toHaveLength(288);
    expect(bars[0]!.time * 1000).toBeGreaterThan(NOW - 86_400_000);
  });

  it('serves crypto through getHistory with daily bars every day', async () => {
    vi.useFakeTimers({ now: NOW });
    const { api } = setup();
    const promise = api.getHistory('ETH/USD', '1M');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.timeframe).toBe('1Hour');
    const days = new Set(result.bars.map((b) => new Date(b.time * 1000).getUTCDay()));
    expect(days.has(0) && days.has(6)).toBe(true);
  });
});
