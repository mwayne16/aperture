import {
  ColorType,
  CrosshairMode,
  LineStyle,
  type AutoscaleInfo,
  type CandlestickData,
  type CandlestickSeriesPartialOptions,
  type ChartOptions,
  type DeepPartial,
  type HistogramData,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { ThemeColors } from '../../components/ui/theme';
import type { Bar } from '../../domain/types';

/** Mapping from history bars and theme tokens to lightweight-charts data and options. */

/**
 * Bars the chart can draw: finite values only, sorted by time with one bar per time.
 * The chart throws on unordered or duplicate times, so a bad provider response must not reach it.
 */
export function chartableBars(bars: readonly Bar[]): readonly Bar[] {
  const valid = (bar: Bar) =>
    [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every((value) => Number.isFinite(value));
  const ordered = bars.every((bar, i) => valid(bar) && (i === 0 || bar.time > (bars[i - 1]?.time ?? -Infinity)));
  if (ordered) return bars;
  const byTime = new Map<number, Bar>();
  for (const bar of bars) if (valid(bar)) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function toCandles(bars: readonly Bar[]): CandlestickData<UTCTimestamp>[] {
  return bars.map((bar) => ({
    time: bar.time as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));
}

export function toVolume(bars: readonly Bar[], palette: ChartPalette): HistogramData<UTCTimestamp>[] {
  return bars.map((bar) => ({
    time: bar.time as UTCTimestamp,
    value: bar.volume,
    color: bar.close >= bar.open ? palette.volumeUp : palette.volumeDown,
  }));
}

/** Index of the bar opening at `time` (bars sorted by time), or -1. */
export function findBarIndex(bars: readonly Bar[], time: number): number {
  let low = 0;
  let high = bars.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const midTime = bars[mid]?.time ?? 0;
    if (midTime === time) return mid;
    if (midTime < time) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The color at the given opacity. Tokens are hex, so hex is converted to rgba; any other format is
 * returned unchanged rather than guessed at.
 */
export function withAlpha(color: string, alpha: number): string {
  const match = HEX_COLOR.exec(color.trim());
  if (!match?.[1]) return color;
  const hex = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r ?? 0}, ${g ?? 0}, ${b ?? 0}, ${alpha})`;
}

export interface ChartPalette {
  background: string;
  text: string;
  grid: string;
  border: string;
  crosshair: string;
  labelBackground: string;
  up: string;
  down: string;
  volumeUp: string;
  volumeDown: string;
  live: string;
  liveText: string;
  stale: string;
}

const VOLUME_ALPHA = 0.38;

export function chartPalette(colors: ThemeColors): ChartPalette {
  return {
    background: colors.bgPanel,
    text: colors.textMuted,
    grid: colors.borderSubtle,
    border: colors.border,
    crosshair: colors.textFaint,
    labelBackground: colors.borderStrong,
    up: colors.gain,
    down: colors.loss,
    volumeUp: withAlpha(colors.gain, VOLUME_ALPHA),
    volumeDown: withAlpha(colors.loss, VOLUME_ALPHA),
    live: colors.accent,
    liveText: colors.textOnAccent,
    stale: colors.textMuted,
  };
}

/** Widens the autoscaled price range to include `price`, so the live line never falls off the chart. */
export function includePrice(info: AutoscaleInfo | null, price: number | null): AutoscaleInfo | null {
  if (price === null || !Number.isFinite(price) || !info?.priceRange) return info;
  const { minValue, maxValue } = info.priceRange;
  return { ...info, priceRange: { minValue: Math.min(minValue, price), maxValue: Math.max(maxValue, price) } };
}

export function chartThemeOptions(palette: ChartPalette, fontFamily: string | undefined): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: palette.background },
      textColor: palette.text,
      fontSize: 11,
      ...(fontFamily ? { fontFamily } : {}),
    },
    grid: {
      vertLines: { color: palette.grid },
      horzLines: { color: palette.grid },
    },
    rightPriceScale: { borderColor: palette.border },
    timeScale: { borderColor: palette.border },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: palette.crosshair, style: LineStyle.Dotted, labelBackgroundColor: palette.labelBackground },
      horzLine: { color: palette.crosshair, style: LineStyle.Dotted, labelBackgroundColor: palette.labelBackground },
    },
  };
}

export function candleOptions(palette: ChartPalette): CandlestickSeriesPartialOptions {
  return {
    upColor: palette.up,
    downColor: palette.down,
    wickUpColor: palette.up,
    wickDownColor: palette.down,
    borderVisible: false,
  };
}

interface Size {
  width: number;
  height: number;
}

const TOOLTIP_GAP = 14;

/**
 * Tooltip position next to the crosshair point. It sits right of and below the point, flips to the
 * other side near the right or bottom edge, and stays inside the chart.
 */
export function placeTooltip(point: { x: number; y: number }, area: Size, tooltip: Size): { left: number; top: number } {
  const right = point.x + TOOLTIP_GAP;
  const left = right + tooltip.width <= area.width ? right : point.x - TOOLTIP_GAP - tooltip.width;
  const below = point.y + TOOLTIP_GAP;
  const top = below + tooltip.height <= area.height ? below : point.y - TOOLTIP_GAP - tooltip.height;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(value, Math.max(0, max)));
  return { left: clamp(left, area.width - tooltip.width), top: clamp(top, area.height - tooltip.height) };
}
