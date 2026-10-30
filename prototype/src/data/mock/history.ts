import type { Bar, BarTimeframe } from '../../domain/types';
import { roundPrice } from './priceModel';
import { createPrng, hashString } from './random';

/**
 * Deterministic simulated price history.
 *
 * - Intraday bars exist only on weekdays during the regular session, 09:30-16:00 America/New_York
 *   (US daylight-saving rules since 2007). Market holidays are not modeled.
 * - Daily bars are weekdays only; weekly bars are labeled by their Monday and monthly bars by the
 *   1st, all at 00:00 UTC. A period is included once its first session has opened.
 * - Every bar's shape is seeded by symbol + timeframe + bar time, so a bar looks the same on every
 *   request; the whole series is then scaled so the final close equals the current simulated price.
 * - History starts no earlier than the provider retention floor (2016-01-01) or Jan 1 of the listing
 *   year, whichever is later. `truncated` is true when the requested window starts before that, or
 *   for "earliest available" (null start) when the listing predates the retention floor.
 */

export const RETENTION_FLOOR_MS = Date.UTC(2016, 0, 1);
export const SESSION_MINUTES = 390;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Typical daily log-return standard deviation at volatility 1 (about 25% a year). */
const DAILY_SIGMA = 0.016;
/** Mild upward drift (about 8% a year) so long histories trend up into the present price. */
const DAILY_DRIFT = 0.08 / 252;

const INTRADAY_MINUTES: Partial<Record<BarTimeframe, number>> = {
  '5Min': 5,
  '15Min': 15,
  '30Min': 30,
  '1Hour': 60,
};

/** Trading days a bar of this timeframe covers (fractional for intraday bars). */
function tradingDaysPerBar(timeframe: BarTimeframe): number {
  const minutes = INTRADAY_MINUTES[timeframe];
  if (minutes !== undefined) return minutes / SESSION_MINUTES;
  if (timeframe === '1Week') return 5;
  if (timeframe === '1Month') return 21;
  return 1;
}

interface CalendarDate {
  year: number;
  /** 0-based. */
  month: number;
  day: number;
}

/** True when US Eastern daylight time applies on this calendar date (second Sunday in March to first Sunday in November). */
export function isUsDst(year: number, month: number, day: number): boolean {
  if (month < 2 || month > 10) return false;
  if (month > 2 && month < 10) return true;
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstWeekday) % 7);
  return month === 2 ? day >= firstSunday + 7 : day < firstSunday;
}

/** Epoch ms of 09:30 America/New_York on a calendar date. */
export function sessionOpenMs({ year, month, day }: CalendarDate): number {
  return Date.UTC(year, month, day, 9, 30) + (isUsDst(year, month, day) ? 4 : 5) * HOUR_MS;
}

