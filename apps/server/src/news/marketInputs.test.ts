import { describe, expect, it } from 'vitest';
import { MarketDataService } from '../marketData/marketDataService.js';
import type { ProviderBar } from '../marketData/provider.js';
import { FakeProvider, snapshot } from '../test/fakeProvider.js';
import { loadMarketInputs } from './marketInputs.js';

const NOW = Date.parse('2026-11-16T18:00:00Z');
const DAY = 86_400_000;

/** Daily bars for the 25 days before NOW with the given volume, plus today's bar. */
function dailyBars(volume: number): ProviderBar[] {
  const past = Array.from({ length: 25 }, (_, i) => ({
    time: NOW - (25 - i) * DAY,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume,
  }));
  return [...past, { time: NOW - 3_600_000, open: 1, high: 1, low: 1, close: 1, volume: 999_999 }];
}

describe('loadMarketInputs', () => {
  it("gathers the day's move, volume against the 20-day average, the most active and company names", async () => {
    const provider = new FakeProvider();
    provider.snapshots.set('AAPL', snapshot('AAPL', { last: 103, prevClose: 100, volume: 3_000 }));
    provider.snapshots.set('MSFT', snapshot('MSFT'));
    provider.bars.set('AAPL', dailyBars(1_000));
    provider.movers = { gainers: [], losers: [], mostActive: ['MSFT'], asOf: NOW };
    const inputs = await loadMarketInputs(new MarketDataService(provider, () => NOW), ['AAPL']);

    expect(inputs.changePct.get('AAPL')).toBeCloseTo(3);
    expect(inputs.volumeRatio.get('AAPL')).toBeCloseTo(3);
    expect([...inputs.mostActive]).toEqual(['MSFT']);
    expect(inputs.names.get('AAPL')).toBe('Apple Inc.');
    expect(provider.calls.getBars[0]).toMatchObject({ symbols: ['AAPL'], timeframe: '1Day' });
  });

  it('leaves parts empty instead of failing when the provider does', async () => {
    const provider = new FakeProvider();
    provider.failWith = new Error('down');
    const inputs = await loadMarketInputs(new MarketDataService(provider, () => NOW), ['AAPL']);
    expect([
      inputs.changePct.size,
      inputs.volumeRatio.size,
      inputs.mostActive.size,
      inputs.names.size,
    ]).toEqual([0, 0, 0, 0]);
  });

  it('asks only for the most active list when nothing is watched', async () => {
    const provider = new FakeProvider();
    await loadMarketInputs(new MarketDataService(provider, () => NOW), []);
    expect([
      provider.calls.getSnapshots.length,
      provider.calls.getBars.length,
      provider.calls.getMovers,
    ]).toEqual([0, 0, [50]]);
  });
});

describe('MarketDataService.averageDailyVolume', () => {
  it('averages the last 20 sessions before today, skips symbols with little history, and caches', async () => {
    const provider = new FakeProvider();
    provider.bars.set('AAPL', dailyBars(1_000));
    provider.bars.set('NEW', dailyBars(50).slice(-4));
    const service = new MarketDataService(provider, () => NOW);
    const averages = await service.averageDailyVolume(['AAPL', 'NEW']);
    expect([...averages]).toEqual([['AAPL', 1_000]]);
    await service.averageDailyVolume(['NEW', 'AAPL']);
    expect(provider.calls.getBars).toHaveLength(1);
  });
});
