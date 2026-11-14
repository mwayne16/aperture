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
 * Round-5 adversarial tests: every example written in the formatter doc comments, plus interleaved
 * use of clock and date-time formatters across zones so a cached formatter of one kind never leaks
 * into the other.
 */

const MINUS = '−';

describe('documented examples', () => {
  it('formatPrice, formatChange and formatPercent examples', () => {
    expect(formatPrice(1234.5)).toBe('1,234.50');
    expect(formatChange(1.23)).toBe('+1.23');
    expect(formatChange(-1.23)).toBe(`${MINUS}1.23`);
    expect(formatChange(0)).toBe('0.00');
    expect(formatPercent(1.23)).toBe('+1.23%');
    expect(formatPercent(-0.4)).toBe(`${MINUS}0.40%`);
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('formatVolume examples', () => {
    expect(formatVolume(950)).toBe('950');
    expect(formatVolume(12_300)).toBe('12.3K');
    expect(formatVolume(4_560_000)).toBe('4.56M');
    expect(formatVolume(7_800_000_000)).toBe('7.80B');
  });

  it('formatAge examples and buckets', () => {
    const now = 1_000_000_000_000;
    expect(formatAge(now - 1_999, now)).toBe('just now');
    expect(formatAge(now - 5_000, now)).toBe('5s ago');
    expect(formatAge(now - 3 * 60_000, now)).toBe('3m ago');
    expect(formatAge(now - 2 * 3_600_000, now)).toBe('2h ago');
    expect(formatAge(now - 4 * 86_400_000, now)).toBe('4d ago');
  });

  it('formatDateTime example', () => {
    expect(formatDateTime('2026-10-23T18:05:09.000Z', 'America/New_York')).toBe('Oct 23, 14:05:09');
  });

  it('change formatters agree with changeDirection on sign', () => {
    for (const v of [-1234.5, -1, -0.5, -0.0001, 0, -0, 0.0001, 0.5, 1, 1234.5]) {
      const dir = changeDirection(v);
      const change = formatChange(v);
      if (dir > 0) expect(change.startsWith('+'), `${v}`).toBe(true);
      if (dir < 0) expect(change.startsWith(MINUS), `${v}`).toBe(true);
      if (dir === 0) expect(change, `${v}`).toBe('0.00');
    }
  });
});

describe('formatter cache isolation across kinds and zones', () => {
  it('interleaving clock and date-time calls in the same zone keeps each format', () => {
    const ms = Date.UTC(2026, 9, 23, 18, 5, 9);
    const iso = new Date(ms).toISOString();
    for (let i = 0; i < 3; i++) {
      expect(formatClock(ms, 'UTC')).toBe('18:05:09');
      expect(formatDateTime(iso, 'UTC')).toBe('Oct 23, 18:05:09');
      expect(formatClock(ms, 'Asia/Tokyo')).toBe('03:05:09');
      expect(formatDateTime(iso, 'Asia/Tokyo')).toBe('Oct 24, 03:05:09');
    }
  });

  it('the default clock zone stays New York after other zones were used', () => {
    const ms = Date.UTC(2026, 6, 1, 12, 0, 0); // EDT, UTC-4
    formatClock(ms, 'Asia/Tokyo');
    formatClock(ms, 'UTC');
    expect(formatClock(ms)).toBe('08:00:00');
    expect(formatClock(ms, undefined)).toBe('08:00:00');
  });

  it('formatDateTime returns the empty value for date-only, time-only and impossible inputs', () => {
    for (const s of ['2026-10-23', '18:05:09', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', 'now']) {
      expect(formatDateTime(s, 'UTC'), s).toBe(EMPTY_VALUE);
    }
  });
});
