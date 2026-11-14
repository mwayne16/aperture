import { describe, expect, it } from 'vitest';
import { describeTimeframe, resolveRange } from './chartRanges';
import { CHART_RANGES } from './types';

/**
 * Round-5 adversarial tests: results never share Date objects with `now` or with each other, so a
 * caller mutating one window can't move another. Also checks the spec table end to end at one instant.
 */

describe('resolveRange object isolation', () => {
  it('mutating a returned start or end does not change now or a later result', () => {
    const now = new Date('2025-03-31T15:45:30.250Z');
    const nowMs = now.getTime();
    for (const range of CHART_RANGES) {
      const first = resolveRange(range, now);
      const firstStart = first.start?.getTime() ?? null;
      first.end.setTime(0);
      first.start?.setTime(0);
      expect(now.getTime(), range).toBe(nowMs);
      const second = resolveRange(range, now);
      expect(second.end.getTime(), range).toBe(nowMs);
      expect(second.start?.getTime() ?? null, range).toBe(firstStart);
    }
  });

  it('start is never the same object as end or now', () => {
    const now = new Date('2024-01-01T00:00:00.000Z'); // YTD start equals now in value
    for (const range of CHART_RANGES) {
      const spec = resolveRange(range, now);
      expect(spec.end).not.toBe(now);
      if (spec.start) {
        expect(spec.start).not.toBe(now);
        expect(spec.start).not.toBe(spec.end);
      }
    }
  });

  it('matches the documented table at one instant', () => {
    const now = new Date('2025-03-31T15:45:30.250Z');
    const expected: Record<string, [string, string | null]> = {
      '1D': ['5Min', '2025-03-26T15:45:30.250Z'],
      '1W': ['30Min', '2025-03-24T15:45:30.250Z'],
      '1M': ['1Hour', '2025-02-28T15:45:30.250Z'],
      '3M': ['1Day', '2024-12-31T15:45:30.250Z'],
      '6M': ['1Day', '2024-09-30T15:45:30.250Z'],
      YTD: ['1Day', '2025-01-01T00:00:00.000Z'],
      '1Y': ['1Day', '2024-03-31T15:45:30.250Z'],
      '5Y': ['1Week', '2020-03-31T15:45:30.250Z'],
      '10Y': ['1Month', '2015-03-31T15:45:30.250Z'],
      ALL: ['1Month', null],
    };
    for (const range of CHART_RANGES) {
      const spec = resolveRange(range, now);
      const [timeframe, start] = expected[range]!;
      expect(spec.range).toBe(range);
      expect(spec.timeframe, range).toBe(timeframe);
      expect(spec.start?.toISOString() ?? null, range).toBe(start);
      expect(spec.lastSessionOnly, range).toBe(range === '1D');
      expect(describeTimeframe(spec.timeframe)).toMatch(/bars$/);
    }
  });

  it('6M from Aug 31 clamps to Feb 29 in a leap year and Feb 28 otherwise', () => {
    expect(resolveRange('6M', new Date('2024-08-31T12:00:00Z')).start?.toISOString()).toBe(
      '2024-02-29T12:00:00.000Z',
    );
    expect(resolveRange('6M', new Date('2025-08-31T12:00:00Z')).start?.toISOString()).toBe(
      '2025-02-28T12:00:00.000Z',
    );
  });

  it('uses the UTC calendar even when the local date is different', () => {
    // 2025-03-01T02:00Z is still Feb 28 in the Americas; 1M must use the UTC date (Mar 1 -> Feb 1).
    expect(resolveRange('1M', new Date('2025-03-01T02:00:00Z')).start?.toISOString()).toBe(
      '2025-02-01T02:00:00.000Z',
    );
    // YTD on Jan 1 01:00 UTC is the new UTC year even where it is still Dec 31 locally.
    expect(resolveRange('YTD', new Date('2026-01-01T01:00:00Z')).start?.toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });
});
