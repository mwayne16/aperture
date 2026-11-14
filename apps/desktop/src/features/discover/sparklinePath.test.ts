import { describe, expect, it } from 'vitest';
import { seriesDirection, sparklineGeometry } from './sparklinePath';

const BOX = { width: 100, height: 20, inset: 0 };

describe('sparklineGeometry', () => {
  it('maps the first value to the left edge and the last to the right, highest at the top', () => {
    const geometry = sparklineGeometry([10, 20, 15], BOX);
    expect(geometry?.line).toBe('M0 20 L50 0 L100 10');
  });

  it('closes the area down to the bottom edge', () => {
    const geometry = sparklineGeometry([10, 20], BOX);
    expect(geometry?.area).toBe('M0 20 L100 0 L100 20 L0 20 Z');
  });

  it('keeps the inset clear on every side', () => {
    const geometry = sparklineGeometry([1, 3], { width: 100, height: 20, inset: 2 });
    expect(geometry?.line).toBe('M2 18 L98 2');
  });

  it('draws a flat series along the middle instead of dividing by zero', () => {
    expect(sparklineGeometry([5, 5, 5], BOX)?.line).toBe('M0 10 L50 10 L100 10');
  });

  it('skips values that are not finite', () => {
    expect(sparklineGeometry([10, Number.NaN, 20, Number.POSITIVE_INFINITY], BOX)?.line).toBe('M0 20 L100 0');
  });

  it('returns null when fewer than two points can be drawn', () => {
    expect(sparklineGeometry([], BOX)).toBeNull();
    expect(sparklineGeometry([42], BOX)).toBeNull();
    expect(sparklineGeometry([42, Number.NaN], BOX)).toBeNull();
  });

  it('widens the range to include the baseline and reports where it sits', () => {
    const geometry = sparklineGeometry([10, 20], BOX, 0);
    expect(geometry?.line).toBe('M0 10 L100 0');
    expect(geometry?.baselineY).toBe(20);
  });

  it('ignores a missing or non-finite baseline', () => {
    expect(sparklineGeometry([10, 20], BOX, null)?.baselineY).toBeNull();
    expect(sparklineGeometry([10, 20], BOX, Number.NaN)?.baselineY).toBeNull();
    expect(sparklineGeometry([10, 20], BOX, Number.NaN)?.line).toBe('M0 20 L100 0');
  });

  it('rounds coordinates to two decimals', () => {
    expect(sparklineGeometry([0, 1, 2], { width: 10, height: 3, inset: 0 })?.line).toBe('M0 3 L5 1.5 L10 0');
    expect(sparklineGeometry([0, 1, 1, 2], { width: 10, height: 10, inset: 0 })?.line).toBe(
      'M0 10 L3.33 5 L6.67 5 L10 0',
    );
  });
});

describe('seriesDirection', () => {
  it('compares the last value with the first', () => {
    expect(seriesDirection([1, 5, 2])).toBe(1);
    expect(seriesDirection([3, 5, 2])).toBe(-1);
    expect(seriesDirection([3, 5, 3])).toBe(0);
  });

  it('is flat for too few points and skips non-finite ends', () => {
    expect(seriesDirection([])).toBe(0);
    expect(seriesDirection([7])).toBe(0);
    expect(seriesDirection([Number.NaN, 1, 2, Number.NaN])).toBe(1);
  });
});
