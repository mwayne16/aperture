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

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Proleptic Gregorian, like Date itself, so year 0 is a leap year. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 1 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month] ?? 31;
}

/**
 * Builds a UTC date-time from calendar fields, or an Invalid Date outside the Date range. The day is
 * set in one step: Date.UTC maps years 0-99 to 19xx, and stepping through the 1st of the month can
 * leave the Date range near its earliest instant even when the target day is inside it.
 */
function utcDate(year: number, month: number, day: number, timeOfDay?: Date): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  if (timeOfDay) {
    date.setUTCHours(
      timeOfDay.getUTCHours(),
      timeOfDay.getUTCMinutes(),
      timeOfDay.getUTCSeconds(),
      timeOfDay.getUTCMilliseconds(),
    );
  }
  return date;
}

/** Subtracts calendar months in UTC, keeping the time of day and clamping the day to the target month. */
function subtractUtcMonths(now: Date, months: number): Date {
  const monthIndex = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12;
  return utcDate(year, month, Math.min(now.getUTCDate(), daysInMonth(year, month)), now);
}

interface RangeWindow {
  timeframe: BarTimeframe;
  /** Window start for `now`. An Invalid Date means the start is outside the Date range. */
  start: (now: Date) => Date | null;
}

const RANGE_WINDOWS: Record<ChartRange, RangeWindow> = {
  '1D': { timeframe: '5Min', start: (now) => new Date(now.getTime() - 5 * DAY_MS) },
  '1W': { timeframe: '30Min', start: (now) => new Date(now.getTime() - 7 * DAY_MS) },
  '1M': { timeframe: '1Hour', start: (now) => subtractUtcMonths(now, 1) },
  '3M': { timeframe: '1Day', start: (now) => subtractUtcMonths(now, 3) },
  '6M': { timeframe: '1Day', start: (now) => subtractUtcMonths(now, 6) },
  YTD: { timeframe: '1Day', start: (now) => utcDate(now.getUTCFullYear(), 0, 1) },
  '1Y': { timeframe: '1Day', start: (now) => subtractUtcMonths(now, 12) },
  '5Y': { timeframe: '1Week', start: (now) => subtractUtcMonths(now, 5 * 12) },
  '10Y': { timeframe: '1Month', start: (now) => subtractUtcMonths(now, 10 * 12) },
  ALL: { timeframe: '1Month', start: () => null },
};

/**
 * Resolves a chart range against `now`. `end` is a copy of `now`, so callers can't change each other's
 * dates. Throws a RangeError for an invalid `now`, an unknown range, or a window that starts before the
 * earliest representable date, instead of returning an Invalid Date.
 */
export function resolveRange(range: ChartRange, now: Date): RangeSpec {
  if (Number.isNaN(now.getTime())) throw new RangeError('resolveRange: now is an invalid date.');
  // ** Untyped callers (URL params, persisted settings) can pass any string, including "toString".
  if (!Object.hasOwn(RANGE_WINDOWS, range)) {
    throw new RangeError(`resolveRange: unknown chart range "${range}".`);
  }
  const { timeframe, start: startOf } = RANGE_WINDOWS[range];
  const start = startOf(now);
  if (start !== null && Number.isNaN(start.getTime())) {
    throw new RangeError(`resolveRange: the ${range} window starts outside the supported date range.`);
  }
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
