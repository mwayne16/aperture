import { describe, expect, it } from 'vitest';
import { resolveRange } from './chartRanges';
import { type ChartRange, CHART_RANGES } from './types';

/**
 * Round-4 adversarial tests for resolveRange across the whole representable Date range.
 * The contract: calendar subtraction in UTC with end-of-month clamping (proleptic Gregorian, so year 0
 * is a leap year), and a RangeError only when the window start is before the earliest Date.
 */

const EARLIEST_MS = -8.64e15;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS_BACK: Partial<Record<ChartRange, number>> = {
  '1M': 1,
  '3M': 3,
  '6M': 6,
  '1Y': 12,
  '5Y': 60,
  '10Y': 120,
};

const DAYS_BACK: Partial<Record<ChartRange, number>> = { '1D': 5, '1W': 7 };

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]!;
}

/** Epoch ms for a UTC calendar instant, or NaN outside the Date range. Built without month arithmetic. */
function utcMs(y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(y, m, d);
  date.setUTCHours(h, mi, s, ms);
  return date.getTime();
}

/** Expected window start in epoch ms, NaN when it is not representable, or null for ALL. */
function referenceStart(range: ChartRange, now: Date): number | null {
  if (range === 'ALL') return null;
  const days = DAYS_BACK[range];
  if (days !== undefined) {
    const ms = now.getTime() - days * DAY_MS;
    return ms < EARLIEST_MS ? Number.NaN : ms;
  }
  const y0 = now.getUTCFullYear();
  if (range === 'YTD') return utcMs(y0, 0, 1);
  const months = MONTHS_BACK[range]!;
  const total = y0 * 12 + now.getUTCMonth() - months;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const d = Math.min(now.getUTCDate(), daysInMonth(y, m));
  return utcMs(y, m, d, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
}

function expectMatchesReference(range: ChartRange, now: Date): void {
  const expected = referenceStart(range, now);
  const label = `${range} from ${now.toISOString()}`;
  if (expected !== null && Number.isNaN(expected)) {
    expect(() => resolveRange(range, now), label).toThrow(RangeError);
    return;
  }
  const spec = resolveRange(range, now);
  if (expected === null) {
    expect(spec.start, label).toBeNull();
  } else {
    expect(spec.start?.toISOString(), label).toBe(new Date(expected).toISOString());
  }
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const at = (iso: string): Date => new Date(iso);

describe('resolveRange clamps to the real end of February in year 0 (a leap year)', () => {
  it.each<[ChartRange, string, string]>([
    ['1M', '0000-03-31T12:00:00.000Z', '0000-02-29T12:00:00.000Z'],
    ['1M', '0000-03-29T08:15:00.000Z', '0000-02-29T08:15:00.000Z'],
    ['3M', '0000-05-31T00:00:00.000Z', '0000-02-29T00:00:00.000Z'],
    ['6M', '0000-08-30T23:59:59.999Z', '0000-02-29T23:59:59.999Z'],
  ])('%s from %s starts at %s', (range, now, expected) => {
    expect(resolveRange(range, at(now)).start?.toISOString()).toBe(expected);
  });

  it('agrees with the year-4 behaviour, which is also a leap year', () => {
    const start = resolveRange('1M', at('0004-03-31T12:00:00.000Z')).start;
    expect(start?.toISOString()).toBe('0004-02-29T12:00:00.000Z');
  });
});

describe('resolveRange near the earliest representable Date', () => {
  it('earliest Date really is -271821-04-20T00:00:00.000Z', () => {
    expect(new Date(EARLIEST_MS).toISOString()).toBe('-271821-04-20T00:00:00.000Z');
  });

  it.each<[ChartRange, string, string]>([
    // The window start is on or after the earliest Date, so it must be returned, not rejected.
    ['1M', '-271821-05-25T00:00:00.000Z', '-271821-04-25T00:00:00.000Z'],
    ['1M', '-271821-05-20T00:00:00.000Z', '-271821-04-20T00:00:00.000Z'],
    ['1M', '-271821-05-31T06:00:00.000Z', '-271821-04-30T06:00:00.000Z'],
    ['3M', '-271821-07-21T00:00:00.000Z', '-271821-04-21T00:00:00.000Z'],
    ['6M', '-271821-10-31T00:00:00.000Z', '-271821-04-30T00:00:00.000Z'],
    ['1Y', '-271820-04-25T00:00:00.000Z', '-271821-04-25T00:00:00.000Z'],
    ['5Y', '-271816-04-20T00:00:00.000Z', '-271821-04-20T00:00:00.000Z'],
  ])('%s from %s starts at %s', (range, now, expected) => {
    expect(resolveRange(range, at(now)).start?.toISOString()).toBe(expected);
  });

  it.each<[ChartRange, string]>([
    ['1M', '-271821-05-19T23:59:59.999Z'],
    ['1Y', '-271820-04-19T23:59:59.999Z'],
    ['YTD', '-271821-12-31T00:00:00.000Z'],
    ['1D', '-271821-04-24T23:59:59.999Z'],
  ])('%s from %s throws because the start is before the earliest Date', (range, now) => {
    expect(() => resolveRange(range, at(now))).toThrow(RangeError);
  });
});

describe('resolveRange vs reference model across the full Date range', () => {
  it('matches for 4000 seeded instants anywhere in the representable range', () => {
    const rand = lcg(4242);
    const span = 2 * 8.64e15;
    for (let i = 0; i < 4000; i++) {
      const now = new Date(EARLIEST_MS + Math.floor(rand() * span));
      for (const range of CHART_RANGES) expectMatchesReference(range, now);
    }
  });

  it('matches for 4000 seeded instants in years -400..400, which include year 0', () => {
    const rand = lcg(77);
    const lo = utcMs(-400, 0, 1);
    const hi = utcMs(400, 11, 31, 23, 59, 59, 999);
    for (let i = 0; i < 4000; i++) {
      const now = new Date(lo + Math.floor(rand() * (hi - lo)));
      for (const range of CHART_RANGES) expectMatchesReference(range, now);
    }
  });

  it('matches for 4000 seeded instants in the first 11 years of the Date range', () => {
    const rand = lcg(9001);
    const span = 11 * 366 * DAY_MS;
    for (let i = 0; i < 4000; i++) {
      const now = new Date(EARLIEST_MS + Math.floor(rand() * span));
      for (const range of CHART_RANGES) expectMatchesReference(range, now);
    }
  });
});
