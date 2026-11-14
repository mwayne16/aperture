import { describe, expect, it } from 'vitest';
import { FALLBACK_THEME_COLORS } from '../../components/ui/theme';
import type { Bar } from '../../domain/types';
import {
  chartPalette,
  chartableBars,
  findBarIndex,
  includePrice,
  lineOptions,
  placeTooltip,
  toCandles,
  toLine,
  toVolume,
  withAlpha,
} from './chartData';

function bar(time: number, open: number, close: number): Bar {
  return { time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: time * 10 };
}

const palette = chartPalette({ ...FALLBACK_THEME_COLORS, gain: '#34d399', loss: '#f87171' });

describe('chartableBars', () => {
  it('keeps ordered bars as they are', () => {
    const bars = [bar(1, 10, 11), bar(2, 11, 12)];
    expect(chartableBars(bars)).toBe(bars);
  });

  it('sorts bars and keeps one per time, so the chart never throws', () => {
    const late = bar(3, 12, 13);
    const duplicate = bar(1, 99, 99);
    const result = chartableBars([late, bar(1, 10, 11), bar(2, 11, 12), duplicate]);
    expect(result.map((b) => b.time)).toEqual([1, 2, 3]);
    expect(result[0]).toBe(duplicate);
  });

  it('drops bars with values the chart cannot draw', () => {
    const broken = { ...bar(2, 11, 12), close: Number.NaN };
    expect(chartableBars([bar(1, 10, 11), broken, bar(3, 12, 13)]).map((b) => b.time)).toEqual([1, 3]);
  });
});

describe('series data', () => {
  const bars = [bar(100, 10, 11), bar(200, 11, 10.5)];

  it('maps bars to candles', () => {
    expect(toCandles(bars)).toEqual([
      { time: 100, open: 10, high: 11, low: 10, close: 11 },
      { time: 200, open: 11, high: 11, low: 10.5, close: 10.5 },
    ]);
  });

  it('maps bars to a line through their closes', () => {
    expect(toLine(bars)).toEqual([
      { time: 100, value: 11 },
      { time: 200, value: 10.5 },
    ]);
    expect(toLine([])).toEqual([]);
  });

  it('draws the line in the accent color with a marker that reads on the panel', () => {
    expect(lineOptions(palette)).toMatchObject({
      color: palette.line,
      crosshairMarkerBackgroundColor: palette.line,
      crosshairMarkerBorderColor: palette.background,
    });
  });

  it('colors volume by the bar direction', () => {
    expect(toVolume(bars, palette)).toEqual([
      { time: 100, value: 1000, color: 'rgba(52, 211, 153, 0.38)' },
      { time: 200, value: 2000, color: 'rgba(248, 113, 113, 0.38)' },
    ]);
  });
});

describe('withAlpha', () => {
  it('converts hex tokens to rgba', () => {
    expect(withAlpha('#047857', 0.5)).toBe('rgba(4, 120, 87, 0.5)');
    expect(withAlpha(' #fff ', 0.2)).toBe('rgba(255, 255, 255, 0.2)');
  });

  it('leaves other color formats alone', () => {
    expect(withAlpha('rgba(1, 2, 3, 0.4)', 0.5)).toBe('rgba(1, 2, 3, 0.4)');
  });
});

describe('findBarIndex', () => {
  const bars = [bar(10, 1, 1), bar(20, 1, 1), bar(30, 1, 1), bar(40, 1, 1)];

  it('finds a bar by its open time', () => {
    expect(findBarIndex(bars, 10)).toBe(0);
    expect(findBarIndex(bars, 30)).toBe(2);
    expect(findBarIndex(bars, 40)).toBe(3);
  });

  it('returns -1 for a time that has no bar', () => {
    expect(findBarIndex(bars, 25)).toBe(-1);
    expect(findBarIndex([], 10)).toBe(-1);
  });
});

describe('includePrice', () => {
  const info = { priceRange: { minValue: 100, maxValue: 110 } };

  it('widens the range to the live price', () => {
    expect(includePrice(info, 115)?.priceRange).toEqual({ minValue: 100, maxValue: 115 });
    expect(includePrice(info, 95)?.priceRange).toEqual({ minValue: 95, maxValue: 110 });
    expect(includePrice(info, 105)?.priceRange).toEqual({ minValue: 100, maxValue: 110 });
  });

  it('keeps the range when there is no live price or no data', () => {
    expect(includePrice(info, null)).toBe(info);
    expect(includePrice(null, 100)).toBeNull();
  });
});

describe('placeTooltip', () => {
  const area = { width: 400, height: 300 };
  const size = { width: 100, height: 80 };

  it('sits below and right of the point', () => {
    expect(placeTooltip({ x: 50, y: 40 }, area, size)).toEqual({ left: 64, top: 54 });
  });

  it('flips to the left and above near the far edges', () => {
    expect(placeTooltip({ x: 350, y: 280 }, area, size)).toEqual({ left: 236, top: 186 });
  });

  it('stays inside a chart smaller than the tooltip', () => {
    expect(placeTooltip({ x: 40, y: 30 }, { width: 90, height: 60 }, size)).toEqual({ left: 0, top: 0 });
  });
});
