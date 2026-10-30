/**
 * Display formatting for market data. Every function returns "—" (em dash) for null, undefined,
 * or non-finite input so tables never show "NaN" or "null".
 *
 * All number and date output uses Intl with an explicit 'en-US' locale so it is the same on every
 * machine. Intl rounds half away from zero on the decimal a number prints as, so 1.005 -> "1.01"
 * where Number#toFixed gives "1.00".
 */

export const EMPTY_VALUE = '—';
/** U+2212 MINUS SIGN, used for every negative number so columns of signed values line up. */
const MINUS = '−';
const LOCALE = 'en-US';

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function fixed(decimals: number): Intl.NumberFormat {
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const FIXED_2 = fixed(2);
const FIXED_4 = fixed(4);
const INTEGER_PLAIN = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, useGrouping: false });
const SIG_3 = new Intl.NumberFormat(LOCALE, { minimumSignificantDigits: 3, maximumSignificantDigits: 3 });
const SIG_3_PLAIN = new Intl.NumberFormat(LOCALE, {
  minimumSignificantDigits: 3,
  maximumSignificantDigits: 3,
  useGrouping: false,
});

/** True when a formatted magnitude shows only zeros, e.g. "0.00" or "0.0000". */
function isZeroDisplay(formatted: string): boolean {
  return !/[1-9]/.test(formatted);
}

/** Prefixes the sign for a magnitude string. Values that display as zero never get a sign. */
function signed(value: number, magnitude: string, plus: boolean): string {
  if (isZeroDisplay(magnitude)) return magnitude;
  if (value < 0) return MINUS + magnitude;
  return plus ? `+${magnitude}` : magnitude;
}

/**
 * Unsigned price magnitude: 4 decimals when it is below 1 after rounding to 4 decimals, else 2.
 * So 0.5 -> "0.5000", 0.99995 -> "1.00" (not "1.0000"), and 0 or 0.00001 -> "0.00".
 */
function priceMagnitude(abs: number): string {
  if (abs < 1) {
    const four = FIXED_4.format(abs);
    if (four !== '1.0000' && !isZeroDisplay(four)) return four;
  }
  return FIXED_2.format(abs);
}

/** 2 decimals; 4 decimals when |value| < 1. Thousands separators. e.g. 1234.5 -> "1,234.50". */
export function formatPrice(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return signed(value, priceMagnitude(Math.abs(value)), false);
}

/** Signed price change with the same decimals as formatPrice: "+1.23", "−1.23" (U+2212 minus), "0.00". */
export function formatChange(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return signed(value, priceMagnitude(Math.abs(value)), true);
}

/** Signed percent with 2 decimals: "+1.23%", "−0.40%", "0.00%". Input 1.23 means 1.23%. */
export function formatPercent(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  return `${signed(value, FIXED_2.format(Math.abs(value)), true)}%`;
}

interface VolumeUnit {
  divisor: number;
  suffix: string;
}
const LARGEST_VOLUME_UNIT: VolumeUnit = { divisor: 1e12, suffix: 'T' };
const VOLUME_UNITS: readonly VolumeUnit[] = [
  { divisor: 1e3, suffix: 'K' },
  { divisor: 1e6, suffix: 'M' },
  { divisor: 1e9, suffix: 'B' },
  LARGEST_VOLUME_UNIT,
];

/**
 * Compact volume: 950 -> "950", 12_300 -> "12.3K", 4_560_000 -> "4.56M", 7_800_000_000 -> "7.80B".
 * Below 1,000 the value is rounded to a whole number. From 1,000 up it shows 3 significant digits, and
 * moves to the next unit when rounding reaches 1,000 (999_950 -> "1.00M", never "1000K").
 */
export function formatVolume(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);

  const whole = INTEGER_PLAIN.format(abs);
  if (Number(whole) < 1000) return signed(value, whole, false);

  // ** Pick the unit after rounding, so 999_950 moves up to "1.00M" instead of showing "1000K".
  const unit =
    VOLUME_UNITS.find((u) => Number(SIG_3_PLAIN.format(abs / u.divisor)) < 1000) ?? LARGEST_VOLUME_UNIT;
  return signed(value, `${SIG_3.format(abs / unit.divisor)}${unit.suffix}`, false);
}

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

/**
 * One cached formatter per kind and explicit zone, because tables format a time in every cell.
 * The local zone is never cached so a system time-zone change shows up on the next call.
 */
