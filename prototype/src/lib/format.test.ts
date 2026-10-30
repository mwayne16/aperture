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

const MINUS = '−';
const BAD_NUMBERS = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
const numberFormatters = { formatPrice, formatChange, formatPercent, formatVolume };

describe('empty values', () => {
  it('EMPTY_VALUE is an em dash', () => {
    expect(EMPTY_VALUE).toBe('—');
  });

  it.each(Object.entries(numberFormatters))(
    '%s returns the em dash for null/undefined/NaN/±Infinity',
    (_, fn) => {
      for (const value of BAD_NUMBERS) expect(fn(value)).toBe(EMPTY_VALUE);
    },
  );

  it('time formatters return the em dash for missing or non-finite input', () => {
    for (const value of BAD_NUMBERS) {
      expect(formatClock(value)).toBe(EMPTY_VALUE);
      expect(formatAge(value, 1_000_000)).toBe(EMPTY_VALUE);
    }
    expect(formatAge(1_000_000, Number.NaN)).toBe(EMPTY_VALUE);
    expect(formatAge(1_000_000, Number.POSITIVE_INFINITY)).toBe(EMPTY_VALUE);
  });

  it('formatClock returns the em dash for finite values outside the Date range', () => {
    expect(formatClock(8.64e15 + 1)).toBe(EMPTY_VALUE);
    expect(formatClock(-1e20)).toBe(EMPTY_VALUE);
  });

  it.each([null, undefined, '', '   ', 'not a date', '2026-13-45T00:00:00Z'])(
    'formatDateTime(%j) returns the em dash',
    (value) => {
      expect(formatDateTime(value, 'UTC')).toBe(EMPTY_VALUE);
    },
  );
});

describe('formatPrice', () => {
  it.each([
    [1234.5, '1,234.50'],
    [1234567.891, '1,234,567.89'],
    [187.25, '187.25'],
    [1, '1.00'],
    [10, '10.00'],
    [999.995, '1,000.00'],
    // Intl rounds the shortest decimal form half away from zero: 1.005 -> 1.01 (toFixed would say 1.00).
    [1.005, '1.01'],
    [2.675, '2.68'],
    [1.004999, '1.00'],
    // Below 1: 4 decimals.
    [0.5, '0.5000'],
    [0.12345, '0.1235'],
    [0.9999, '0.9999'],
    [0.99994, '0.9999'],
    [0.00005, '0.0001'],
    // Rounds up to 1 at 4 decimals: shown with 2 decimals like any price >= 1.
    [0.99995, '1.00'],
    [0.999999, '1.00'],
    // Zero, and values that round to zero, use the 2-decimal zero.
    [0, '0.00'],
    [-0, '0.00'],
    [0.00001, '0.00'],
    [-0.00004, '0.00'],
    // Negative prices (rare, but possible for some instruments) use U+2212.
    [-1234.5, `${MINUS}1,234.50`],
    [-0.5, `${MINUS}0.5000`],
  ])('%d -> %s', (value, expected) => {
    expect(formatPrice(value)).toBe(expected);
  });

  it('never emits a sign for positive values or a hyphen-minus for negatives', () => {
    expect(formatPrice(5)).not.toMatch(/^\+/);
    expect(formatPrice(-5)).not.toContain('-');
  });
});

describe('formatChange', () => {
  it.each([
    [1.23, '+1.23'],
    [-1.23, `${MINUS}1.23`],
    [0, '0.00'],
    [-0, '0.00'],
    [1234.5, '+1,234.50'],
    [-1234.5, `${MINUS}1,234.50`],
    // Same decimals as formatPrice.
    [0.5, '+0.5000'],
    [-0.004, `${MINUS}0.0040`],
    [0.99995, '+1.00'],
    [-0.99995, `${MINUS}1.00`],
    [1.005, '+1.01'],
    // Rounds to zero at display precision: no sign.
    [0.00001, '0.00'],
    [-0.00001, '0.00'],
    [-0.00004999, '0.00'],
    [-0.00005, `${MINUS}0.0001`],
  ])('%d -> %s', (value, expected) => {
    expect(formatChange(value)).toBe(expected);
  });

  it('uses U+2212 for negatives, never a hyphen-minus', () => {
    const out = formatChange(-2.5);
    expect(out.codePointAt(0)).toBe(0x2212);
    expect(out).not.toContain('-');
  });

  it('matches formatPrice digits for the same magnitude', () => {
    for (const value of [0.1234, 0.5, 0.99995, 1, 12.345, 98765.4321]) {
      expect(formatChange(value)).toBe(`+${formatPrice(value)}`);
      expect(formatChange(-value)).toBe(`${MINUS}${formatPrice(value)}`);
    }
  });
});

