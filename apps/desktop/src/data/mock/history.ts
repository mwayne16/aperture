import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { Bar, BarTimeframe } from '../../domain/types';
import { roundPrice } from './priceModel';
import { createPrng, hashString } from './random';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Deterministic simulated price history.
 *
 * - Intraday bars exist only on weekdays during the regular session, 09:30-16:00 America/New_York
 *   (daylight saving included). Market holidays are not modeled.
 * - Continuous markets (crypto) have bars around the clock, every day; their 1D range is the last
 *   24 hours rather than the last session.
 * - Daily bars are weekdays only; weekly bars are labeled by their Monday and monthly bars by the
 *   1st, all at 00:00 UTC. A period is included once its first session has opened.
 * - Every bar's shape is seeded by symbol + timeframe + bar time, so a bar looks the same on every
 *   request; the whole series is then scaled so the final close equals the current simulated price.
 * - History starts no earlier than the provider retention floor (2016-01-01) or Jan 1 of the listing
 *   year, whichever is later. `truncated` is true when the requested window starts before that, or
 *   for "earliest available" (null start) when the listing predates the retention floor.
 */

export const RETENTION_FLOOR_MS = Date.UTC(2016, 0, 1);
const SESSION_MINUTES = 390;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MARKET_ZONE = 'America/New_York';

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
function tradingDaysPerBar(timeframe: BarTimeframe, continuous: boolean): number {
  const minutes = INTRADAY_MINUTES[timeframe];
  if (minutes !== undefined) return minutes / (continuous ? 24 * 60 : SESSION_MINUTES);
  if (timeframe === '1Week') return 5;
  if (timeframe === '1Month') return 21;
  return 1;
}

/*
 * Calendar days are UTC-midnight Dayjs values, which is also how daily and longer bars are labeled.
 * Only the session open is converted to New York time.
 */

function utcDay(ms: number): Dayjs {
  return dayjs.utc(ms).startOf('day');
}

/** The New York calendar date of an instant. */
function newYorkDay(ms: number): Dayjs {
  return dayjs.utc(dayjs(ms).tz(MARKET_ZONE).format('YYYY-MM-DD'));
}

/** Epoch ms of the 09:30 New York open on a calendar day. */
function sessionOpenMs(day: Dayjs): number {
  return dayjs.tz(`${day.format('YYYY-MM-DD')} 09:30`, MARKET_ZONE).valueOf();
}

function isWeekday(day: Dayjs): boolean {
  const weekday = day.day();
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

function periodSlot(label: Dayjs): Slot {
  return { time: label.unix(), session: label.valueOf(), sessionPosition: 0 };
}

function intradaySlots(stepMinutes: number, startMs: number, endMs: number): Slot[] {
  const slots: Slot[] = [];
  const last = newYorkDay(endMs);
  for (let day = newYorkDay(startMs); !day.isAfter(last); day = day.add(1, 'day')) {
    if (!isWeekday(day)) continue;
    const open = sessionOpenMs(day);
    for (let minute = 0; minute < SESSION_MINUTES; minute += stepMinutes) {
      const barStart = open + minute * MINUTE_MS;
      if (barStart < startMs || barStart > endMs) continue;
      slots.push({
        time: barStart / 1000,
        session: day.valueOf(),
        sessionPosition: minute / SESSION_MINUTES,
      });
    }
  }
  return slots;
}

function dailySlots(startMs: number, endMs: number): Slot[] {
  const slots: Slot[] = [];
  for (let day = utcDay(startMs); day.valueOf() <= endMs; day = day.add(1, 'day')) {
    if (isWeekday(day) && sessionOpenMs(day) <= endMs) slots.push(periodSlot(day));
  }
  return slots;
}

/** Every bar slot of a market that trades around the clock, aligned to whole steps in UTC. */
function continuousSlots(stepMinutes: number, startMs: number, endMs: number): Slot[] {
  const step = stepMinutes * MINUTE_MS;
  const slots: Slot[] = [];
  for (let time = Math.ceil(startMs / step) * step; time <= endMs; time += step) {
    const day = utcDay(time).valueOf();
    slots.push({ time: time / 1000, session: day, sessionPosition: (time - day) / DAY_MS });
  }
  return slots;
}

function weeklySlots(startMs: number, endMs: number, continuous: boolean): Slot[] {
  const slots: Slot[] = [];
  const start = utcDay(startMs);
  // Monday of the week containing the start (Sunday belongs to the week before).
  let monday = start.subtract((start.day() + 6) % 7, 'day');
  for (; monday.valueOf() <= endMs; monday = monday.add(7, 'day')) {
    if (continuous || sessionOpenMs(monday) <= endMs) slots.push(periodSlot(monday));
  }
  return slots;
}

function monthlySlots(startMs: number, endMs: number, continuous: boolean): Slot[] {
  const slots: Slot[] = [];
  for (let month = dayjs.utc(startMs).startOf('month'); month.valueOf() <= endMs; month = month.add(1, 'month')) {
    if (continuous) {
      slots.push(periodSlot(month));
      continue;
    }
    let firstSession = month;
    while (!isWeekday(firstSession)) firstSession = firstSession.add(1, 'day');
    if (sessionOpenMs(firstSession) <= endMs) slots.push(periodSlot(month));
  }
  return slots;
}

export interface HistoryRequest {
  symbol: string;
  timeframe: BarTimeframe;
  /** Inclusive window start, or null for the earliest available. */
  start: Date | null;
  end: Date;
  /** Keep only the most recent session (1D), or the last 24 hours for a continuous market. */
  lastSessionOnly: boolean;
  /** True for markets that trade around the clock (crypto). */
  continuous: boolean;
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

  const { continuous } = request;
  const stepMinutes = INTRADAY_MINUTES[timeframe];
  let slots: Slot[];
  if (stepMinutes !== undefined && continuous) {
    slots = continuousSlots(stepMinutes, startMs, endMs);
    if (request.lastSessionOnly) slots = slots.filter((s) => s.time * 1000 > endMs - DAY_MS);
  } else if (stepMinutes !== undefined) {
    slots = intradaySlots(stepMinutes, startMs, endMs);
    if (request.lastSessionOnly && slots.length > 0) {
      const lastSession = slots[slots.length - 1]?.session;
      slots = slots.filter((s) => s.session === lastSession);
    }
  } else {
    // Period bars are included by date: the period containing the window start counts, but nothing
    // before the available-data floor does.
    const windowStart = utcDay(startMs).valueOf();
    if (timeframe === '1Week') slots = weeklySlots(windowStart, endMs, continuous);
    else if (timeframe === '1Month') slots = monthlySlots(windowStart, endMs, continuous);
    else if (continuous) slots = continuousSlots(24 * 60, windowStart, endMs);
    else slots = dailySlots(windowStart, endMs);
    slots = slots.filter((s) => s.time * 1000 >= availableFrom);
  }
  if (slots.length === 0) return { bars: [], truncated };

  const days = tradingDaysPerBar(timeframe, continuous);
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
    // U-shaped intraday volume: heavier near the open and the close. Continuous markets stay flat.
    const profile = intraday && !continuous ? 0.6 + 1.6 * (2 * slot.sessionPosition - 1) ** 2 : 1;
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
