import { describe, expect, it } from 'vitest';
import {
  changeDirection,
  EMPTY_VALUE,
  formatAge,
  formatChange,
  formatClock,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatVolume,
} from './format';

/** Adversarial tests derived from the format.ts doc-comment spec and the task brief. */

const MINUS = '−';
const BAD = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe('empty value contract (adversarial)', () => {
  it('EMPTY_VALUE is a single em dash', () => {
    expect(EMPTY_VALUE).toBe('—');
  });

  it.each(BAD.map((v) => [v]))('every numeric formatter returns the em dash for %s', (v) => {
    expect(formatPrice(v)).toBe(EMPTY_VALUE);
    expect(formatChange(v)).toBe(EMPTY_VALUE);
    expect(formatPercent(v)).toBe(EMPTY_VALUE);
    expect(formatVolume(v)).toBe(EMPTY_VALUE);
    expect(formatClock(v)).toBe(EMPTY_VALUE);
    expect(formatClock(v, 'UTC')).toBe(EMPTY_VALUE);
    expect(formatAge(v, 1_000_000)).toBe(EMPTY_VALUE);
    expect(changeDirection(v)).toBe(0);
  });

  it('formatAge treats a non-finite now as unformattable too', () => {
    expect(formatAge(1000, Number.NaN)).toBe(EMPTY_VALUE);
    expect(formatAge(1000, Number.POSITIVE_INFINITY)).toBe(EMPTY_VALUE);
  });

  it.each([null, undefined, '', '   ', 'not a date', '2024-13-45T99:99:99Z'])(
    'formatDateTime(%j) returns the em dash',
    (v) => {
      expect(formatDateTime(v, 'UTC')).toBe(EMPTY_VALUE);
    },
  );

  it('no formatter ever leaks "NaN", "null", "undefined" or "Infinity"', () => {
    const inputs = [0, -0, 1e-300, -1e-300, 1e21, -1e21, 1e300, Number.MAX_VALUE, Number.MIN_VALUE];
    for (const v of inputs) {
      for (const out of [formatPrice(v), formatChange(v), formatPercent(v), formatVolume(v)]) {
        expect(out).not.toMatch(/NaN|null|undefined|Infinity|e\+|e-/);
      }
    }
  });
});

describe('formatPrice (adversarial)', () => {
  it.each<[number, string]>([
    [0, '0.00'],
    [-0, '0.00'],
    [1, '1.00'],
    [1.005, '1.01'],
    [2.675, '2.68'],
    [1234.5, '1,234.50'],
    [1234567.891, '1,234,567.89'],
    [999.995, '1,000.00'],
    [0.5, '0.5000'],
    [0.1234, '0.1234'],
    [0.12345, '0.1235'],
    [0.01, '0.0100'],
    [0.9999, '0.9999'],
  ])('formatPrice(%s) = %j', (v, expected) => {
    expect(formatPrice(v)).toBe(expected);
  });

  it('0.99995 rounds up to one and is not shown as "0.9999" or "0.99995"', () => {
    expect(['1.00', '1.0000']).toContain(formatPrice(0.99995));
  });

  it('never uses an ASCII hyphen-minus for negatives and never signs a zero display', () => {
    for (const v of [-1, -0.5, -1234.5, -0, -1e-9]) {
      expect(formatPrice(v)).not.toContain('-');
    }
    expect(formatPrice(-1e-9)).not.toContain(MINUS);
  });
});

describe('formatChange (adversarial)', () => {
  it.each<[number, string]>([
    [1.23, '+1.23'],
    [-1.23, `${MINUS}1.23`],
    [0, '0.00'],
    [-0, '0.00'],
    [0.5, '+0.5000'],
    [-0.001, `${MINUS}0.0010`],
    [1234.5, '+1,234.50'],
    [-1234.567, `${MINUS}1,234.57`],
    [1.005, '+1.01'],
  ])('formatChange(%s) = %j', (v, expected) => {
    expect(formatChange(v)).toBe(expected);
  });

  it('a value that rounds to zero carries no sign', () => {
    for (const v of [1e-9, -1e-9, 0.000001, -0.000001]) {
      const out = formatChange(v);
      expect(out).not.toMatch(/^[+−-]/);
      expect(out).toMatch(/^0\.0+$/);
    }
  });
});

describe('formatPercent (adversarial)', () => {
  it.each<[number, string]>([
    [1.23, '+1.23%'],
    [-0.4, `${MINUS}0.40%`],
    [0, '0.00%'],
    [-0, '0.00%'],
    [-0.004, '0.00%'],
    [0.004, '0.00%'],
    [0.005, '+0.01%'],
    [-0.005, `${MINUS}0.01%`],
    [100, '+100.00%'],
    [0.5, '+0.50%'], // percent never switches to 4 decimals
  ])('formatPercent(%s) = %j', (v, expected) => {
    expect(formatPercent(v)).toBe(expected);
  });
});

