import { TickMarkType, type Time } from 'lightweight-charts';
import { describeTimeframe, resolveRange } from '../../domain/chartRanges';
import type { Bar, BarTimeframe, ChartRange, HistoryResult } from '../../domain/types';
import {
  EMPTY_VALUE,
  changeDirection,
  formatChange,
  formatPercent,
  formatPrice,
  formatVolume,
} from '../../lib/format';

/**
 * Text for the price chart: axis ticks, the crosshair tooltip, the truncation note and the screen
 * reader summary. Intraday bars read in New York time (the session clock); daily and longer bars are
 * labeled at 00:00 UTC, so their dates read in UTC.
 */

const MARKET_ZONE = 'America/New_York';
const LOCALE = 'en-US';

const INTRADAY_TIMEFRAMES: ReadonlySet<BarTimeframe> = new Set(['5Min', '15Min', '30Min', '1Hour']);

export function isIntradayTimeframe(timeframe: BarTimeframe): boolean {
  return INTRADAY_TIMEFRAMES.has(timeframe);
}

function zoneFor(timeframe: BarTimeframe): string {
  return isIntradayTimeframe(timeframe) ? MARKET_ZONE : 'UTC';
}

interface RangeDetail {
  label: string;
  name: string;
}

const RANGE_DETAILS: Record<ChartRange, RangeDetail> = {
  '1D': { label: '1D', name: '1 day' },
  '1W': { label: '1W', name: '1 week' },
  '1M': { label: '1M', name: '1 month' },
  '3M': { label: '3M', name: '3 months' },
  '6M': { label: '6M', name: '6 months' },
  YTD: { label: 'YTD', name: 'Year to date' },
  '1Y': { label: '1Y', name: '1 year' },
  '5Y': { label: '5Y', name: '5 years' },
  '10Y': { label: '10Y', name: '10 years' },
  ALL: { label: 'All', name: 'All available' },
};

export function rangeLabel(range: ChartRange): string {
  return RANGE_DETAILS[range].label;
}

export function rangeName(range: ChartRange): string {
  return RANGE_DETAILS[range].name;
}

// ** The bar size depends only on the range, so any valid clock resolves it.
const ANY_NOW = new Date(Date.UTC(2026, 0, 1));

/** Bar size the backend uses for a range, known before the request completes. */
export function timeframeForRange(range: ChartRange): BarTimeframe {
  return resolveRange(range, ANY_NOW).timeframe;
}

type FormatKind = 'date' | 'dateTime' | 'monthYear' | 'time' | 'timeSeconds';