describe('formatPercent', () => {
  it.each([
    [1.23, '+1.23%'],
    [-0.4, `${MINUS}0.40%`],
    [0, '0.00%'],
    [-0, '0.00%'],
    [0.5, '+0.50%'], // percent always uses 2 decimals, even below 1
    [100, '+100.00%'],
    [1234.5, '+1,234.50%'],
    [1.005, '+1.01%'],
    [0.005, '+0.01%'],
    [0.99995, '+1.00%'],
    // Rounds to zero: no sign.
    [0.004, '0.00%'],
    [-0.004, '0.00%'],
    [-0.005, `${MINUS}0.01%`],
  ])('%d -> %s', (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });

  it('treats the input as already in percent (1.23 means 1.23%, not 123%)', () => {
    expect(formatPercent(1.23)).not.toContain('123');
  });
});

describe('formatVolume', () => {
  it.each([
    [0, '0'],
    [-0, '0'],
    [1, '1'],
    [950, '950'],
    [999, '999'],
    [999.4, '999'],
    [12.6, '13'], // fractional shares round to whole numbers below 1K
    // K boundary: rounding up to 1,000 promotes to K.
    [999.5, '1.00K'],
    [1000, '1.00K'],
    [1234, '1.23K'],
    [1235, '1.24K'],
    [12_300, '12.3K'],
    [99_949, '99.9K'],
    [99_950, '100K'],
    [123_456, '123K'],
    [999_499, '999K'],
    // M boundary: never "1000K".
    [999_500, '1.00M'],
    [999_950, '1.00M'],
    [1_000_000, '1.00M'],
    [4_560_000, '4.56M'],
    [45_600_000, '45.6M'],
    [999_999_999, '1.00B'],
    // B and beyond.
    [1e9, '1.00B'],
    [7_800_000_000, '7.80B'],
    [999_500_000_000, '1.00T'],
    [1e12, '1.00T'],
    [1.5e15, '1,500T'],
  ])('%d -> %s', (value, expected) => {
    expect(formatVolume(value)).toBe(expected);
  });

  it('never shows a 4-digit mantissa before a unit', () => {
    for (let exp = 3; exp <= 12; exp++) {
      for (const m of [0.9994, 0.9995, 0.99995, 0.999999]) {
        expect(formatVolume(m * 10 ** exp)).not.toMatch(/^\d{4}[KMB]$|^1,000[KMB]$/);
      }
    }
  });

  it('formats an (invalid) negative volume with U+2212 rather than hiding it', () => {
    expect(formatVolume(-12_300)).toBe(`${MINUS}12.3K`);
    expect(formatVolume(-0.4)).toBe('0');
  });
});

