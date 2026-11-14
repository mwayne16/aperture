import { resolveRange } from '@aperture/shared/chartRanges';
import { describe, expect, it } from 'vitest';
import { isTruncated, lastSessionBars, toChartBars } from './history.js';
import type { ProviderBar } from './provider.js';

const bar = (iso: string): ProviderBar => ({
  time: Date.parse(iso),
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
});
const FLOOR = Date.UTC(2016, 0, 1);

describe('lastSessionBars', () => {
  it("keeps the last bar's New York trading day for stocks, across the UTC date line", () => {
    const bars = [
      bar('2026-11-12T20:55:00Z'), // Thursday 15:55 ET
      bar('2026-11-13T14:30:00Z'), // Friday 09:30 ET
      bar('2026-11-13T20:55:00Z'), // Friday 15:55 ET
      bar('2026-11-14T00:30:00Z'), // Friday 19:30 ET, after hours, already Saturday in UTC
    ];
    expect(lastSessionBars(bars, false, Date.parse('2026-11-14T12:00:00Z'))).toEqual(bars.slice(1));
  });

  it('keeps the last 24 hours for crypto, which has no sessions', () => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    const bars = [bar('2026-11-13T11:55:00Z'), bar('2026-11-13T12:05:00Z'), bar('2026-11-14T11:55:00Z')];
    expect(lastSessionBars(bars, true, now)).toEqual(bars.slice(1));
  });

  it('returns nothing for no bars', () => {
    expect(lastSessionBars([], false, 0)).toEqual([]);
  });
});

describe('isTruncated', () => {
  const now = new Date('2026-11-14T15:00:00Z');

  it('allows for weekends and holidays before the first daily bar', () => {
    const spec = resolveRange('3M', now); // starts Friday 2026-08-14
    expect(isTruncated(spec, Date.parse('2026-08-17T04:00:00Z'), FLOOR)).toBe(false);
    expect(isTruncated(spec, Date.parse('2026-10-01T04:00:00Z'), FLOOR)).toBe(true);
  });

  it('flags a window that reaches past the retention floor', () => {
    const spec = resolveRange('10Y', new Date('2025-06-01T00:00:00Z')); // starts 2015-06
    expect(isTruncated(spec, Date.parse('2016-01-01T00:00:00Z'), FLOOR)).toBe(true);
  });

  it('flags "earliest available" only when history begins at the floor', () => {
    const spec = resolveRange('ALL', now);
    expect(isTruncated(spec, Date.parse('2016-01-01T00:00:00Z'), FLOOR)).toBe(true);
    expect(isTruncated(spec, Date.parse('2019-12-01T00:00:00Z'), FLOOR)).toBe(false);
  });

  it('never flags the one-day chart or an empty result', () => {
    expect(isTruncated(resolveRange('1D', now), Date.parse('2026-11-14T14:30:00Z'), FLOOR)).toBe(false);
    expect(isTruncated(resolveRange('1Y', now), null, FLOOR)).toBe(false);
  });
});

describe('toChartBars', () => {
  it('converts bar times to epoch seconds', () => {
    expect(toChartBars([bar('2026-11-13T14:30:00.999Z')])[0]?.time).toBe(
      Date.parse('2026-11-13T14:30:00Z') / 1000,
    );
  });
});