describe('formatVolume (adversarial)', () => {
  it.each<[number, string]>([
    [0, '0'],
    [-0, '0'],
    [950, '950'],
    [999, '999'],
    [999.4, '999'],
    [999.5, '1.00K'],
    [1000, '1.00K'],
    [1234, '1.23K'],
    [12_300, '12.3K'],
    [123_456, '123K'],
    [999_499, '999K'],
    [999_500, '1.00M'],
    [999_950, '1.00M'],
    [4_560_000, '4.56M'],
    [999_999_999, '1.00B'],
    [1e9, '1.00B'],
    [7_800_000_000, '7.80B'],
  ])('formatVolume(%s) = %j', (v, expected) => {
    expect(formatVolume(v)).toBe(expected);
  });

  it('never shows a 4-digit mantissa like "1000K" or "1,000M" below trillions', () => {
    const rand = (() => {
      let s = 12345;
      return () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    })();
    for (let i = 0; i < 2000; i++) {
      const v = Math.floor(10 ** (3 + rand() * 9));
      const out = formatVolume(v);
      expect(out, String(v)).toMatch(/^\d{1,3}(\.\d{1,2})?[KMB]$|^1\.00T$/);
      // three significant digits from 1,000 up
      expect(out.replace(/[^\d]/g, '').length, `${v} -> ${out}`).toBe(3);
    }
  });
});

describe('formatClock (adversarial)', () => {
  it.each<[string, string]>([
    ['2024-03-10T06:59:59Z', '01:59:59'], // last second of EST
    ['2024-03-10T07:00:00Z', '03:00:00'], // first second of EDT (02:xx skipped)
    ['2024-11-03T05:30:00Z', '01:30:00'], // first 01:30 (EDT)
    ['2024-11-03T06:30:00Z', '01:30:00'], // second 01:30 (EST)
    ['2024-01-01T05:00:00Z', '00:00:00'], // midnight is 00, never 24
    ['2024-07-04T03:59:59.999Z', '23:59:59'],
  ])('default zone is America/New_York: %s -> %s', (instant, expected) => {
    expect(formatClock(Date.parse(instant))).toBe(expected);
    expect(formatClock(Date.parse(instant), 'America/New_York')).toBe(expected);
  });

  it('honours an explicit zone and an explicit undefined zone falls back to New York', () => {
    const t = Date.parse('2024-07-04T16:05:09Z');
    expect(formatClock(t, 'UTC')).toBe('16:05:09');
    expect(formatClock(t, 'Asia/Tokyo')).toBe('01:05:09');
    expect(formatClock(t, undefined)).toBe('12:05:09');
  });

  it('formats epoch 0 (a falsy but valid timestamp)', () => {
    expect(formatClock(0, 'UTC')).toBe('00:00:00');
  });

  it('returns the em dash for finite values outside the Date range', () => {
    expect(formatClock(8.64e15 + 1)).toBe(EMPTY_VALUE);
    expect(formatClock(-8.64e15 - 1)).toBe(EMPTY_VALUE);
  });
});

describe('formatAge (adversarial)', () => {
  const now = 1_700_000_000_000;
  it.each<[number, string]>([
    [0, 'just now'],
    [1999, 'just now'],
    [2000, '2s ago'],
    [59_999, '59s ago'],
    [60_000, '1m ago'],
    [3_599_999, '59m ago'],
    [3_600_000, '1h ago'],
    [86_399_999, '23h ago'],
    [86_400_000, '1d ago'],
    [4 * 86_400_000 + 1, '4d ago'],
    [-5000, 'just now'],
  ])('age %sms -> %j', (age, expected) => {
    expect(formatAge(now - age, now)).toBe(expected);
  });

  it('epoch 0 is a valid timestamp, not missing', () => {
    expect(formatAge(0, 86_400_000 * 3)).toBe('3d ago');
  });
});

describe('formatDateTime (adversarial)', () => {
  it.each<[string, string | undefined, string]>([
    ['2026-10-23T18:05:09Z', 'America/New_York', 'Oct 23, 14:05:09'],
    ['2026-10-23T18:05:09Z', 'UTC', 'Oct 23, 18:05:09'],
    ['2026-10-23T02:00:00Z', 'America/New_York', 'Oct 22, 22:00:00'], // crosses the date line backwards
    ['2024-01-05T00:00:00Z', 'UTC', 'Jan 5, 00:00:00'],
    ['2024-02-29T23:59:59.999Z', 'UTC', 'Feb 29, 23:59:59'],
    ['2026-10-23T14:05:09-04:00', 'UTC', 'Oct 23, 18:05:09'],
  ])('%s in %s -> %j', (input, zone, expected) => {
    expect(formatDateTime(input, zone)).toBe(expected);
  });
});

describe('changeDirection (adversarial)', () => {
  it.each<[number | null | undefined, -1 | 0 | 1]>([
    [5, 1],
    [Number.MIN_VALUE, 1],
    [-5, -1],
    [-Number.MIN_VALUE, -1],
    [0, 0],
    [-0, 0],
  ])('changeDirection(%s) = %s', (v, expected) => {
    expect(Object.is(changeDirection(v), expected)).toBe(true);
  });
});