const FORMAT_OPTIONS: Record<FormatKind, Intl.DateTimeFormatOptions> = {
  date: { year: 'numeric', month: 'short', day: 'numeric' },
  dateTime: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  monthYear: { year: 'numeric', month: 'short' },
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  timeSeconds: { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
};

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

// One formatter per kind and zone: the axis formats every tick on each redraw.
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsOf(kind: FormatKind, timeZone: string, epochSeconds: number): Parts | null {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const key = `${kind}|${timeZone}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(LOCALE, { ...FORMAT_OPTIONS[kind], timeZone });
    formatters.set(key, formatter);
  }
  const parts: Parts = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/**
 * Bar time for the tooltip and the crosshair label. `time` is the bar open in epoch seconds.
 * e.g. "Oct 23, 2026 10:35 ET" (intraday), "Oct 23, 2026" (daily), "Week of Oct 19, 2026", "Oct 2026".
 */
export function formatBarTime(time: number, timeframe: BarTimeframe): string {
  if (!Number.isFinite(time)) return EMPTY_VALUE;
  const zone = zoneFor(timeframe);
  if (isIntradayTimeframe(timeframe)) {
    const p = partsOf('dateTime', zone, time);
    return p ? `${p.month ?? ''} ${p.day ?? ''}, ${p.year ?? ''} ${p.hour ?? ''}:${p.minute ?? ''} ET` : EMPTY_VALUE;
  }
  if (timeframe === '1Month') {
    const p = partsOf('monthYear', zone, time);
    return p ? `${p.month ?? ''} ${p.year ?? ''}` : EMPTY_VALUE;
  }
  const p = partsOf('date', zone, time);
  if (!p) return EMPTY_VALUE;
  const date = `${p.month ?? ''} ${p.day ?? ''}, ${p.year ?? ''}`;
  return timeframe === '1Week' ? `Week of ${date}` : date;
}

/**
 * Time-axis tick label in the chart's zone. The chart picks the tick type; returns null for
 * non-numeric times so the chart falls back to its own label.
 */
export function formatTickMark(time: Time, type: TickMarkType, timeframe: BarTimeframe): string | null {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;
  const zone = zoneFor(timeframe);
  switch (type) {
    case TickMarkType.Year:
      return partsOf('date', zone, time)?.year ?? null;
    case TickMarkType.Month:
      return partsOf('date', zone, time)?.month ?? null;
    case TickMarkType.DayOfMonth:
      return partsOf('date', zone, time)?.day ?? null;
    case TickMarkType.Time: {
      const p = partsOf('time', zone, time);
      return p ? `${p.hour ?? ''}:${p.minute ?? ''}` : null;
    }
    case TickMarkType.TimeWithSeconds: {
      const p = partsOf('timeSeconds', zone, time);
      return p ? `${p.hour ?? ''}:${p.minute ?? ''}:${p.second ?? ''}` : null;
    }
    default:
      return null;
  }
}

/** Short note when the provider returned less history than the range asks for, else null. */
export function historyStartNote(result: HistoryResult): string | null {
  const first = result.bars[0];
  if (!result.truncated || !first) return null;
  const p = partsOf('monthYear', zoneFor(result.timeframe), first.time);
  if (!p) return null;
  return `History starts ${p.month ?? ''} ${p.year ?? ''} (earliest available)`;
}

export interface BarDetails {
  time: string;
  rows: readonly { label: string; value: string }[];
  /** Change vs the previous bar's close (the bar's own open for the first bar), e.g. "+1.20 (+0.64%)". */
  change: string;
  direction: -1 | 0 | 1;
}

/** Tooltip content for the bar at `index`, or null when there is no such bar. */
export function describeBar(bars: readonly Bar[], index: number, timeframe: BarTimeframe): BarDetails | null {
  const bar = bars[index];
  if (!bar) return null;
  const base = bars[index - 1]?.close ?? bar.open;
  const change = bar.close - base;
  const percent = base === 0 ? null : (change / base) * 100;
  return {
    time: formatBarTime(bar.time, timeframe),
    rows: [
      { label: 'Open', value: formatPrice(bar.open) },
      { label: 'High', value: formatPrice(bar.high) },
      { label: 'Low', value: formatPrice(bar.low) },
      { label: 'Close', value: formatPrice(bar.close) },
      { label: 'Volume', value: formatVolume(bar.volume) },
    ],
    change: `${formatChange(change, bar.close)} (${formatPercent(percent)})`,
    direction: changeDirection(change),
  };
}

/** One sentence a screen reader announces while the keyboard moves the crosshair. */
export function announceBar(details: BarDetails): string {
  const values = details.rows.map((row) => `${row.label} ${row.value}`).join(', ');
  return `${details.time}. ${values}. Change ${details.change}.`;
}

/** Accessible description of a loaded chart: what it covers and its key prices. */
export function chartSummary(symbol: string, range: ChartRange, result: HistoryResult): string {
  const { bars, timeframe } = result;
  const first = bars[0];
  const last = bars[bars.length - 1];
  const heading = `${symbol} price history, ${rangeName(range)}, ${describeTimeframe(timeframe).toLowerCase()}`;
  if (!first || !last) return `${heading}. No bars.`;
  let high = first.high;
  let low = first.low;
  for (const bar of bars) {
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
  }
  const span = `${formatBarTime(first.time, timeframe)} to ${formatBarTime(last.time, timeframe)}`;
  const count = bars.length === 1 ? '1 bar' : `${bars.length} bars`;
  return `${heading}. ${count} from ${span}. Last close ${formatPrice(last.close)}, high ${formatPrice(high)}, low ${formatPrice(low)}.`;
}
