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

/**
 * Round-3 adversarial tests for format.ts, derived from the doc comments and the task spec.
 * Cross-function consistency (price vs change, clock vs date-time), sign symmetry, monotonicity of
 * age buckets, and the extreme ends of the Date range.
 */

const MINUS = '−';

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

function seededValues(seed: number, n: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const exp = Math.floor(r() * 14) - 6; // 1e-6 .. 1e7
    const v = Math.round(r() * 10 ** exp * 1e6) / 1e6;
    out.push(r() < 0.5 ? -v : v);
  }
  return out;
}

describe('formatPrice / formatChange / formatPercent consistency (round 3)', () => {
  const values = seededValues(8, 4000);

  it('formatChange is formatPrice of the magnitude with a sign rule applied', () => {
    for (const v of values) {
      const mag = formatPrice(Math.abs(v));
      const change = formatChange(v);
      if (!/[1-9]/.test(mag)) expect(change, String(v)).toBe(mag);
      else if (v < 0) expect(change, String(v)).toBe(MINUS + mag);
      else expect(change, String(v)).toBe(`+${mag}`);
    }
  });

  it('formatPrice of a negative value is the minus sign plus the magnitude (or an unsigned zero)', () => {
    for (const v of values) {
      if (v >= 0) continue;
      const mag = formatPrice(-v);
      expect(formatPrice(v)).toBe(/[1-9]/.test(mag) ? MINUS + mag : mag);
    }
  });

  it('formatPercent is antisymmetric and always has exactly 2 decimals', () => {
    for (const v of values) {
      const pos = formatPercent(Math.abs(v));
      const neg = formatPercent(-Math.abs(v));
      expect(pos).toMatch(/^(\+)?\d{1,3}(,\d{3})*\.\d{2}%$/);
      if (pos === '0.00%') expect(neg).toBe('0.00%');
      else expect(neg).toBe(MINUS + pos.slice(1));
    }
  });

  it('price output always has 2 or 4 decimals and 4 only when the shown magnitude is below 1', () => {
    for (const v of values) {
      const s = formatPrice(v).replace(MINUS, '');
      const m = /^(\d{1,3}(?:,\d{3})*)\.(\d+)$/.exec(s);
      expect(m, s).not.toBeNull();
      const [, int = '', dec = ''] = m!;
      expect([2, 4]).toContain(dec.length);
      if (dec.length === 4) expect(int).toBe('0');
      if (Math.abs(v) >= 1) expect(dec.length).toBe(2);
    }
  });

  it('changeDirection agrees with the sign of formatChange whenever the display is non-zero', () => {
    for (const v of values) {
      const s = formatChange(v);
      if (s.startsWith('+')) expect(changeDirection(v)).toBe(1);
      if (s.startsWith(MINUS)) expect(changeDirection(v)).toBe(-1);
    }
  });

  it('formatters accept the boxed-free primitive only: numeric strings are not numbers', () => {
    // Untyped data from storage: a string is not a finite number and must not be formatted.
    const asNumber = (x: unknown) => x as number;
    for (const f of [formatPrice, formatChange, formatPercent, formatVolume]) {
      expect(f(asNumber('12.5'))).toBe(EMPTY_VALUE);
      expect(f(asNumber(true))).toBe(EMPTY_VALUE);
    }
    expect(changeDirection(asNumber('5'))).toBe(0);
  });
});

