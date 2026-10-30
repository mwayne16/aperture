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
 * Round-4 adversarial tests for the formatters: finite inputs whose derived values overflow, and
 * output-shape invariants over extreme magnitudes. The module promise is that tables never show
 * "NaN", "Infinity", "null" or "undefined".
 */

const GARBAGE = /NaN|Infinity|null|undefined/;

describe('formatAge with finite inputs whose difference overflows', () => {
  it('does not print "Infinity" when now - epochMs overflows to Infinity', () => {
    const out = formatAge(-Number.MAX_VALUE, Number.MAX_VALUE);
    expect(out).not.toMatch(GARBAGE);
  });

  it('a future timestamp whose difference overflows to -Infinity still reads "just now"', () => {
    expect(formatAge(Number.MAX_VALUE, -Number.MAX_VALUE)).toBe('just now');
  });
});

describe('formatter outputs never contain NaN/Infinity/null/undefined for any finite input', () => {
  const finite = [
    0,
    -0,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    Number.EPSILON,
    0.5,
    0.99995,
    1,
    999.995,
    1e15,
    1e21,
    -1e21,
    1e300,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
  ];

  it.each(finite)('formatPrice/formatChange/formatPercent/formatVolume(%s)', (v) => {
    for (const out of [formatPrice(v), formatChange(v), formatPercent(v), formatVolume(v)]) {
      expect(out).not.toMatch(GARBAGE);
      expect(out).not.toBe('');
    }
  });

  it('formatClock returns "—" for finite epochs outside the Date range', () => {
    expect(formatClock(8.64e15 + 1)).toBe(EMPTY_VALUE);
    expect(formatClock(-8.64e15 - 1)).toBe(EMPTY_VALUE);
    expect(formatClock(Number.MAX_VALUE)).toBe(EMPTY_VALUE);
  });

  it('formatClock is "HH:mm:ss" at both ends of the Date range', () => {
    expect(formatClock(8.64e15, 'UTC')).toBe('00:00:00');
    expect(formatClock(-8.64e15, 'UTC')).toBe('00:00:00');
  });
});

describe('formatDateTime at calendar extremes', () => {
  it('accepts Feb 29 in year 0, which is a leap year', () => {
    expect(formatDateTime('0000-02-29T12:00:00.000Z', 'UTC')).toBe('Feb 29, 12:00:00');
  });

  it('rejects Feb 29 in 1900, which is not a leap year', () => {
    expect(formatDateTime('1900-02-29T12:00:00.000Z', 'UTC')).toBe(EMPTY_VALUE);
  });

  it('formats toISOString output at both ends of the Date range', () => {
    expect(formatDateTime(new Date(-8.64e15).toISOString(), 'UTC')).toBe('Apr 20, 00:00:00');
    expect(formatDateTime(new Date(8.64e15).toISOString(), 'UTC')).toBe('Sep 13, 00:00:00');
  });

  it('returns "—" for an ISO string just past the end of the Date range', () => {
    expect(formatDateTime('+275760-09-13T00:00:00.001Z', 'UTC')).toBe(EMPTY_VALUE);
  });
});

describe('changeDirection agrees in sign with formatChange for visible changes', () => {
  it.each([0.01, -0.01, 0.0001, -0.0001, 1234.5, -1234.5, Number.MAX_VALUE, -Number.MAX_VALUE])(
    'value %s',
    (v) => {
      const out = formatChange(v);
      const dir = changeDirection(v);
      if (out.startsWith('+')) expect(dir).toBe(1);
      else if (out.startsWith('−')) expect(dir).toBe(-1);
      else expect(dir).toBe(0);
    },
  );
});
