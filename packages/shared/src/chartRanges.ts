import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import type { BarTimeframe, ChartRange } from './marketData.js';

dayjs.extend(utc);

/**
 * Maps a chart range to the bar size and time window to request. Bar counts stay in the low hundreds
 * so no range fetches an oversized dataset. Shared by the app's chart and the server's history endpoint.
 *
 * | Range | Timeframe | Window start                                  |
 * |-------|-----------|-----------------------------------------------|
 * | 1D    | 5Min      | now - 5 days; keep only the most recent session |
 * | 1W    | 30Min     | now - 7 days                                  |
 * | 1M    | 1Hour     | now - 1 calendar month                        |
 * | 3M    | 1Day      | now - 3 calendar months                       |
 * | 6M    | 1Day      | now - 6 calendar months                       |
 * | YTD   | 1Day      | Jan 1 of the current UTC year, 00:00 UTC      |
 * | 1Y    | 1Day      | now - 1 calendar year                         |
 * | 5Y    | 1Week     | now - 5 calendar years                        |
 * | 10Y   | 1Month    | now - 10 calendar years                       |
 * | ALL   | 1Month    | null (earliest the provider retains)          |
 *
 * Calendar-month and year subtraction use UTC and clamp the day to the end of the target month
 * (e.g. Mar 31 - 1 month = Feb 28/29). `now` must be 1970 or later.
 */
export interface RangeSpec {
  range: ChartRange;
  timeframe: BarTimeframe;
  /** Inclusive window start, or null for "earliest available". */
  start: Date | null;
  end: Date;
  /** For 1D: the caller keeps only bars from the most recent trading session in the window. */
  lastSessionOnly: boolean;
}

interface RangeWindow {
  timeframe: BarTimeframe;
  /** Window start for `now` in UTC, or null for "earliest available". */
  start: (now: Dayjs) => Dayjs | null;
}

const RANGE_WINDOWS: Record<ChartRange, RangeWindow> = {
  '1D': { timeframe: '5Min', start: (now) => now.subtract(5, 'day') },
  '1W': { timeframe: '30Min', start: (now) => now.subtract(7, 'day') },
  '1M': { timeframe: '1Hour', start: (now) => now.subtract(1, 'month') },
  '3M': { timeframe: '1Day', start: (now) => now.subtract(3, 'month') },
  '6M': { timeframe: '1Day', start: (now) => now.subtract(6, 'month') },
  YTD: { timeframe: '1Day', start: (now) => now.startOf('year') },
  '1Y': { timeframe: '1Day', start: (now) => now.subtract(1, 'year') },
  '5Y': { timeframe: '1Week', start: (now) => now.subtract(5, 'year') },
  '10Y': { timeframe: '1Month', start: (now) => now.subtract(10, 'year') },
  ALL: { timeframe: '1Month', start: () => null },
};

const EARLIEST_NOW_MS = Date.UTC(1970, 0, 1);

/**
 * Resolves a chart range against `now`. `end` is a copy of `now`, so callers can't change each other's
 * dates. Throws a RangeError for an invalid `now`, a `now` before 1970, or an unknown range, instead of
 * returning an Invalid Date.
 */
export function resolveRange(range: ChartRange, now: Date): RangeSpec {
  if (Number.isNaN(now.getTime())) throw new RangeError('resolveRange: now is an invalid date.');
  // ** Ranges resolve against the current clock. dayjs remaps years 0-99 to 19xx, so ancient dates are refused.
  if (now.getTime() < EARLIEST_NOW_MS) throw new RangeError('resolveRange: now must be 1970 or later.');
  // ** Untyped callers (URL params, persisted settings) can pass any string, including "toString".
  if (!Object.hasOwn(RANGE_WINDOWS, range)) {
    throw new RangeError(`resolveRange: unknown chart range "${range}".`);
  }
  const { timeframe, start: startOf } = RANGE_WINDOWS[range];
  const start = startOf(dayjs.utc(now))?.toDate() ?? null;
  return { range, timeframe, start, end: new Date(now.getTime()), lastSessionOnly: range === '1D' };
}

const TIMEFRAME_LABELS: Record<BarTimeframe, string> = {
  '5Min': '5-minute bars',
  '15Min': '15-minute bars',
  '30Min': '30-minute bars',
  '1Hour': 'Hourly bars',
  '1Day': 'Daily bars',
  '1Week': 'Weekly bars',
  '1Month': 'Monthly bars',
};

/**
 * Short label for UI, e.g. "5-minute bars". Throws a RangeError for an unknown timeframe, like
 * resolveRange, so a corrupt value never renders as undefined or an inherited member like `toString`.
 */
export function describeTimeframe(timeframe: BarTimeframe): string {
  if (!Object.hasOwn(TIMEFRAME_LABELS, timeframe)) {
    throw new RangeError(`describeTimeframe: unknown bar timeframe "${timeframe}".`);
  }
  return TIMEFRAME_LABELS[timeframe];
}
