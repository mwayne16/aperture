import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketApi } from '../../data/api';
import { createMockMarket } from '../../data/mock/market';
import { createMockApi, HISTORY_DELAY_MS } from '../../data/mock/mockApi';
import { createRepository } from '../../data/mock/repository';
import { createSimulationSource } from '../../data/mock/simulationSource';
import type { Bar, ChartRange } from '../../domain/types';

/**
 * The detail panel shows the quote's day stats next to the chart, and the range picker shows the
 * same sessions at different bar sizes. These checks hold the simulated history to the numbers the
 * user can already see elsewhere on the same panel.
 */

/** Thursday 2026-11-05 15:00 New York (EST), during the regular session. */
const NOW = Date.UTC(2026, 10, 5, 20, 0);
const DAY = 86_400;
const TODAY = Date.UTC(2026, 10, 5) / 1000;
/** Tuesday of the same week: covered by 1W (30-minute bars), 1M (hourly) and 3M (daily). */
const TUESDAY = Date.UTC(2026, 10, 3) / 1000;

function setup() {
  const now = () => NOW;
  const market = createMockMarket();
  const api = createMockApi({
    repo: createRepository({ now, storage: null }),
    market,
    simulation: createSimulationSource({ apiLatencyMs: 0 }),
    now,
  });
  return { market, api };
}

async function bars(api: MarketApi, symbol: string, range: ChartRange): Promise<Bar[]> {
  const pending = api.getHistory(symbol, range);
  await vi.advanceTimersByTimeAsync(HISTORY_DELAY_MS.normal);
  return (await pending).bars;
}

function onDay(day: number) {
  return (bar: Bar) => bar.time >= day && bar.time < day + DAY;
}

const highest = (list: Bar[]) => Math.max(...list.map((b) => b.high));
const lowest = (list: Bar[]) => Math.min(...list.map((b) => b.low));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('simulated history against the quote on the same panel (QA)', () => {
  it("draws today's 1D session inside the open, high and low the quote reports", async () => {
    const { market, api } = setup();
    // ** The feed publishes these fields as the quote's Open, High and Low in the stats grid.
    const day = market.getState('AAPL');
    if (!day) throw new Error('AAPL is not in the simulated universe.');
    const session = (await bars(api, 'AAPL', '1D')).filter(onDay(TODAY));
    expect(session.length).toBeGreaterThan(0);
    expect(session[0]?.open).toBe(day.open);
    expect(highest(session)).toBeLessThanOrEqual(day.high);
    expect(lowest(session)).toBeGreaterThanOrEqual(day.low);
  });

  it("closes yesterday's daily bar at the quote's previous close", async () => {
    const { market, api } = setup();
    const day = market.getState('AAPL');
    if (!day) throw new Error('AAPL is not in the simulated universe.');
    const yesterday = (await bars(api, 'AAPL', '3M')).filter((b) => b.time < TODAY).at(-1);
    expect(yesterday?.close).toBe(day.prevClose);
  });
});

describe('simulated history across ranges (QA)', () => {
  it('shows the same past session at the same prices on 1W, 1M and 3M', async () => {
    const { api } = setup();
    const thirtyMinute = (await bars(api, 'AAPL', '1W')).filter(onDay(TUESDAY));
    const hourly = (await bars(api, 'AAPL', '1M')).filter(onDay(TUESDAY));
    const daily = (await bars(api, 'AAPL', '3M')).find((b) => b.time === TUESDAY);
    if (!daily || thirtyMinute.length === 0 || hourly.length === 0) throw new Error('Missing bars for Tuesday.');

    // ** A daily bar spans its intraday bars, so every intraday price must fall inside it.
    for (const intraday of [thirtyMinute, hourly]) {
      expect(highest(intraday)).toBeLessThanOrEqual(daily.high);
      expect(lowest(intraday)).toBeGreaterThanOrEqual(daily.low);
      expect(intraday.at(-1)?.close).toBe(daily.close);
    }
  });

  it('keeps a past bar at the same prices when the live price has moved since the last load', async () => {
    const { market, api } = setup();
    const before = (await bars(api, 'AAPL', '1Y'))[0];
    // ** Trades move the live price, as the feed does between two loads of the same range.
    for (let i = 0; i < 300; i++) market.trade('AAPL', NOW);
    const after = (await bars(api, 'AAPL', '1Y'))[0];
    expect(after?.time).toBe(before?.time);
    expect(after).toEqual(before);
  });
});
