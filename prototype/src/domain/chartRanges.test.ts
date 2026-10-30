import { describe, expect, it } from 'vitest';
import { describeTimeframe, resolveRange } from './chartRanges';
import { type BarTimeframe, type ChartRange, CHART_RANGES } from './types';

const iso = (date: Date | null) => (date ? date.toISOString() : null);
const at = (isoString: string) => new Date(isoString);

describe('resolveRange: every range from a fixed "now"', () => {
  const NOW = '2026-10-23T15:30:45.123Z';

  it.each<[ChartRange, BarTimeframe, string | null, boolean]>([
    ['1D', '5Min', '2026-10-18T15:30:45.123Z', true],
    ['1W', '30Min', '2026-10-16T15:30:45.123Z', false],
    ['1M', '1Hour', '2026-09-23T15:30:45.123Z', false],
    ['3M', '1Day', '2026-07-23T15:30:45.123Z', false],
    ['6M', '1Day', '2026-04-23T15:30:45.123Z', false],
    ['YTD', '1Day', '2026-01-01T00:00:00.000Z', false],
    ['1Y', '1Day', '2025-10-23T15:30:45.123Z', false],
    ['5Y', '1Week', '2021-10-23T15:30:45.123Z', false],
    ['10Y', '1Month', '2016-10-23T15:30:45.123Z', false],
    ['ALL', '1Month', null, false],
  ])('%s -> %s from %s (lastSessionOnly=%s)', (range, timeframe, start, lastSessionOnly) => {
    const spec = resolveRange(range, at(NOW));
    expect(spec.range).toBe(range);
    expect(spec.timeframe).toBe(timeframe);
    expect(iso(spec.start)).toBe(start);
    expect(iso(spec.end)).toBe(NOW);
    expect(spec.lastSessionOnly).toBe(lastSessionOnly);
  });

  it('covers every declared chart range with a window that ends at now and starts before it', () => {
    const now = at(NOW);
    for (const range of CHART_RANGES) {
      const spec = resolveRange(range, now);
      expect(spec.end.getTime()).toBe(now.getTime());
      if (spec.start) expect(spec.start.getTime()).toBeLessThan(now.getTime());
      expect(spec.lastSessionOnly).toBe(range === '1D');
    }
  });

  it('only ALL has an open start', () => {
    const open = CHART_RANGES.filter((r) => resolveRange(r, at(NOW)).start === null);
    expect(open).toEqual(['ALL']);
  });

  it('windows grow monotonically with the range length', () => {
    const ordered: ChartRange[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
    const starts = ordered.map((r) => resolveRange(r, at(NOW)).start!.getTime());
    for (let i = 1; i < starts.length; i++) expect(starts[i]!).toBeLessThan(starts[i - 1]!);
  });
});

describe('resolveRange: end is a copy of now', () => {
  it('returns an equal but distinct Date for every range', () => {
    const now = at('2026-10-23T15:30:45.123Z');
    for (const range of CHART_RANGES) {
      const spec = resolveRange(range, now);
      expect(spec.end).toEqual(now);
      expect(spec.end).not.toBe(now);
      expect(spec.start).not.toBe(now);
    }
  });

  it("mutating the result does not change the caller's now, and vice versa", () => {
    const now = at('2026-10-23T15:30:45.123Z');
    const spec = resolveRange('1M', now);
    spec.end.setUTCFullYear(1999);
    spec.start!.setUTCFullYear(1999);
    expect(now.toISOString()).toBe('2026-10-23T15:30:45.123Z');

    const fresh = resolveRange('1M', now);
    now.setUTCFullYear(2000);
    expect(iso(fresh.end)).toBe('2026-10-23T15:30:45.123Z');
    expect(iso(fresh.start)).toBe('2026-09-23T15:30:45.123Z');
  });
});

describe('resolveRange: calendar month clamping (UTC)', () => {
  it.each<[ChartRange, string, string]>([
    // Mar 31 - 1 month clamps to the end of February: leap and non-leap years.
    ['1M', '2024-03-31T12:00:00.000Z', '2024-02-29T12:00:00.000Z'],
    ['1M', '2025-03-31T12:00:00.000Z', '2025-02-28T12:00:00.000Z'],
    ['1M', '2100-03-31T12:00:00.000Z', '2100-02-28T12:00:00.000Z'], // 2100 is not a leap year
    ['1M', '2000-03-31T12:00:00.000Z', '2000-02-29T12:00:00.000Z'], // 2000 is
    ['1M', '2026-05-31T08:00:00.000Z', '2026-04-30T08:00:00.000Z'],
    ['1M', '2026-03-30T00:00:00.000Z', '2026-02-28T00:00:00.000Z'],
    ['1M', '2026-03-28T23:59:59.999Z', '2026-02-28T23:59:59.999Z'],
    // Crossing a year boundary.
    ['1M', '2026-01-31T10:00:00.000Z', '2025-12-31T10:00:00.000Z'],
    ['3M', '2026-01-15T10:00:00.000Z', '2025-10-15T10:00:00.000Z'],
    ['6M', '2026-03-01T00:00:00.000Z', '2025-09-01T00:00:00.000Z'],
    ['3M', '2024-05-31T12:00:00.000Z', '2024-02-29T12:00:00.000Z'],
    ['6M', '2024-08-31T12:00:00.000Z', '2024-02-29T12:00:00.000Z'],
    ['6M', '2025-12-31T12:00:00.000Z', '2025-06-30T12:00:00.000Z'],
    // Leap day minus whole years.
    ['1Y', '2024-02-29T09:30:00.000Z', '2023-02-28T09:30:00.000Z'],
    ['5Y', '2024-02-29T09:30:00.000Z', '2019-02-28T09:30:00.000Z'],
    ['10Y', '2024-02-29T09:30:00.000Z', '2014-02-28T09:30:00.000Z'],
    ['5Y', '2028-02-29T09:30:00.000Z', '2023-02-28T09:30:00.000Z'],
    // Feb 28 in a year after a leap year stays Feb 28 (no drift to the 29th).
    ['1Y', '2025-02-28T09:30:00.000Z', '2024-02-28T09:30:00.000Z'],
    ['1Y', '2025-03-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z'],
  ])('%s from %s starts %s', (range, now, expected) => {
    expect(iso(resolveRange(range, at(now)).start)).toBe(expected);
  });

  it('uses UTC fields, not the local calendar day', () => {
    // 2026-04-01T02:00Z is still March 31 in America/Chicago, but UTC says April 1.
    expect(iso(resolveRange('1M', at('2026-04-01T02:00:00.000Z')).start)).toBe('2026-03-01T02:00:00.000Z');
  });
});

describe('resolveRange: fixed-length windows', () => {
  it('1D and 1W subtract exact days in UTC, unaffected by US DST changes', () => {
    // US DST started 2026-03-08; the windows below span it.
    expect(iso(resolveRange('1D', at('2026-03-10T14:00:00.000Z')).start)).toBe('2026-03-05T14:00:00.000Z');
    expect(iso(resolveRange('1W', at('2026-03-10T14:00:00.000Z')).start)).toBe('2026-03-03T14:00:00.000Z');
  });

  it('1D window is exactly 5 days and keeps only the last session', () => {
    const spec = resolveRange('1D', at('2026-10-26T13:00:00.000Z'));
    expect(spec.end.getTime() - spec.start!.getTime()).toBe(5 * 24 * 60 * 60 * 1000);
    expect(spec.lastSessionOnly).toBe(true);
  });
});

describe('resolveRange: YTD', () => {
  it.each([
    ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ['2026-01-01T00:00:00.001Z', '2026-01-01T00:00:00.000Z'],
    ['2026-12-31T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ['2026-12-31T23:59:59.999Z', '2026-01-01T00:00:00.000Z'],
    ['2024-02-29T12:00:00.000Z', '2024-01-01T00:00:00.000Z'],
    // Still Dec 31 in New York, already Jan 1 in UTC: YTD follows UTC.
    ['2027-01-01T03:00:00.000Z', '2027-01-01T00:00:00.000Z'],
  ])('now %s -> start %s', (now, expected) => {
    const spec = resolveRange('YTD', at(now));
    expect(iso(spec.start)).toBe(expected);
    expect(iso(spec.end)).toBe(now);
    expect(spec.timeframe).toBe('1Day');
  });

  it('on Jan 1 00:00 UTC the window is empty but valid (start === end instant)', () => {
    const spec = resolveRange('YTD', at('2026-01-01T00:00:00.000Z'));
    expect(spec.start!.getTime()).toBe(spec.end.getTime());
    expect(spec.start).not.toBe(spec.end);
  });
});

describe('resolveRange: invalid input', () => {
  it('throws a RangeError for an invalid now instead of returning Invalid Date windows', () => {
    expect(() => resolveRange('1M', new Date(Number.NaN))).toThrow(RangeError);
    expect(() => resolveRange('ALL', new Date('not a date'))).toThrow(RangeError);
  });

  it('throws a RangeError for an unknown range value from untyped input', () => {
    expect(() => resolveRange('2Y' as ChartRange, at('2026-10-23T00:00:00.000Z'))).toThrow(RangeError);
    expect(() => resolveRange('' as ChartRange, at('2026-10-23T00:00:00.000Z'))).toThrow(RangeError);
    expect(() => resolveRange('1d' as ChartRange, at('2026-10-23T00:00:00.000Z'))).toThrow(RangeError);
  });

  it('throws a RangeError for a now before 1970', () => {
    const year50 = new Date(0);
    year50.setUTCFullYear(50, 2, 31);
    for (const now of [at('1969-12-31T23:59:59.999Z'), year50, at('0000-03-31T12:00:00.000Z'), new Date(-8.64e15)]) {
      for (const range of CHART_RANGES) expect(() => resolveRange(range, now), range).toThrow(RangeError);
    }
  });

  it('accepts 1970-01-01 exactly, even though its windows start in 1969', () => {
    expect(iso(resolveRange('1Y', at('1970-01-01T00:00:00.000Z')).start)).toBe('1969-01-01T00:00:00.000Z');
  });

  it('returns valid windows at the latest representable now', () => {
    const latest = new Date(8.64e15);
    for (const range of CHART_RANGES) {
      const { start } = resolveRange(range, latest);
      if (start !== null) expect(Number.isNaN(start.getTime()), range).toBe(false);
    }
  });
});

describe('describeTimeframe', () => {
  it.each<[BarTimeframe, string]>([
    ['5Min', '5-minute bars'],
    ['15Min', '15-minute bars'],
    ['30Min', '30-minute bars'],
    ['1Hour', 'Hourly bars'],
    ['1Day', 'Daily bars'],
    ['1Week', 'Weekly bars'],
    ['1Month', 'Monthly bars'],
  ])('%s -> %s', (timeframe, label) => {
    expect(describeTimeframe(timeframe)).toBe(label);
  });

  it('has a label for every timeframe a range can resolve to', () => {
    const now = at('2026-10-23T15:30:45.123Z');
    for (const range of CHART_RANGES) {
      expect(describeTimeframe(resolveRange(range, now).timeframe)).toMatch(/ bars$/);
    }
  });

  // Guards untyped callers (persisted settings), like resolveRange: never undefined or an inherited
  // Object.prototype member such as a function.
  it.each(['1Year', '5min', '', 'toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'throws a RangeError for the unknown timeframe %j',
    (timeframe) => {
      expect(() => describeTimeframe(timeframe as BarTimeframe)).toThrow(RangeError);
    },
  );
});
