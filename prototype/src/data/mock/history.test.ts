import { describe, expect, it } from 'vitest';
import {
  availableFromMs,
  generateHistory,
  isUsDst,
  newYorkDate,
  RETENTION_FLOOR_MS,
  sessionOpenMs,
  type HistoryRequest,
} from './history';

const base: HistoryRequest = {
  symbol: 'AAPL',
  timeframe: '1Day',
  start: new Date(Date.UTC(2026, 6, 1)),
  end: new Date(Date.UTC(2026, 9, 21, 15)),
  lastSessionOnly: false,
  listedYear: 1980,
  volatility: 1,
  averageVolume: 50_000_000,
  lastPrice: 230.12,
};

describe('US Eastern daylight saving', () => {
  it.each([
    [2026, 2, 7, false],
    [2026, 2, 8, true], // second Sunday in March
    [2026, 9, 31, true],
    [2026, 10, 1, false], // first Sunday in November
    [2025, 2, 9, true],
    [2025, 10, 2, false],
    [2026, 0, 15, false],
    [2026, 6, 4, true],
  ])('%i-%i-%i → %s', (year, month, day, expected) => {
    expect(isUsDst(year, month, day)).toBe(expected);
  });

  it('opens the session at 13:30 UTC in summer and 14:30 UTC in winter', () => {
    expect(new Date(sessionOpenMs({ year: 2026, month: 6, day: 15 })).toISOString()).toBe(
      '2026-07-15T13:30:00.000Z',
    );
    expect(new Date(sessionOpenMs({ year: 2026, month: 0, day: 15 })).toISOString()).toBe(
      '2026-01-15T14:30:00.000Z',
    );
  });

  it('maps instants near midnight UTC to the New York calendar date', () => {
    expect(newYorkDate(Date.UTC(2026, 6, 15, 3, 59))).toEqual({ year: 2026, month: 6, day: 14 });
    expect(newYorkDate(Date.UTC(2026, 6, 15, 4, 0))).toEqual({ year: 2026, month: 6, day: 15 });
    expect(newYorkDate(Date.UTC(2026, 0, 15, 4, 59))).toEqual({ year: 2026, month: 0, day: 14 });
    expect(newYorkDate(Date.UTC(2026, 0, 15, 5, 0))).toEqual({ year: 2026, month: 0, day: 15 });
  });
});

describe('generateHistory', () => {
  it('uses the later of the retention floor and the listing year', () => {
    expect(availableFromMs(1980)).toBe(RETENTION_FLOOR_MS);
    expect(availableFromMs(2020)).toBe(Date.UTC(2020, 0, 1));
  });

  it('returns no bars for invalid dates instead of looping', () => {
    for (const timeframe of ['5Min', '1Day', '1Week', '1Month'] as const) {
      expect(generateHistory({ ...base, timeframe, end: new Date(Number.NaN) }).bars).toEqual([]);
      expect(generateHistory({ ...base, timeframe, start: new Date(Number.NaN) }).bars).toEqual([]);
    }
  });

  it('returns no bars (truncated) for an instrument listed after the window', () => {
    const result = generateHistory({ ...base, listedYear: 2030 });
    expect(result).toEqual({ bars: [], truncated: true });
  });

  it('returns no bars for a window with no sessions (a weekend)', () => {
    const result = generateHistory({
      ...base,
      timeframe: '5Min',
      start: new Date(Date.UTC(2026, 9, 24, 0)),
      end: new Date(Date.UTC(2026, 9, 25, 23)),
    });
    expect(result.bars).toEqual([]);
  });

  it('keeps every bar positive with tick-rounded prices even for a sub-dollar last price', () => {
    const { bars } = generateHistory({
      ...base,
      timeframe: '1Month',
      start: null,
      lastPrice: 0.42,
      volatility: 2.5,
    });
    expect(bars.length).toBeGreaterThan(100);
    for (const bar of bars) {
      expect(bar.low).toBeGreaterThan(0);
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
    }
    expect(bars.at(-1)?.close).toBe(0.42);
  });

  it('keeps a bar’s shape stable as the window moves (seeded by bar time)', () => {
    const a = generateHistory(base).bars;
    const b = generateHistory({ ...base, end: new Date(Date.UTC(2026, 9, 28, 15)) }).bars;
    const ratio = (bars: typeof a, time: number): number => {
      const bar = bars.find((x) => x.time === time)!;
      return bar.close / bar.open;
    };
    const shared = a[10]!.time;
    expect(ratio(a, shared)).toBeCloseTo(ratio(b, shared), 2);
  });
});
