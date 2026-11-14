import type { RangeSpec } from '@aperture/shared/chartRanges';
import type { Bar, BarTimeframe } from '@aperture/shared/marketData';
import type { ProviderBar } from './provider.js';

const DAY_MS = 86_400_000;

/**
 * How late the first bar may start before history counts as cut short. Weekends and holidays leave
 * gaps of a few days, and a weekly or monthly bar can start well after the window opens.
 */
const START_LEEWAY_MS: Record<BarTimeframe, number> = {
  '5Min': 4 * DAY_MS,
  '15Min': 4 * DAY_MS,
  '30Min': 4 * DAY_MS,
  '1Hour': 4 * DAY_MS,
  '1Day': 5 * DAY_MS,
  '1Week': 14 * DAY_MS,
  '1Month': 62 * DAY_MS,
};

const easternDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/**
 * Bars of the most recent session for the 1D chart: for stocks, the last bar's New York trading day; for
 * crypto, which trades around the clock, the 24 hours before `nowMs`.
 */
export function lastSessionBars(bars: readonly ProviderBar[], crypto: boolean, nowMs: number): ProviderBar[] {
  if (crypto) return bars.filter((bar) => bar.time > nowMs - DAY_MS);
  const last = bars.at(-1);
  if (last === undefined) return [];
  const session = easternDate.format(last.time);
  return bars.filter((bar) => easternDate.format(bar.time) === session);
}

/**
 * True when the provider's history starts after the range does: a recent listing, or a window reaching
 * past the provider's retention. For "earliest available", true when history begins right at the
 * retention floor, because older history was probably cut off. No bars at all is an empty result, not a
 * truncated one.
 */
export function isTruncated(spec: RangeSpec, firstBarMs: number | null, historyStartMs: number): boolean {
  if (spec.lastSessionOnly || firstBarMs === null) return false;
  const leeway = START_LEEWAY_MS[spec.timeframe];
  if (spec.start === null) return firstBarMs - historyStartMs <= leeway;
  return firstBarMs - spec.start.getTime() > leeway;
}

/** Provider bars in the chart's shape, with times in epoch seconds. */
export function toChartBars(bars: readonly ProviderBar[]): Bar[] {
  return bars.map((bar) => ({
    time: Math.floor(bar.time / 1000),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}
