import type { BarTimeframe, ChartRange } from './types';

/**
 * Maps a chart range to the bar size and time window to request. Bar counts stay in the low hundreds
 * so no range fetches an oversized dataset. Shared with the future backend history endpoint.
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
 * (e.g. Mar 31 - 1 month = Feb 28/29).
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

export function resolveRange(_range: ChartRange, _now: Date): RangeSpec {
  throw new Error('not implemented');
}

/** Short label for UI, e.g. "5-minute bars". */
export function describeTimeframe(_timeframe: BarTimeframe): string {
  throw new Error('not implemented');
}