function toDate(ms: number): CalendarDate {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/** Calendar date in America/New_York for an instant. */
export function newYorkDate(ms: number): CalendarDate {
  const standard = toDate(ms - 5 * HOUR_MS);
  return isUsDst(standard.year, standard.month, standard.day) ? toDate(ms - 4 * HOUR_MS) : standard;
}

function addDays({ year, month, day }: CalendarDate, days: number): CalendarDate {
  return toDate(Date.UTC(year, month, day + days));
}

function utcMidnight({ year, month, day }: CalendarDate): number {
  return Date.UTC(year, month, day);
}

function isWeekday(date: CalendarDate): boolean {
  const weekday = new Date(utcMidnight(date)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

interface Slot {
  /** Bar time in epoch seconds. */
  time: number;
  /** Trading session (NY date key) for intraday bars. */
  session: number;
  /** Position within the session, 0-1, for the intraday volume profile. */
  sessionPosition: number;
}

function intradaySlots(stepMinutes: number, startMs: number, endMs: number): Slot[] {
  const slots: Slot[] = [];
  const last = utcMidnight(newYorkDate(endMs));
  for (let date = newYorkDate(startMs); utcMidnight(date) <= last; date = addDays(date, 1)) {
    if (!isWeekday(date)) continue;
    const open = sessionOpenMs(date);
    for (let minute = 0; minute < SESSION_MINUTES; minute += stepMinutes) {
      const barStart = open + minute * MINUTE_MS;
      if (barStart < startMs || barStart > endMs) continue;
      slots.push({
        time: barStart / 1000,
        session: utcMidnight(date),
        sessionPosition: minute / SESSION_MINUTES,
      });
    }
  }
  return slots;
}

function dailySlots(startMs: number, endMs: number): Slot[] {
  const slots: Slot[] = [];
  for (let date = toDate(startMs); utcMidnight(date) <= endMs; date = addDays(date, 1)) {
    if (!isWeekday(date) || sessionOpenMs(date) > endMs) continue;
    const label = utcMidnight(date);
    slots.push({ time: label / 1000, session: label, sessionPosition: 0 });
  }
  return slots;
}

function weeklySlots(startMs: number, endMs: number): Slot[] {
  const slots: Slot[] = [];
  const startDate = toDate(startMs);
  const weekday = new Date(utcMidnight(startDate)).getUTCDay();
  // Monday of the week containing the start (Sunday belongs to the week before).
  let monday = addDays(startDate, -((weekday + 6) % 7));
  for (; utcMidnight(monday) <= endMs; monday = addDays(monday, 7)) {
    if (sessionOpenMs(monday) > endMs) continue;
    const label = utcMidnight(monday);
    slots.push({ time: label / 1000, session: label, sessionPosition: 0 });
  }
  return slots;
}

function monthlySlots(startMs: number, endMs: number): Slot[] {
  const slots: Slot[] = [];
  const start = toDate(startMs);
  for (let index = start.year * 12 + start.month; ; index++) {
    const year = Math.floor(index / 12);
    const month = index % 12;
    const label = Date.UTC(year, month, 1);
    if (label > endMs) break;
    let firstSession: CalendarDate = { year, month, day: 1 };
    while (!isWeekday(firstSession)) firstSession = addDays(firstSession, 1);
    if (sessionOpenMs(firstSession) > endMs) continue;
    slots.push({ time: label / 1000, session: label, sessionPosition: 0 });
  }
  return slots;
}

function floorToUtcDay(ms: number): number {
  return utcMidnight(toDate(ms));
}

export interface HistoryRequest {
  symbol: string;
  timeframe: BarTimeframe;
  /** Inclusive window start, or null for the earliest available. */
  start: Date | null;
  end: Date;
  /** Keep only the most recent session (1D). */
  lastSessionOnly: boolean;
  listedYear: number;
  volatility: number;
  averageVolume: number;
  /** Current simulated price; the final close equals it. */
  lastPrice: number;
}

export interface GeneratedHistory {
  bars: Bar[];
  truncated: boolean;
}

/** Earliest instant the simulated provider has data for. */
export function availableFromMs(listedYear: number): number {
  return Math.max(RETENTION_FLOOR_MS, Date.UTC(listedYear, 0, 1));
}

export function generateHistory(request: HistoryRequest): GeneratedHistory {
  const { symbol, timeframe, start, end } = request;
  const endMs = end.getTime();
  const availableFrom = availableFromMs(request.listedYear);
  const truncated =
    start === null
      ? Date.UTC(request.listedYear, 0, 1) < RETENTION_FLOOR_MS
      : start.getTime() < availableFrom;
  const startMs = Math.max(start?.getTime() ?? availableFrom, availableFrom);
  // Invalid dates would make the period loops run forever; an empty window is the safe answer.
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return { bars: [], truncated };

  const stepMinutes = INTRADAY_MINUTES[timeframe];
  let slots: Slot[];
  if (stepMinutes !== undefined) {
    slots = intradaySlots(stepMinutes, startMs, endMs);
    if (request.lastSessionOnly && slots.length > 0) {
      const lastSession = slots[slots.length - 1]?.session;
      slots = slots.filter((s) => s.session === lastSession);
    }
  } else {
    // Period bars are included by date: the period containing the window start counts, but nothing
    // before the available-data floor does.
    const windowStart = floorToUtcDay(startMs);
    if (timeframe === '1Week') slots = weeklySlots(windowStart, endMs);
    else if (timeframe === '1Month') slots = monthlySlots(windowStart, endMs);
    else slots = dailySlots(windowStart, endMs);
    slots = slots.filter((s) => s.time * 1000 >= availableFrom);
  }
  if (slots.length === 0) return { bars: [], truncated };

  const days = tradingDaysPerBar(timeframe);
  const sigma = DAILY_SIGMA * request.volatility * Math.sqrt(days);
  const drift = DAILY_DRIFT * days;
  const intraday = stepMinutes !== undefined;

  // Unscaled path starting at 1.
  const raw: { open: number; high: number; low: number; close: number; volume: number }[] = [];
  let previousClose = 1;
  for (const slot of slots) {
    const rng = createPrng(hashString(`${symbol}|${timeframe}|${slot.time}`));
    const gap = intraday ? 0 : sigma * 0.15 * rng.normal();
    const open = previousClose * Math.exp(gap);
    const close = open * Math.exp(drift + sigma * rng.normal());
    const high = Math.max(open, close) * Math.exp(Math.abs(rng.normal()) * sigma * 0.4);
    const low = Math.min(open, close) * Math.exp(-Math.abs(rng.normal()) * sigma * 0.4);
    // U-shaped intraday volume: heavier near the open and the close.
    const profile = intraday ? 0.6 + 1.6 * (2 * slot.sessionPosition - 1) ** 2 : 1;
    const volume = Math.round(request.averageVolume * days * profile * (0.6 + 0.8 * rng.next()));
    raw.push({ open, high, low, close, volume });
    previousClose = close;
  }

  const finalClose = raw[raw.length - 1]?.close ?? 1;
  const scale = request.lastPrice / finalClose;
  const bars: Bar[] = raw.map((r, i) => {
    const open = roundPrice(r.open * scale);
    const close = i === raw.length - 1 ? roundPrice(request.lastPrice) : roundPrice(r.close * scale);
    return {
      time: slots[i]?.time ?? 0,
      open,
      high: Math.max(roundPrice(r.high * scale), open, close),
      low: Math.min(roundPrice(r.low * scale), open, close),
      close,
      volume: Math.max(0, r.volume),
    };
  });
  return { bars, truncated };
}
