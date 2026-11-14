import type { Bar } from '../../domain/types';

/**
 * Statistics the stock page derives from daily history, since the provider has no fundamentals:
 * the 52-week range (from 1Y daily bars) and the average daily volume (from 3M daily bars).
 */

const DAY_MS = 86_400_000;

export interface PriceRange {
  low: number;
  high: number;
}

function isPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Lowest low and highest high across `bars`, widened by `extra` prices (today's live high, low and
 * last) so the current price never falls outside its own range. Null when no bar has a valid price:
 * live prices alone would pass today's range off as the whole period's.
 */
export function priceRange(bars: readonly Bar[], extra: readonly (number | null | undefined)[] = []): PriceRange | null {
  let low = Infinity;
  let high = -Infinity;
  const include = (value: number | null | undefined) => {
    if (!isPrice(value)) return;
    low = Math.min(low, value);
    high = Math.max(high, value);
  };
  for (const bar of bars) {
    include(bar.low);
    include(bar.high);
  }
  if (low > high) return null;
  extra.forEach(include);
  return { low, high };
}

/**
 * Where `price` sits in `range`, from 0 (at the low) to 1 (at the high), clamped. A flat range puts
 * the price in the middle. Null without a price or a range.
 */
export function rangePosition(price: number | null | undefined, range: PriceRange | null): number | null {
  if (!range || !isPrice(price)) return null;
  const span = range.high - range.low;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (price - range.low) / span));
}

/**
 * Mean volume of the daily bars whose day has ended by `now` (epoch ms), so today's partial bar
 * doesn't pull the average down. Null when no completed day has a valid volume.
 */
export function averageDailyVolume(bars: readonly Bar[], now: number): number | null {
  let total = 0;
  let days = 0;
  for (const bar of bars) {
    const complete = bar.time * 1000 + DAY_MS <= now;
    if (!complete || !Number.isFinite(bar.volume) || bar.volume < 0) continue;
    total += bar.volume;
    days += 1;
  }
  return days === 0 ? null : total / days;
}
