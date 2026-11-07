import { describe, expect, it } from 'vitest';
import type { Bar } from '../../domain/types';
import { averageDailyVolume, priceRange, rangePosition } from './historyStats';

const DAY = 86_400;
const START = Date.UTC(2026, 9, 19) / 1000;

function bar(day: number, low: number, high: number, volume = 1_000): Bar {
  return { time: START + day * DAY, open: low, high, low, close: high, volume };
}

describe('priceRange', () => {
  it('spans the lowest low and the highest high', () => {
    expect(priceRange([bar(0, 10, 12), bar(1, 8, 11), bar(2, 9, 15)])).toEqual({ low: 8, high: 15 });
  });

  it('widens to include live prices outside the bars, ignoring missing ones', () => {
    expect(priceRange([bar(0, 10, 12)], [16, null, undefined, 9.5])).toEqual({ low: 9.5, high: 16 });
    expect(priceRange([bar(0, 10, 12)], [11])).toEqual({ low: 10, high: 12 });
  });

  it('skips values that are not prices', () => {
    const broken = { ...bar(1, 0, Number.NaN) };
    expect(priceRange([bar(0, 10, 12), broken], [Number.POSITIVE_INFINITY, -3])).toEqual({ low: 10, high: 12 });
  });

  it('is null without any price', () => {
    expect(priceRange([])).toBeNull();
    expect(priceRange([], [null])).toBeNull();
  });

  it('never builds a range from live prices alone, which would cover only today', () => {
    expect(priceRange([], [101, 99, 100])).toBeNull();
    expect(priceRange([{ ...bar(0, 1, 2), low: Number.NaN, high: Number.NaN }], [101])).toBeNull();
  });
});

describe('rangePosition', () => {
  const range = { low: 100, high: 200 };

  it('places the price between the low (0) and the high (1)', () => {
    expect(rangePosition(100, range)).toBe(0);
    expect(rangePosition(150, range)).toBe(0.5);
    expect(rangePosition(200, range)).toBe(1);
  });

  it('clamps a price outside the range', () => {
    expect(rangePosition(90, range)).toBe(0);
    expect(rangePosition(250, range)).toBe(1);
  });

  it('centers the price in a flat range', () => {
    expect(rangePosition(100, { low: 100, high: 100 })).toBe(0.5);
  });

  it('is null without a price or a range', () => {
    expect(rangePosition(null, range)).toBeNull();
    expect(rangePosition(Number.NaN, range)).toBeNull();
    expect(rangePosition(150, null)).toBeNull();
  });
});

describe('averageDailyVolume', () => {
  const endOfDay = (day: number) => (START + (day + 1) * DAY) * 1000;

  it('averages the volume of completed days', () => {
    expect(averageDailyVolume([bar(0, 1, 2, 100), bar(1, 1, 2, 300)], endOfDay(1))).toBe(200);
  });

  it("leaves out today's partial bar", () => {
    const bars = [bar(0, 1, 2, 100), bar(1, 1, 2, 300), bar(2, 1, 2, 5)];
    expect(averageDailyVolume(bars, endOfDay(2) - 1)).toBe(200);
    expect(averageDailyVolume(bars, endOfDay(2))).toBe(135);
  });

  it('skips bars with an invalid volume', () => {
    const bars = [bar(0, 1, 2, 100), { ...bar(1, 1, 2), volume: Number.NaN }, bar(2, 1, 2, -5)];
    expect(averageDailyVolume(bars, endOfDay(2))).toBe(100);
  });

  it('is null when no day has completed', () => {
    expect(averageDailyVolume([], endOfDay(0))).toBeNull();
    expect(averageDailyVolume([bar(0, 1, 2, 100)], endOfDay(0) - 1)).toBeNull();
  });
});