function dateTimeFormat(kind: 'clock' | 'dateTime', timeZone: string | undefined): Intl.DateTimeFormat {
  const create = () =>
    new Intl.DateTimeFormat(LOCALE, {
      ...(kind === 'dateTime' ? { month: 'short', day: 'numeric' } : {}),
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone,
    });
  if (timeZone === undefined) return create();
  const key = `${kind}|${timeZone}`;
  let formatter = dateTimeFormatCache.get(key);
  if (!formatter) {
    formatter = create();
    dateTimeFormatCache.set(key, formatter);
  }
  return formatter;
}

/** Reads named parts so the output doesn't depend on locale literals (spaces, commas, separators). */
function partsOf(
  formatter: Intl.DateTimeFormat,
  date: Date,
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

function toValidDate(epochMs: number): Date | null {
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Wall-clock time "HH:mm:ss" (24h) in the given IANA zone, default America/New_York. */
export function formatClock(epochMs: number | null | undefined, timeZone = 'America/New_York'): string {
  if (!isFiniteNumber(epochMs)) return EMPTY_VALUE;
  // ** A finite number can still fall outside the Date range (|ms| > 8.64e15).
  const date = toValidDate(epochMs);
  if (!date) return EMPTY_VALUE;
  const { hour = '', minute = '', second = '' } = partsOf(dateTimeFormat('clock', timeZone), date);
  return `${hour}:${minute}:${second}`;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative age: "just now" (<2s), "5s ago", "3m ago", "2h ago", "4d ago".
 * Units are floored (59.9s -> "59s ago"). A timestamp in the future (clock skew) reads "just now".
 */
export function formatAge(epochMs: number | null | undefined, now: number): string {
  if (!isFiniteNumber(epochMs) || !isFiniteNumber(now)) return EMPTY_VALUE;
  const age = now - epochMs;
  if (age < 2 * SECOND) return 'just now';
  // ** Two finite inputs can still be too far apart for their difference to be finite.
  if (!Number.isFinite(age)) return EMPTY_VALUE;
  if (age < MINUTE) return `${Math.floor(age / SECOND)}s ago`;
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  return `${Math.floor(age / DAY)}d ago`;
}

/**
 * ISO-8601 date-time as Date#toISOString and RFC 3339 write it: a calendar date, "T", hours and
 * minutes, optional seconds and fraction, then an optional "Z" or ±HH:mm offset. Captures the year
 * (including toISOString's six-digit signed years), month and day.
 */
const ISO_DATE_TIME =
  /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/i;

/**
 * Parses an ISO-8601 date-time, or returns null. A string without an offset is local time, as in
 * ECMAScript. Out-of-range times and offsets (23:60, +24:00) are rejected by Date itself.
 */
function parseIsoDateTime(iso: string): Date | null {
  // ** Date.parse alone is too lenient: it invents dates from strings like "12" or "Tuesday 3".
  const match = ISO_DATE_TIME.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  // ** Date rolls impossible days forward (Feb 30 becomes Mar 2), so the day must survive a round trip.
  const calendarDay = new Date(0);
  calendarDay.setUTCFullYear(year, month, day);
  if (calendarDay.getUTCMonth() !== month || calendarDay.getUTCDate() !== day) return null;
  return toValidDate(Date.parse(iso));
}

/**
 * Short date-time for alert metadata, e.g. "Oct 23, 14:05:09", in the given zone (default local).
 * `iso` must be an ISO-8601 date-time such as "2026-10-23T18:05:09.000Z" (surrounding whitespace is
 * ignored). Anything else, including a date without a time or an impossible date, returns "—".
 */
export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (typeof iso !== 'string') return EMPTY_VALUE;
  const date = parseIsoDateTime(iso.trim());
  if (!date) return EMPTY_VALUE;
  const {
    month = '',
    day = '',
    hour = '',
    minute = '',
    second = '',
  } = partsOf(dateTimeFormat('dateTime', timeZone), date);
  return `${month} ${day}, ${hour}:${minute}:${second}`;
}

/** -1, 0, or 1 for coloring gain/loss. Null or non-finite input returns 0. */
export function changeDirection(value: number | null | undefined): -1 | 0 | 1 {
  if (!isFiniteNumber(value) || value === 0) return 0;
  return value > 0 ? 1 : -1;
}
