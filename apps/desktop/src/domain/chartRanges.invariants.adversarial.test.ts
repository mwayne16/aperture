import { describe, expect, it } from 'vitest';
import { describeTimeframe, resolveRange } from './chartRanges';
import { type BarTimeframe, type ChartRange, CHART_RANGES } from './types';

/**
 * Round-3 adversarial tests for chartRanges, derived from the doc-comment table.
 * Seeded invariants across many dates (including every month end), plus aliasing checks.
 */

const DAY_MS = 86_400_000;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent calendar arithmetic: days in a 0-based UTC month. */
function daysIn(year: number, month0: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month0]!;
}

function expectedMonthsBack(now: Date, months: number): string {
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() - months;
  while (m < 0) {
    m += 12;
    y -= 1;
  }
  const d = Math.min(now.getUTCDate(), daysIn(y, m));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const time = now.toISOString().slice(10); // "THH:mm:ss.sssZ"
  return `${pad(y, 4)}-${pad(m + 1)}-${pad(d)}${time}`;
}

const MONTHS: Partial<Record<ChartRange, number>> = {
  '1M': 1,
  '3M': 3,
  '6M': 6,
  '1Y': 12,
  '5Y': 60,
  '10Y': 120,
};
const TIMEFRAMES: Record<ChartRange, BarTimeframe> = {
  '1D': '5Min',
  '1W': '30Min',
  '1M': '1Hour',
  '3M': '1Day',
  '6M': '1Day',
  YTD: '1Day',
  '1Y': '1Day',
  '5Y': '1Week',
  '10Y': '1Month',
  ALL: '1Month',
};

describe('resolveRange seeded invariants (round 3)', () => {
  const r = rng(31337);
  const dates: Date[] = [];
  // Every month end and month start from 1999 to 2032, at an awkward time of day.
  for (let y = 1999; y <= 2032; y++) {
    for (let m = 0; m < 12; m++) {
      dates.push(new Date(Date.UTC(y, m, daysIn(y, m), 23, 59, 59, 999)));
      dates.push(new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)));
      dates.push(new Date(Date.UTC(y, m, 30, 12, 34, 56, 789))); // rolls over in Feb, intentionally
    }
  }
  for (let i = 0; i < 1500; i++) dates.push(new Date(Math.floor(r() * 2_000_000_000_000)));

  it('every range matches the table for month-ends, month-starts and random instants', () => {
    for (const now of dates) {
      const iso = now.toISOString();
      for (const range of CHART_RANGES) {
        const spec = resolveRange(range, now);
        expect(spec.range).toBe(range);
        expect(spec.timeframe, `${range} @ ${iso}`).toBe(TIMEFRAMES[range]);
        expect(spec.lastSessionOnly).toBe(range === '1D');
        expect(spec.end.getTime()).toBe(now.getTime());
        expect(spec.end).not.toBe(now);
        const months = MONTHS[range];
        if (months !== undefined) {
          expect(spec.start?.toISOString(), `${range} @ ${iso}`).toBe(expectedMonthsBack(now, months));
        } else if (range === '1D') {
          expect(spec.start?.getTime()).toBe(now.getTime() - 5 * DAY_MS);
        } else if (range === '1W') {
          expect(spec.start?.getTime()).toBe(now.getTime() - 7 * DAY_MS);
        } else if (range === 'YTD') {
          expect(spec.start?.toISOString()).toBe(`${iso.slice(0, 4)}-01-01T00:00:00.000Z`);
        } else {
          expect(spec.start).toBeNull();
        }
        if (spec.start) expect(spec.start.getTime()).toBeLessThanOrEqual(spec.end.getTime());
      }
    }
  });

  it('windows nest: a longer range never starts after a shorter one', () => {
    const order: ChartRange[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
    for (const now of dates) {
      let prev = Infinity;
      for (const range of order) {
        const t = resolveRange(range, now).start!.getTime();
        expect(t, `${range} @ ${now.toISOString()}`).toBeLessThanOrEqual(prev);
        prev = t;
      }
      // YTD sits between "now" and 1Y ago.
      const ytd = resolveRange('YTD', now).start!.getTime();
      expect(ytd).toBeLessThanOrEqual(now.getTime());
      expect(ytd).toBeGreaterThan(resolveRange('1Y', now).start!.getTime() - 1);
    }
  });

  it('month windows are between 28 and 31 days long per month subtracted', () => {
    for (const now of dates) {
      for (const [range, months] of Object.entries(MONTHS) as [ChartRange, number][]) {
        const days = (now.getTime() - resolveRange(range, now).start!.getTime()) / DAY_MS;
        expect(days).toBeGreaterThanOrEqual(28 * months - 3); // clamping can shave up to 3 days
        expect(days).toBeLessThanOrEqual(31 * months);
      }
    }
  });
});

