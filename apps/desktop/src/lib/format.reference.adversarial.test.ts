import { describe, expect, it } from 'vitest';
import {
  EMPTY_VALUE,
  changeDirection,
  formatAge,
  formatChange,
  formatClock,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatVolume,
} from './format';

/**
 * Round-2 adversarial tests for format.ts. The reference formatters below do decimal rounding on
 * digit strings (half away from zero on the shortest decimal form, as the module doc promises), so
 * they share no code path with Intl.
 */

const MINUS = '−';

/** Exact decimal string of a finite non-negative number in plain notation (no exponent). */
function plainDecimal(x: number): string {
  const s = String(x);
  if (!s.includes('e')) return s;
  const [mant, expStr] = s.split('e') as [string, string];
  const exp = Number(expStr);
  const [int, frac = ''] = mant.split('.') as [string, string?];
  const digits = int + frac;
  const point = int.length + exp;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Rounds a non-negative decimal string to `decimals` places, half away from zero. */
function roundDecimal(dec: string, decimals: number): string {
  const [int, frac = ''] = dec.split('.') as [string, string?];
  const padded = (frac + '0'.repeat(decimals + 1)).slice(0, decimals + 1);
  let scaled = BigInt(int + padded.slice(0, decimals));
  const nextDigit = Number(padded[decimals]);
  if (nextDigit >= 5) scaled += 1n;
  const str = scaled.toString().padStart(decimals + 1, '0');
  const i = str.slice(0, str.length - decimals);
  const f = str.slice(str.length - decimals);
  return decimals > 0 ? `${i}.${f}` : i;
}

function group(dec: string): string {
  const [int, frac] = dec.split('.') as [string, string?];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

const isZero = (s: string): boolean => !/[1-9]/.test(s);

function refPriceMagnitude(abs: number): string {
  const dec = plainDecimal(abs);
  if (abs < 1) {
    const four = roundDecimal(dec, 4);
    if (!isZero(four) && Number(four) < 1) return group(four);
  }
  return group(roundDecimal(dec, 2));
}

function refSigned(value: number, mag: string, plus: boolean): string {
  if (isZero(mag)) return mag;
  if (value < 0) return MINUS + mag;
  return plus ? `+${mag}` : mag;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

/** Values spread over magnitudes 1e-6 .. 1e13, both signs, with many exact half-way decimals. */
function corpus(seed: number, n: number): number[] {
  const rand = lcg(seed);
  const out: number[] = [0, -0, 1, -1, 0.5, 0.99995, 0.99994, 1.005, 2.675, 1.115, 999.995, 1234.5, -0.00005];
  for (let i = 0; i < n; i++) {
    const mag = Math.pow(10, -6 + rand() * 19);
    const sign = rand() < 0.5 ? -1 : 1;
    // Half the time, snap to a 5 in the 3rd or 5th decimal to hit rounding ties.
    let v = mag;
    const pick = rand();
    if (pick < 0.5) v = Math.round(mag * 1000) / 1000 + 0.0005;
    else if (pick < 0.75) v = Math.round(mag * 100000) / 100000 + 0.000005;
    out.push(sign * Number(v.toPrecision(12)));
  }
  return out;
}

describe('formatPrice / formatChange vs decimal reference (round 2)', () => {
  it('formatPrice matches the reference for 3000 seeded values', () => {
    for (const v of corpus(1, 3000)) {
      expect(formatPrice(v), String(v)).toBe(refSigned(v, refPriceMagnitude(Math.abs(v)), false));
    }
  });

  it('formatChange matches the reference for 3000 seeded values', () => {
    for (const v of corpus(2, 3000)) {
      expect(formatChange(v), String(v)).toBe(refSigned(v, refPriceMagnitude(Math.abs(v)), true));
    }
  });

  it('formatPercent matches the reference for 3000 seeded values', () => {
    for (const v of corpus(3, 3000)) {
      const mag = group(roundDecimal(plainDecimal(Math.abs(v)), 2));
      expect(formatPercent(v), String(v)).toBe(`${refSigned(v, mag, true)}%`);
    }
  });

  it('formatPrice never uses a plus sign; formatChange always signs a non-zero display', () => {
    for (const v of corpus(4, 500)) {
      expect(formatPrice(v)).not.toContain('+');
      const c = formatChange(v);
      if (!isZero(c)) expect(c.startsWith('+') || c.startsWith(MINUS), c).toBe(true);
      expect(c).not.toContain('-');
    }
  });
});

/** Reference compact volume. */
function refVolume(value: number): string {
  const abs = Math.abs(value);
  const whole = roundDecimal(plainDecimal(abs), 0);
  if (Number(whole) < 1000) return refSigned(value, whole, false);
  const units: [number, string][] = [
    [3, 'K'],
    [6, 'M'],
    [9, 'B'],
    [12, 'T'],
  ];
  for (const [exp, suffix] of units) {
    const mantissa = abs / Math.pow(10, exp);
    // 3 significant digits on the decimal form.
    const intDigits = Math.floor(mantissa).toString().length;
    const decimals = Math.max(0, 3 - intDigits);
    let rounded = roundDecimal(plainDecimal(mantissa), decimals);
    // Rounding up can add an integer digit (9.995 -> "10.00"); keep 3 significant digits ("10.0").
    if (decimals > 0 && rounded.split('.')[0]!.length > intDigits) {
      rounded = roundDecimal(rounded, decimals - 1);
    }
    if (Number(rounded) < 1000 || suffix === 'T')
      return refSigned(value, `${group(rounded)}${suffix}`, false);
  }
  throw new Error('unreachable');
}

describe('formatVolume vs reference (round 2)', () => {
  it('matches the reference around every unit boundary', () => {
    const edges: number[] = [];
    for (const base of [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12]) {
      for (const f of [0.9994, 0.9995, 0.99949, 0.9995, 0.99951, 1, 1.0049, 1.005, 1.0051]) {
        edges.push(Math.round(base * f));
      }
    }
    edges.push(
      999,
      999.4,
      999.5,
      1000,
      999_950,
      999_949,
      1e9,
      0.4,
      0.5,
      950,
      12_300,
      4_560_000,
      7_800_000_000,
    );
    for (const v of edges) {
      expect(formatVolume(v), String(v)).toBe(refVolume(v));
      expect(formatVolume(-v), String(-v)).toBe(refVolume(-v));
    }
  });

  it('matches the reference for 3000 seeded integers up to 1e13', () => {
    const rand = lcg(99);
    for (let i = 0; i < 3000; i++) {
      const v = Math.round(Math.pow(10, rand() * 13));
      expect(formatVolume(v), String(v)).toBe(refVolume(v));
    }
  });

  it('documented examples', () => {
    expect(formatVolume(950)).toBe('950');
    expect(formatVolume(12_300)).toBe('12.3K');
    expect(formatVolume(4_560_000)).toBe('4.56M');
    expect(formatVolume(7_800_000_000)).toBe('7.80B');
  });
});

describe('formatClock DST fall-back and midnight (round 2)', () => {
  it('the repeated 01:30 hour on 2024-11-03 shows 01:30:00 twice in New York', () => {
    expect(formatClock(Date.UTC(2024, 10, 3, 5, 30))).toBe('01:30:00'); // EDT
    expect(formatClock(Date.UTC(2024, 10, 3, 6, 30))).toBe('01:30:00'); // EST
    expect(formatClock(Date.UTC(2024, 10, 3, 6, 59, 59))).toBe('01:59:59');
    expect(formatClock(Date.UTC(2024, 10, 3, 7, 0, 0))).toBe('02:00:00');
  });

  it('midnight renders as 00, never 24', () => {
    expect(formatClock(Date.UTC(2024, 0, 15, 5, 0, 0))).toBe('00:00:00');
    expect(formatClock(Date.UTC(2024, 6, 15, 4, 0, 0))).toBe('00:00:00');
    expect(formatClock(Date.UTC(2024, 0, 15, 0, 0, 0), 'UTC')).toBe('00:00:00');
  });

  it('half-hour offset zones', () => {
    expect(formatClock(Date.UTC(2024, 0, 15, 0, 0, 0), 'Asia/Kolkata')).toBe('05:30:00');
  });

  it('always matches HH:mm:ss for seeded timestamps across zones', () => {
    const rand = lcg(5);
    for (let i = 0; i < 300; i++) {
      const t = Math.floor(rand() * 4e12);
      for (const tz of ['America/New_York', 'UTC', 'Asia/Tokyo', 'Australia/Lord_Howe']) {
        expect(formatClock(t, tz)).toMatch(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
      }
    }
  });
});

describe('formatAge bucket boundaries (round 2)', () => {
  const now = 1_700_000_000_000;
  it.each([
    [0, 'just now'],
    [1999, 'just now'],
    [2000, '2s ago'],
    [59_999, '59s ago'],
    [60_000, '1m ago'],
    [3_599_999, '59m ago'],
    [3_600_000, '1h ago'],
    [86_399_999, '23h ago'],
    [86_400_000, '1d ago'],
    [400 * 86_400_000, '400d ago'],
    [-5000, 'just now'],
  ])('age %d ms -> %s', (age, expected) => {
    expect(formatAge(now - age, now)).toBe(expected);
  });
});

describe('formatDateTime (round 2)', () => {
  it('formats in the explicit zone with zero-padded 24h time and unpadded day', () => {
    expect(formatDateTime('2024-10-03T04:05:09Z', 'UTC')).toBe('Oct 3, 04:05:09');
    expect(formatDateTime('2024-10-23T10:05:09-04:00', 'UTC')).toBe('Oct 23, 14:05:09');
    expect(formatDateTime('2024-10-23T00:00:00Z', 'UTC')).toBe('Oct 23, 00:00:00');
    // Crossing the date line backwards in New York.
    expect(formatDateTime('2025-01-01T04:59:59Z', 'America/New_York')).toBe('Dec 31, 23:59:59');
  });

  // The parameter is an ISO timestamp (types.ts: "ISO timestamps"). Strings that are not ISO-8601
  // date-times must not be turned into a plausible-looking but invented date by lenient parsing.
  it.each(['1', '12', 'hello 5', 'Tuesday 3'])('returns the em dash for the non-ISO string %j', (input) => {
    expect(formatDateTime(input, 'UTC')).toBe(EMPTY_VALUE);
  });
});

describe('changeDirection (round 2)', () => {
  it.each([
    [Number.MIN_VALUE, 1],
    [-Number.MIN_VALUE, -1],
    [Number.MAX_VALUE, 1],
    [-0, 0],
  ] as const)('%s -> %d', (v, expected) => {
    expect(changeDirection(v)).toBe(expected);
  });
});
