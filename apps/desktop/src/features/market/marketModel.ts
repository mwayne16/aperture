import type { ConnectionInfo, ConnectionState, DataStatus, Quote } from '../../domain/types';

/** Pure rules behind the market table: ordering, keyboard navigation, flashes and status display. */

/** Returns the list with `symbol` moved one place up (-1) or down (+1), or null when it can't move. */
export function moveSymbol(symbols: readonly string[], symbol: string, delta: -1 | 1): string[] | null {
  const from = symbols.indexOf(symbol);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= symbols.length) return null;
  const next = [...symbols];
  next.splice(from, 1);
  next.splice(to, 0, symbol);
  return next;
}

/**
 * Where `value` sits between the day's `low` and `high`, from 0 to 1, clamped to the ends. A flat
 * day puts it in the middle. Null when any value is missing or the range is inverted.
 */
export function rangePosition(
  low: number | null | undefined,
  high: number | null | undefined,
  value: number | null | undefined,
): number | null {
  if (!isFinite(low) || !isFinite(high) || !isFinite(value) || high < low) return null;
  if (high === low) return 0.5;
  return Math.min(1, Math.max(0, (value - low) / (high - low)));
}

function isFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The row that should take focus after `symbol` is removed: the next one, else the previous one. */
export function neighborAfterRemoval(symbols: readonly string[], symbol: string): string | null {
  const index = symbols.indexOf(symbol);
  if (index < 0) return null;
  return symbols[index + 1] ?? symbols[index - 1] ?? null;
}

export type FlashDirection = 'up' | 'down';

/** Which way a price moved, or null when there is nothing to flash (first value, unchanged, missing). */
export function flashDirection(previous: number | null, next: number | null): FlashDirection | null {
  if (previous === null || next === null || !Number.isFinite(previous) || !Number.isFinite(next)) return null;
  if (next > previous) return 'up';
  if (next < previous) return 'down';
  return null;
}

/** Shortest time between two flashes of one cell, measured in trade time. */
const FLASH_MIN_INTERVAL_MS = 2000;

/**
 * Whether a price change at `tradedAt` may start a new flash. Busy symbols trade several times a
 * second, and flashing on every trade would keep the cell colored and hard to read.
 */
export function flashIsDue(lastFlashAt: number | null, tradedAt: number | null): boolean {
  if (lastFlashAt === null || tradedAt === null) return true;
  return tradedAt - lastFlashAt >= FLASH_MIN_INTERVAL_MS;
}

type StatusTone = 'gain' | 'warning' | 'accent' | 'muted';

interface StatusView {
  label: string;
  tone: StatusTone;
  /** Values are kept but greyed, because they may no longer reflect the market. */
  dimmed: boolean;
}

const STATUS_VIEWS: Readonly<Record<DataStatus, StatusView>> = {
  live: { label: 'Live', tone: 'gain', dimmed: false },
  delayed: { label: 'Delayed', tone: 'accent', dimmed: false },
  stale: { label: 'Stale', tone: 'warning', dimmed: true },
  unavailable: { label: 'Unavailable', tone: 'muted', dimmed: true },
};

/**
 * How a row presents its data status. Without a quote, the row is waiting while the feed is (or is
 * about to be) connected, and has no data otherwise.
 */
export function quoteStatusView(quote: Quote | undefined, connection: ConnectionState): StatusView {
  if (quote) return STATUS_VIEWS[quote.status];
  const waiting = connection === 'connecting' || connection === 'connected';
  return { label: waiting ? 'Waiting' : 'No data', tone: 'muted', dimmed: true };
}

/** When the market data in a quote is from: the last trade, else the last quote. */
export function quoteDataTime(quote: Quote | undefined): number | null {
  if (!quote) return null;
  return quote.lastTradeAt ?? quote.quoteAt;
}

interface ConnectionNotice {
  title: string;
  detail: string | null;
  /** Epoch ms of the next reconnect attempt, for a countdown. */
  retryAt: number | null;
}

/**
 * The banner shown while the feed is not connected, or null when none is needed. Before the first
 * connection nothing can be stale yet, so the startup states show no banner.
 */
export function connectionNotice(info: ConnectionInfo): ConnectionNotice | null {
  if (info.state === 'connected') return null;
  const started = info.lastMessageAt !== null || info.error !== null || info.reconnectAttempt > 0;
  if (!started && info.state !== 'reconnecting') return null;
  const title =
    info.state === 'reconnecting'
      ? `Connection to ${info.feedName} lost. Prices may be stale.`
      : info.state === 'connecting'
        ? `Connecting to ${info.feedName}. Prices may be stale.`
        : `Disconnected from ${info.feedName}. Prices may be stale.`;
  return {
    title,
    detail: info.error,
    retryAt: info.state === 'reconnecting' ? info.nextRetryAt : null,
  };
}

/**
 * "Retrying in 4s" for a countdown, or "Retrying now" in the last second. Whole seconds round down,
 * so a shared clock that is up to one tick behind still shows the delay that was announced.
 */
export function retryCountdown(retryAt: number, now: number): string {
  const seconds = Math.floor((retryAt - now) / 1000);
  return seconds >= 1 ? `Retrying in ${seconds}s` : 'Retrying now';
}
