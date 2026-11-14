import { describe, expect, it } from 'vitest';
import { describeTimeframe, resolveRange } from './chartRanges.js';
import { type BarTimeframe, type ChartRange, CHART_RANGES } from './marketData.js';

/**
 * Round-2 adversarial tests for chartRanges: an independent reference model for calendar-month
 * subtraction checked over many seeded dates, plus time-zone independence and contract checks.
 */

const MONTHS_BACK: Partial<Record<ChartRange, number>> = {
  '1M': 1,
  '3M': 3,
  '6M': 6,
  '1Y': 12,
  '5Y': 60,
  '10Y': 120,
};

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]!;
}

/** Reference: step back one month at a time, then clamp once at the end. */
function referenceStart(now: Date, months: number): string {
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  for (let i = 0; i < months; i++) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  const d = Math.min(now.getUTCDate(), daysInMonth(y, m));
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const time = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}.${pad(now.getUTCMilliseconds(), 3)}`;
  return `${pad(y, 4)}-${pad(m + 1)}-${pad(d)}T${time}Z`;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('resolveRange calendar subtraction vs reference model (round 2)', () => {
  it('matches the reference for 3000 seeded dates between 1971 and 2199', () => {
    const rand = lcg(20261023);
    const lo = Date.UTC(1971, 0, 1);
    const hi = Date.UTC(2199, 11, 31, 23, 59, 59, 999);
    for (let i = 0; i < 3000; i++) {
      const now = new Date(lo + Math.floor(rand() * (hi - lo)));
      for (const [range, months] of Object.entries(MONTHS_BACK) as [ChartRange, number][]) {
        expect(resolveRange(range, now).start?.toISOString(), `${range} from ${now.toISOString()}`).toBe(
          referenceStart(now, months),
        );
      }
    }
  });

  it('matches the reference on every month-end of 2023-2025 (all clamping cases)', () => {
    for (let y = 2023; y <= 2025; y++) {
      for (let m = 0; m < 12; m++) {
        for (let d = 28; d <= daysInMonth(y, m); d++) {
          const now = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
          for (const [range, months] of Object.entries(MONTHS_BACK) as [ChartRange, number][]) {
            expect(resolveRange(range, now).start?.toISOString(), `${range} from ${now.toISOString()}`).toBe(
              referenceStart(now, months),
            );
          }
        }
      }
    }
  });

  it('specific clamps: May 31 - 3M = Feb 29 2024; Aug 31 - 6M = Feb 28 2025; Feb 29 2024 - 5Y = Feb 28 2019', () => {
    expect(resolveRange('3M', new Date('2024-05-31T12:00:00.000Z')).start?.toISOString()).toBe(
      '2024-02-29T12:00:00.000Z',
    );
    expect(resolveRange('6M', new Date('2025-08-31T00:00:00.000Z')).start?.toISOString()).toBe(
      '2025-02-28T00:00:00.000Z',
    );
    expect(resolveRange('5Y', new Date('2024-02-29T09:30:00.000Z')).start?.toISOString()).toBe(
      '2019-02-28T09:30:00.000Z',
    );
    expect(resolveRange('10Y', new Date('2024-02-29T09:30:00.000Z')).start?.toISOString()).toBe(
      '2014-02-28T09:30:00.000Z',
    );
    // Crossing a year boundary backwards.
    expect(resolveRange('1M', new Date('2025-01-31T05:00:00.000Z')).start?.toISOString()).toBe(
      '2024-12-31T05:00:00.000Z',
    );
  });
});

describe('resolveRange general contract (round 2)', () => {
  it('YTD uses the UTC year, not the local year implied by an offset timestamp', () => {
    // 2025-01-01T03:00+05:00 is 2024-12-31T22:00Z, still in 2024 UTC.
    const spec = resolveRange('YTD', new Date('2025-01-01T03:00:00+05:00'));
    expect(spec.start?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    // 2024-12-31T20:00-05:00 is 2025-01-01T01:00Z, already 2025 UTC.
    const spec2 = resolveRange('YTD', new Date('2024-12-31T20:00:00-05:00'));
    expect(spec2.start?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('start <= end for every range over seeded dates, and start < end except YTD at the year start', () => {
    const rand = lcg(7);
    const nows = [new Date(Date.UTC(2024, 0, 1)), new Date(Date.UTC(2025, 0, 1, 0, 0, 0, 1))];
    for (let i = 0; i < 200; i++) nows.push(new Date(Date.UTC(2000, 0, 1) + Math.floor(rand() * 1e12)));
    for (const now of nows) {
      for (const range of CHART_RANGES) {
        const spec = resolveRange(range, now);
        expect(spec.end.getTime()).toBe(now.getTime());
        if (spec.start === null) {
          expect(range).toBe('ALL');
          continue;
        }
        expect(spec.start.getTime()).toBeLessThanOrEqual(spec.end.getTime());
        if (!(range === 'YTD' && spec.start.getTime() === now.getTime())) {
          expect(spec.start.getTime()).toBeLessThan(spec.end.getTime());
        }
      }
    }
  });

  it('returns fresh Date objects per call (start and end are never shared across calls)', () => {
    const now = new Date('2024-06-15T12:00:00.000Z');
    const a = resolveRange('1M', now);
    const b = resolveRange('1M', now);
    expect(a.start).not.toBe(b.start);
    expect(a.end).not.toBe(b.end);
    a.start!.setUTCFullYear(1999);
    a.end.setUTCFullYear(1999);
    expect(b.start?.toISOString()).toBe('2024-05-15T12:00:00.000Z');
    expect(resolveRange('1M', now).end.toISOString()).toBe('2024-06-15T12:00:00.000Z');
  });

  it('the shape has exactly the documented keys', () => {
    const spec = resolveRange('1D', new Date('2024-06-15T12:00:00.000Z'));
    expect(Object.keys(spec).sort()).toEqual(['end', 'lastSessionOnly', 'range', 'start', 'timeframe']);
  });
});

describe('describeTimeframe contract (round 2)', () => {
  it('labels match the documented style, e.g. "5-minute bars"', () => {
    expect(describeTimeframe('5Min')).toBe('5-minute bars');
    const all: BarTimeframe[] = ['5Min', '15Min', '30Min', '1Hour', '1Day', '1Week', '1Month'];
    for (const tf of all) expect(describeTimeframe(tf)).toMatch(/bars$/);
  });

  // The declared return type is string. Untyped callers (persisted settings) must never get an
  // inherited Object.prototype member such as a function back as a "label".
  it.each(['1Year', 'toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    'never returns a non-string for the unknown or prototype key %j',
    (key) => {
      let result: unknown;
      try {
        result = describeTimeframe(key as BarTimeframe);
      } catch {
        return; // throwing is an acceptable way to reject it
      }
      expect(typeof result).toBe('string');
    },
  );
});