describe('formatVolume (round 3)', () => {
  it('compact output parses back to within rounding error of the input', () => {
    const r = rng(123);
    const scale: Record<string, number> = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
    for (let i = 0; i < 5000; i++) {
      const v = Math.floor(10 ** (r() * 14));
      const s = formatVolume(v);
      const m = /^([\d,]+(?:\.\d+)?)([KMBT]?)$/.exec(s);
      expect(m, `${v} -> ${s}`).not.toBeNull();
      const [, num = '', unit = ''] = m!;
      const back = Number(num.replace(/,/g, '')) * scale[unit]!;
      // 3 significant digits -> relative error at most 0.5%.
      expect(Math.abs(back - v) / Math.max(v, 1), `${v} -> ${s}`).toBeLessThanOrEqual(0.005 + 1e-9);
      if (unit !== '' && unit !== 'T') expect(Number(num)).toBeLessThan(1000);
      if (unit !== '') expect(num.replace(/[.,]/g, '').replace(/^0+/, '').length).toBe(3);
    }
  });

  it('is monotonic: a larger volume never renders as a smaller compact number', () => {
    const scale: Record<string, number> = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
    const parse = (s: string) => {
      const m = /^([\d,.]+)([KMBT]?)$/.exec(s)!;
      return Number(m[1]!.replace(/,/g, '')) * scale[m[2] ?? '']!;
    };
    let prev = -1;
    for (let v = 0; v < 2e6; v += 997) {
      const p = parse(formatVolume(v));
      expect(p, String(v)).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('formatClock / formatDateTime consistency (round 3)', () => {
  const zones = [
    'America/New_York',
    'UTC',
    'Asia/Kolkata',
    'Australia/Lord_Howe',
    'Pacific/Chatham',
    'Europe/London',
  ];

  it('formatDateTime(toISOString) ends with formatClock for the same zone', () => {
    const r = rng(4242);
    for (let i = 0; i < 1500; i++) {
      const ms = Math.floor(r() * 2_000_000_000_000);
      const zone = zones[i % zones.length]!;
      const iso = new Date(ms).toISOString();
      const dt = formatDateTime(iso, zone);
      expect(dt, `${iso} ${zone}`).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}:\d{2}$/);
      expect(dt.endsWith(formatClock(ms, zone)), `${iso} ${zone}`).toBe(true);
    }
  });

  it('formatClock with an explicit New York zone equals the default', () => {
    const r = rng(9);
    for (let i = 0; i < 500; i++) {
      const ms = Math.floor(r() * 2_000_000_000_000);
      expect(formatClock(ms)).toBe(formatClock(ms, 'America/New_York'));
    }
  });

  it('handles the last and first representable instants of the Date range', () => {
    expect(formatClock(8.64e15, 'UTC')).toBe('00:00:00');
    expect(formatClock(-8.64e15, 'UTC')).toBe('00:00:00');
    expect(formatClock(8.64e15 + 1, 'UTC')).toBe(EMPTY_VALUE);
    expect(formatDateTime('+275760-09-13T00:00:00.000Z', 'UTC')).toBe('Sep 13, 00:00:00');
    expect(formatDateTime('-271821-04-20T00:00:00.000Z', 'UTC')).toBe('Apr 20, 00:00:00');
    expect(formatDateTime('+275760-09-13T00:00:00.001Z', 'UTC')).toBe(EMPTY_VALUE);
  });

  it('applies ISO offsets exactly, including the date roll at midnight', () => {
    expect(formatDateTime('2026-03-01T00:30:00+01:00', 'UTC')).toBe('Feb 28, 23:30:00');
    expect(formatDateTime('2024-03-01T00:30:00+01:00', 'UTC')).toBe('Feb 29, 23:30:00');
    expect(formatDateTime('2026-12-31T23:30:00-01:00', 'UTC')).toBe('Jan 1, 00:30:00');
  });

  it('rejects date-only, time-only and loose strings', () => {
    for (const s of ['2026-10-23', '18:05:09', 'Oct 23 2026 18:05', '1700000000000', '2026-10-23T', 'now']) {
      expect(formatDateTime(s, 'UTC'), s).toBe(EMPTY_VALUE);
    }
  });
});

describe('formatAge (round 3)', () => {
  it('bucket output is monotonic in age and floors every unit', () => {
    const now = 1_800_000_000_000;
    const toSeconds = (s: string): number => {
      if (s === 'just now') return 0;
      const m = /^(\d+)([smhd]) ago$/.exec(s);
      expect(m, s).not.toBeNull();
      const n = Number(m![1]);
      const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m![2] as 's' | 'm' | 'h' | 'd'];
      return n * mult;
    };
    let prev = 0;
    for (let age = 0; age < 10 * 86_400_000; age += 7_919) {
      const shown = toSeconds(formatAge(now - age, now));
      expect(shown, String(age)).toBeGreaterThanOrEqual(prev);
      expect(shown * 1000, String(age)).toBeLessThanOrEqual(age); // floored, never rounded up
      prev = shown;
    }
  });

  it('switches units exactly at 60s, 60m and 24h', () => {
    const now = 10 ** 12;
    expect(formatAge(now - 59_999, now)).toBe('59s ago');
    expect(formatAge(now - 60_000, now)).toBe('1m ago');
    expect(formatAge(now - 3_599_999, now)).toBe('59m ago');
    expect(formatAge(now - 3_600_000, now)).toBe('1h ago');
    expect(formatAge(now - 86_399_999, now)).toBe('23h ago');
    expect(formatAge(now - 86_400_000, now)).toBe('1d ago');
    expect(formatAge(now - 1_999, now)).toBe('just now');
    expect(formatAge(now - 2_000, now)).toBe('2s ago');
  });
});
