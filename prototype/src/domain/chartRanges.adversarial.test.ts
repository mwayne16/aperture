import { describe, expect, it } from 'vitest';
import { describeTimeframe, resolveRange } from './chartRanges';
import { type BarTimeframe, type ChartRange, CHART_RANGES } from './types';

/** Adversarial tests derived from the chartRanges doc-comment table, not from the implementation. */

const DAY = 86_400_000;
const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const at = (s: string) => new Date(s);

const TABLE: Record<ChartRange, BarTimeframe> = {
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

describe('resolveRange (adversarial)', () => {
  it.each(CHART_RANGES.map((r) => [r]))('%s: timeframe, range echo, end copy, lastSessionOnly', (range) => {
    const now = at('2025-07-15T13:45:30.123Z');
    const spec = resolveRange(range, now);
    expect(spec.range).toBe(range);
    expect(spec.timeframe).toBe(TABLE[range]);
    expect(spec.end).not.toBe(now);
    expect(spec.end.getTime()).toBe(now.getTime());
    expect(spec.lastSessionOnly).toBe(range === '1D');
    if (range === 'ALL') expect(spec.start).toBeNull();
    else {
      expect(spec.start).toBeInstanceOf(Date);
      expect(spec.start!.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(spec.start).not.toBe(now);
    }
  });

  it('does not mutate now, and mutating the result does not leak into now or later calls', () => {
    const now = at('2024-03-31T10:00:00Z');
    const before = now.getTime();
    const a = resolveRange('1M', now);
    a.end.setUTCFullYear(1999);
    a.start!.setUTCFullYear(1999);
    expect(now.getTime()).toBe(before);
    const b = resolveRange('1M', now);
    expect(iso(b.start)).toBe('2024-02-29T10:00:00.000Z');
    expect(b.end.getTime()).toBe(before);
  });

  it('1D and 1W are exact fixed durations', () => {
    const now = at('2024-03-10T12:00:00Z'); // US DST change day; UTC has no DST
    expect(now.getTime() - resolveRange('1D', now).start!.getTime()).toBe(5 * DAY);
    expect(now.getTime() - resolveRange('1W', now).start!.getTime()).toBe(7 * DAY);
  });

  it.each<[ChartRange, string, string]>([
    // Month-end clamping in every direction.
    ['1M', '2024-03-31T00:00:00.000Z', '2024-02-29T00:00:00.000Z'],
    ['1M', '2025-03-31T00:00:00.000Z', '2025-02-28T00:00:00.000Z'],
    ['1M', '2025-05-31T08:30:00.000Z', '2025-04-30T08:30:00.000Z'],
    ['1M', '2025-03-30T00:00:00.000Z', '2025-02-28T00:00:00.000Z'],
    ['1M', '2025-03-28T00:00:00.000Z', '2025-02-28T00:00:00.000Z'],
    ['1M', '2025-01-15T23:59:59.999Z', '2024-12-15T23:59:59.999Z'],
    ['1M', '2025-01-31T00:00:00.000Z', '2024-12-31T00:00:00.000Z'],
    ['3M', '2024-05-31T00:00:00.000Z', '2024-02-29T00:00:00.000Z'],
    ['3M', '2025-01-31T06:00:00.000Z', '2024-10-31T06:00:00.000Z'],
    ['3M', '2025-02-28T00:00:00.000Z', '2024-11-28T00:00:00.000Z'],
    ['6M', '2025-08-31T00:00:00.000Z', '2025-02-28T00:00:00.000Z'],
    ['6M', '2024-08-31T00:00:00.000Z', '2024-02-29T00:00:00.000Z'],
    ['6M', '2025-03-31T00:00:00.000Z', '2024-09-30T00:00:00.000Z'],
    ['6M', '2025-06-15T00:00:00.000Z', '2024-12-15T00:00:00.000Z'],
    // Years.
    ['1Y', '2024-02-29T12:00:00.000Z', '2023-02-28T12:00:00.000Z'],
    ['1Y', '2025-02-28T12:00:00.000Z', '2024-02-28T12:00:00.000Z'], // never clamps *up* to the 29th
    ['1Y', '2025-12-31T23:59:59.999Z', '2024-12-31T23:59:59.999Z'],
    ['5Y', '2024-02-29T00:00:00.000Z', '2019-02-28T00:00:00.000Z'],
    ['5Y', '2025-02-28T00:00:00.000Z', '2020-02-28T00:00:00.000Z'],
    ['10Y', '2024-02-29T00:00:00.000Z', '2014-02-28T00:00:00.000Z'],
    ['10Y', '2026-10-23T14:05:09.000Z', '2016-10-23T14:05:09.000Z'],
    // YTD.
    ['YTD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'],
    ['YTD', '2024-12-31T23:59:59.999Z', '2024-01-01T00:00:00.000Z'],
    // A New York evening on Dec 31 is already Jan 1 in UTC: YTD follows the UTC year.
    ['YTD', '2024-12-31T23:30:00.000-05:00', '2025-01-01T00:00:00.000Z'],
    ['YTD', '2025-01-01T00:30:00.000+05:00', '2024-01-01T00:00:00.000Z'],
  ])('%s from %s starts at %s', (range, nowIso, expectedStart) => {
    expect(iso(resolveRange(range, at(nowIso)).start)).toBe(expectedStart);
  });

  it('throws RangeError for an Invalid Date now', () => {
    for (const r of CHART_RANGES) {
      expect(() => resolveRange(r, new Date(Number.NaN))).toThrow(RangeError);
    }
  });

  it('throws RangeError for an unknown range from untyped callers', () => {
    for (const bad of ['1d', '2Y', '', 'all', 'MAX']) {
      expect(() => resolveRange(bad as ChartRange, new Date())).toThrow(RangeError);
    }
  });
});

describe('describeTimeframe (adversarial)', () => {
  const ALL: BarTimeframe[] = ['5Min', '15Min', '30Min', '1Hour', '1Day', '1Week', '1Month'];
  it('gives a distinct non-empty short label for every timeframe', () => {
    const labels = ALL.map(describeTimeframe);
    for (const l of labels) {
      expect(typeof l).toBe('string');
      expect(l.trim().length).toBeGreaterThan(0);
      expect(l.length).toBeLessThan(30);
    }
    expect(new Set(labels).size).toBe(ALL.length);
    expect(describeTimeframe('5Min')).toBe('5-minute bars');
  });
});