describe('formatClock', () => {
  const NY = 'America/New_York';

  it('defaults to America/New_York', () => {
    const ms = Date.UTC(2026, 9, 23, 18, 5, 9);
    expect(formatClock(ms)).toBe('14:05:09');
    expect(formatClock(ms, NY)).toBe('14:05:09');
  });

  it('crosses the spring-forward boundary (2026-03-08, 02:00 EST -> 03:00 EDT)', () => {
    expect(formatClock(Date.UTC(2026, 2, 8, 6, 59, 59), NY)).toBe('01:59:59');
    expect(formatClock(Date.UTC(2026, 2, 8, 7, 0, 0), NY)).toBe('03:00:00');
  });

  it('crosses the fall-back boundary (2026-11-01, 02:00 EDT -> 01:00 EST)', () => {
    expect(formatClock(Date.UTC(2026, 10, 1, 5, 59, 59), NY)).toBe('01:59:59');
    expect(formatClock(Date.UTC(2026, 10, 1, 6, 0, 0), NY)).toBe('01:00:00');
  });

  it('uses 24-hour time with midnight as 00, never 24', () => {
    expect(formatClock(Date.UTC(2026, 0, 2, 5, 0, 0), NY)).toBe('00:00:00');
    expect(formatClock(Date.UTC(2026, 0, 2, 4, 59, 59), NY)).toBe('23:59:59');
    expect(formatClock(Date.UTC(2026, 0, 2, 0, 0, 0), 'UTC')).toBe('00:00:00');
  });

  it('honours other IANA zones, including half-hour offsets', () => {
    const ms = Date.UTC(2026, 9, 23, 12, 0, 0);
    expect(formatClock(ms, 'UTC')).toBe('12:00:00');
    expect(formatClock(ms, 'Asia/Kolkata')).toBe('17:30:00');
    expect(formatClock(ms, 'Europe/London')).toBe('13:00:00');
  });

  it('drops milliseconds without rounding up', () => {
    expect(formatClock(Date.UTC(2026, 9, 23, 12, 0, 0, 999), 'UTC')).toBe('12:00:00');
  });

  it('handles epoch 0 and negative epochs', () => {
    expect(formatClock(0, 'UTC')).toBe('00:00:00');
    expect(formatClock(-1000, 'UTC')).toBe('23:59:59');
  });

  it('throws for an unknown time zone (a programming error, not missing data)', () => {
    expect(() => formatClock(0, 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});

describe('formatAge', () => {
  const NOW = 1_800_000_000_000;
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  const D = 24 * H;

  it.each([
    [0, 'just now'],
    [1999, 'just now'],
    [2 * S, '2s ago'],
    [5 * S, '5s ago'],
    [5 * S + 999, '5s ago'],
    [M - 1, '59s ago'],
    [M, '1m ago'],
    [3 * M, '3m ago'],
    [H - 1, '59m ago'],
    [H, '1h ago'],
    [2 * H + 59 * M, '2h ago'],
    [D - 1, '23h ago'],
    [D, '1d ago'],
    [4 * D, '4d ago'],
    [400 * D, '400d ago'],
  ])('%d ms old -> %s', (age, expected) => {
    expect(formatAge(NOW - age, NOW)).toBe(expected);
  });

  it('treats timestamps slightly or far in the future (clock skew) as "just now"', () => {
    expect(formatAge(NOW + 1, NOW)).toBe('just now');
    expect(formatAge(NOW + 10 * M, NOW)).toBe('just now');
  });

  it('returns "—" when finite inputs are too far apart for a finite age', () => {
    expect(formatAge(-Number.MAX_VALUE, Number.MAX_VALUE)).toBe(EMPTY_VALUE);
    expect(formatAge(Number.MAX_VALUE, -Number.MAX_VALUE)).toBe('just now');
  });
});

describe('formatDateTime', () => {
  it('formats in an explicit zone as "Mon D, HH:mm:ss"', () => {
    expect(formatDateTime('2026-10-23T14:05:09Z', 'UTC')).toBe('Oct 23, 14:05:09');
    expect(formatDateTime('2026-10-23T14:05:09Z', 'America/New_York')).toBe('Oct 23, 10:05:09');
    expect(formatDateTime('2026-10-23T14:05:09Z', 'Asia/Tokyo')).toBe('Oct 23, 23:05:09');
  });

  it('rolls the date with the zone', () => {
    expect(formatDateTime('2026-10-24T02:00:00Z', 'America/New_York')).toBe('Oct 23, 22:00:00');
    expect(formatDateTime('2026-12-31T20:00:00Z', 'Asia/Tokyo')).toBe('Jan 1, 05:00:00');
  });

  it('respects offsets in the ISO string', () => {
    expect(formatDateTime('2026-10-23T14:05:09-04:00', 'UTC')).toBe('Oct 23, 18:05:09');
    expect(formatDateTime('2026-10-23T14:05:09.987+00:00', 'UTC')).toBe('Oct 23, 14:05:09');
  });

  it('uses a numeric day without padding and 24-hour time', () => {
    expect(formatDateTime('2026-01-05T00:00:01Z', 'UTC')).toBe('Jan 5, 00:00:01');
    expect(formatDateTime('2026-07-04T23:59:59Z', 'UTC')).toBe('Jul 4, 23:59:59');
  });

  it('defaults to the local time zone', () => {
    const iso = '2026-03-08T07:30:00Z';
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(formatDateTime(iso)).toBe(formatDateTime(iso, local));
  });

  it('throws for an unknown time zone', () => {
    expect(() => formatDateTime('2026-10-23T14:05:09Z', 'Nowhere/Land')).toThrow(RangeError);
  });

  it("treats timeZone '' as an invalid zone even after the local-zone formatter is cached", () => {
    formatDateTime('2026-10-23T14:05:09Z');
    expect(() => formatDateTime('2026-10-23T14:05:09Z', '')).toThrow(RangeError);
    formatClock(0);
    expect(() => formatClock(0, '')).toThrow(RangeError);
  });

  it('accepts every ISO-8601 date-time shape toISOString and RFC 3339 produce', () => {
    expect(formatDateTime(new Date(Date.UTC(2026, 9, 23, 14, 5, 9, 987)).toISOString(), 'UTC')).toBe(
      'Oct 23, 14:05:09',
    );
    expect(formatDateTime('2026-10-23T14:05Z', 'UTC')).toBe('Oct 23, 14:05:00');
    expect(formatDateTime('2026-10-23T14:05:09.1Z', 'UTC')).toBe('Oct 23, 14:05:09');
    expect(formatDateTime('2026-10-23T14:05:09.999999999Z', 'UTC')).toBe('Oct 23, 14:05:09');
    expect(formatDateTime('2026-10-23t14:05:09z', 'UTC')).toBe('Oct 23, 14:05:09');
    expect(formatDateTime('2026-10-23T14:05:09+05:30', 'UTC')).toBe('Oct 23, 08:35:09');
    expect(formatDateTime('2026-10-23T22:05:09-23:59', 'UTC')).toBe('Oct 24, 22:04:09');
    expect(formatDateTime('  2026-10-23T14:05:09Z\t', 'UTC')).toBe('Oct 23, 14:05:09');
    expect(formatDateTime('2024-02-29T12:00:00Z', 'UTC')).toBe('Feb 29, 12:00:00');
    expect(formatDateTime('2000-02-29T12:00:00Z', 'UTC')).toBe('Feb 29, 12:00:00');
    // 24:00 is the end of the day (ECMAScript and ISO 8601:2004).
    expect(formatDateTime('2026-12-31T24:00:00Z', 'UTC')).toBe('Jan 1, 00:00:00');
    // Years 0-99 stay as written, and extended years round-trip.
    expect(formatDateTime('0050-06-15T12:00:00Z', 'UTC')).toBe(formatDateTime('2050-06-15T12:00:00Z', 'UTC'));
    expect(formatDateTime(new Date(Date.UTC(-50, 5, 15, 12)).toISOString(), 'UTC')).toBe('Jun 15, 12:00:00');
    expect(formatDateTime('+275760-09-13T00:00:00.000Z', 'UTC')).toBe('Sep 13, 00:00:00');
  });

  it('reads a date-time without an offset as local time, as ECMAScript does', () => {
    const local = new Date(2026, 9, 23, 14, 5, 9);
    expect(formatDateTime('2026-10-23T14:05:09', 'UTC')).toBe(formatDateTime(local.toISOString(), 'UTC'));
    expect(formatDateTime('2026-10-23T14:05:09')).toBe('Oct 23, 14:05:09');
  });

  // Lenient Date.parse would invent machine-dependent dates from these, or roll Feb 30 to Mar 2.
  it.each([
    '1',
    '12',
    '2026',
    'hello 5',
    'Tuesday 3',
    'Oct 23 2026 14:05:09',
    'Fri, 23 Oct 2026 14:05:09 GMT',
    '2026-10-23',
    '2026-10-23 14:05:09Z',
    '2026-10-23T14Z',
    '2026-10-23T14:05:09.Z',
    '2026-10-23T14:05:09,5Z',
    '2026-10-23T14:05:09+05',
    '2026-10-23T14:05:09+0530',
    '2026-10-23T14:05:09+24:00',
    '2026-10-23T14:05:09+05:60',
    '2026-10-23T14:05:09ZZ',
    '26-10-23T14:05:09Z',
    '2026-1-23T14:05:09Z',
    '2026-02-29T00:00:00Z',
    '2025-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-00-10T00:00:00Z',
    '2026-10-00T00:00:00Z',
    '2026-10-23T24:00:01Z',
    '2026-10-23T24:00:00.001Z',
    '2026-10-23T23:60:00Z',
    '2026-10-23T23:59:60Z',
    '-000000-01-01T00:00:00Z',
    '+275760-09-13T00:00:00.001Z',
  ])('returns the em dash for %j', (input) => {
    expect(formatDateTime(input, 'UTC')).toBe(EMPTY_VALUE);
  });
});

describe('changeDirection', () => {
  it.each([
    [5, 1],
    [1e-12, 1],
    [Number.MAX_VALUE, 1],
    [-5, -1],
    [-1e-12, -1],
    [0, 0],
    [-0, 0],
    [null, 0],
    [undefined, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])('%s -> %i', (value, expected) => {
    expect(changeDirection(value)).toBe(expected);
  });

  it('never returns -0', () => {
    expect(Object.is(changeDirection(-0), 0)).toBe(true);
  });
});
