import type { ConnectionState, DataStatus, Quote } from '../../domain/types';
import { EMPTY_VALUE, formatPrice, formatVolume } from '../../lib/format';

/** Presentation rules for the live quote in the detail panel. */

interface StatusView {
  label: string;
  tone: 'gain' | 'warning' | 'muted' | 'loss';
  pulse: boolean;
  /** Tooltip text explaining what the status means. */
  description: string;
}

const STATUS_VIEWS: Record<DataStatus, StatusView> = {
  live: { label: 'Live', tone: 'gain', pulse: true, description: 'Updates are arriving in real time.' },
  delayed: {
    label: 'Delayed',
    tone: 'warning',
    pulse: false,
    description: 'The provider only offers delayed data for this symbol.',
  },
  stale: {
    label: 'Stale',
    tone: 'muted',
    pulse: false,
    description: 'No recent update. Showing the last value received.',
  },
  unavailable: {
    label: 'Unavailable',
    tone: 'loss',
    pulse: false,
    description: 'No quote has been received for this symbol.',
  },
};

export function describeStatus(status: DataStatus): StatusView {
  return STATUS_VIEWS[status];
}

/** Time the quote's values describe: the last trade, else the last bid/ask update. */
export function quoteTime(quote: Quote): number | null {
  return quote.lastTradeAt ?? quote.quoteAt;
}

export interface QuoteStat {
  label: string;
  value: string;
}

function priceWithSize(price: number | null, size: number | null): string {
  if (price === null || !Number.isFinite(price)) return EMPTY_VALUE;
  return size === null ? formatPrice(price) : `${formatPrice(price)} × ${formatVolume(size)}`;
}

/** The stats grid, in display order. Missing values show as an em dash. */
export function quoteStats(quote: Quote | undefined): QuoteStat[] {
  const spread =
    quote?.bid != null && quote.ask != null && quote.ask >= quote.bid ? quote.ask - quote.bid : null;
  return [
    { label: 'Open', value: formatPrice(quote?.open) },
    { label: 'Prev close', value: formatPrice(quote?.prevClose) },
    { label: 'High', value: formatPrice(quote?.high) },
    { label: 'Low', value: formatPrice(quote?.low) },
    { label: 'Bid', value: priceWithSize(quote?.bid ?? null, quote?.bidSize ?? null) },
    { label: 'Ask', value: priceWithSize(quote?.ask ?? null, quote?.askSize ?? null) },
    { label: 'Spread', value: formatPrice(spread, quote?.last ?? quote?.bid) },
    { label: 'Volume', value: formatVolume(quote?.volume) },
  ];
}

export interface LiveLine {
  price: number;
  label: string;
  /** Drawn in a muted color: the value is no longer current. */
  muted: boolean;
}

/** The chart's live price line, or null when there is no current price to draw. */
export function liveLine(quote: Quote | undefined): LiveLine | null {
  if (quote?.last == null || !Number.isFinite(quote.last) || quote.status === 'unavailable') return null;
  return { price: quote.last, label: describeStatus(quote.status).label, muted: quote.status === 'stale' };
}

/** True while a first quote can still arrive, so a missing quote reads as loading rather than absent. */
export function awaitingQuote(state: ConnectionState): boolean {
  return state === 'connecting' || state === 'connected';
}

/** Notice shown above the quote while the feed is not connected, else null. */
export function connectionNotice(state: ConnectionState, hasQuote: boolean): string | null {
  if (state === 'connected') return null;
  if (state === 'connecting') return hasQuote ? null : 'Connecting to the feed…';
  const feed = state === 'reconnecting' ? 'Reconnecting to the feed.' : 'The feed is disconnected.';
  return hasQuote ? `${feed} Showing the last quote received.` : `${feed} No quote yet.`;
}
