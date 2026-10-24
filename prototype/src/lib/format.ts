/**
 * Display formatting for market data. Every function returns "—" (em dash) for null, undefined,
 * or non-finite input so tables never show "NaN" or "null".
 */

export const EMPTY_VALUE = '—';

/** 2 decimals; 4 decimals when |value| < 1. Thousands separators. e.g. 1234.5 -> "1,234.50". */
export function formatPrice(_value: number | null | undefined): string {
  throw new Error('not implemented');
}

/** Signed price change with the same decimals as formatPrice: "+1.23", "−1.23" (U+2212 minus), "0.00". */
export function formatChange(_value: number | null | undefined): string {
  throw new Error('not implemented');
}

/** Signed percent with 2 decimals: "+1.23%", "−0.40%", "0.00%". Input 1.23 means 1.23%. */
export function formatPercent(_value: number | null | undefined): string {
  throw new Error('not implemented');
}

/** Compact volume: 950 -> "950", 12_300 -> "12.3K", 4_560_000 -> "4.56M", 7_800_000_000 -> "7.80B". */
export function formatVolume(_value: number | null | undefined): string {
  throw new Error('not implemented');
}

/** Wall-clock time "HH:mm:ss" (24h) in the given IANA zone, default America/New_York. */
export function formatClock(_epochMs: number | null | undefined, _timeZone?: string): string {
  throw new Error('not implemented');
}

/** Relative age: "just now" (<2s), "5s ago", "3m ago", "2h ago", "4d ago". */
export function formatAge(_epochMs: number | null | undefined, _now: number): string {
  throw new Error('not implemented');
}

/** Short date-time for alert metadata, e.g. "Oct 23, 14:05:09", in the given zone (default local). */
export function formatDateTime(_iso: string | null | undefined, _timeZone?: string): string {
  throw new Error('not implemented');
}

/** -1, 0, or 1 for coloring gain/loss. Null or non-finite input returns 0. */
export function changeDirection(_value: number | null | undefined): -1 | 0 | 1 {
  throw new Error('not implemented');
}