describe('resolveRange aliasing and purity (round 3)', () => {
  it('does not mutate now, and mutating any returned date affects nothing else', () => {
    const now = new Date('2024-03-31T15:00:00.000Z');
    const snapshot = now.getTime();
    const specs = CHART_RANGES.map((range) => resolveRange(range, now));
    expect(now.getTime()).toBe(snapshot);

    for (const s of specs) {
      s.end.setTime(0);
      s.start?.setTime(0);
    }
    expect(now.getTime()).toBe(snapshot);
    const again = resolveRange('1M', now);
    expect(again.start?.toISOString()).toBe('2024-02-29T15:00:00.000Z');
    expect(again.end.getTime()).toBe(snapshot);
  });

  it('start and end are distinct objects even when YTD starts exactly at now', () => {
    const now = new Date('2025-01-01T00:00:00.000Z');
    const spec = resolveRange('YTD', now);
    expect(spec.start?.getTime()).toBe(now.getTime());
    expect(spec.start).not.toBe(spec.end);
    expect(spec.start).not.toBe(now);
  });

  it('YTD uses the UTC year even when the local year differs (Dec 31 evening in New York)', () => {
    // 2025-01-01T03:00Z is still Dec 31 2024 in America/New_York; UTC year is 2025.
    const spec = resolveRange('YTD', new Date('2025-01-01T03:00:00.000Z'));
    expect(spec.start?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    // And the last UTC instant of a year still belongs to that year.
    expect(resolveRange('YTD', new Date('2024-12-31T23:59:59.999Z')).start?.toISOString()).toBe(
      '2024-01-01T00:00:00.000Z',
    );
  });

  it('returns a RangeSpec with exactly the documented keys', () => {
    for (const range of CHART_RANGES) {
      expect(Object.keys(resolveRange(range, new Date(0))).sort()).toEqual(
        ['end', 'lastSessionOnly', 'range', 'start', 'timeframe'].sort(),
      );
    }
  });
});

describe('describeTimeframe (round 3)', () => {
  const ALL: BarTimeframe[] = ['5Min', '15Min', '30Min', '1Hour', '1Day', '1Week', '1Month'];

  it('gives a distinct, non-empty, short label for every timeframe', () => {
    const labels = ALL.map(describeTimeframe);
    expect(new Set(labels).size).toBe(ALL.length);
    for (const l of labels) {
      expect(l.trim()).toBe(l);
      expect(l.length).toBeGreaterThan(0);
      expect(l.length).toBeLessThanOrEqual(20);
      expect(l).toMatch(/bars$/);
    }
  });

  it('matches the documented example style for minute bars', () => {
    expect(describeTimeframe('5Min')).toBe('5-minute bars');
    expect(describeTimeframe('15Min')).toBe('15-minute bars');
    expect(describeTimeframe('30Min')).toBe('30-minute bars');
  });

  it('labels every timeframe the range table can produce', () => {
    for (const range of CHART_RANGES) {
      expect(() => describeTimeframe(resolveRange(range, new Date()).timeframe)).not.toThrow();
    }
  });
});
