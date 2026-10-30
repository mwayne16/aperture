import { describe, expect, it } from 'vitest';
import { availableFromMs, generateHistory, RETENTION_FLOOR_MS, type HistoryRequest } from './history';

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

function iso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

/** The first 5-minute bar of each session between two instants. */
function sessionOpens(start: string, end: string): string[] {
  const { bars } = generateHistory({ ...base, timeframe: '5Min', start: new Date(start), end: new Date(end) });
  const opens = new Map<string, string>();
  for (const bar of bars) {
    const time = iso(bar.time);
    if (!opens.has(time.slice(0, 10))) opens.set(time.slice(0, 10), time);
  }
  return [...opens.values()];
}

describe('New York session times', () => {
  it.each([
    // Daylight saving starts on the second Sunday in March.
    ['2026-03-05', '2026-03-10', ['2026-03-05T14:30', '2026-03-06T14:30', '2026-03-09T13:30']],
    ['2025-03-06', '2025-03-11', ['2025-03-06T14:30', '2025-03-07T14:30', '2025-03-10T13:30']],
    // It ends on the first Sunday in November.
    ['2026-10-29', '2026-11-03', ['2026-10-29T13:30', '2026-10-30T13:30', '2026-11-02T14:30']],
  ])('opens at 09:30 New York time across the switch from %s to %s', (from, to, expected) => {
    expect(sessionOpens(`${from}T00:00:00Z`, `${to}T00:00:00Z`)).toEqual(
      expected.map((time) => `${time}:00.000Z`),
    );
  });

  it.each([
    ['summer', '2026-07-15T03:59:00Z', '2026-07-14', '13:30', '19:55'],
    ['winter', '2026-01-15T04:59:00Z', '2026-01-14', '14:30', '20:55'],
  ])(
    'in %s, a 1D window ending late in the New York evening shows that day, not the next UTC day',
    (_season, end, day, open, lastBar) => {
      const { bars } = generateHistory({
        ...base,
        timeframe: '5Min',
        lastSessionOnly: true,
        start: new Date(Date.parse(end) - 5 * 86_400_000),
        end: new Date(end),
      });
      expect(bars).toHaveLength(78);
      expect(iso(bars[0]!.time)).toBe(`${day}T${open}:00.000Z`);
      expect(iso(bars[bars.length - 1]!.time)).toBe(`${day}T${lastBar}:00.000Z`);
    },
  );
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
