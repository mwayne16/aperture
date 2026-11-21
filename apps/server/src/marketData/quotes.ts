import type { Quote } from '@aperture/shared/marketData';
import type { ProviderSnapshot } from './provider.js';

/**
 * A quote whose newest trade or bid/ask is older than this is stale: the market is closed or the symbol
 * isn't trading. Bid/ask updates count, so a quiet crypto pair with a live order book stays live.
 */
const STALE_AFTER_MS = 15 * 60_000;
/** How late a delayed feed's data is by design; it doesn't count toward staleness. */
const FEED_DELAY_MS = 15 * 60_000;

/**
 * A quote in the API's shape. Without a last price it is 'unavailable'; with nothing new for 15 minutes,
 * 'stale'; otherwise 'delayed' on a delayed feed and 'live' on a real-time one.
 */
export function toQuote(
  symbol: string,
  snapshot: ProviderSnapshot | undefined,
  delayed: boolean,
  at: number,
): Quote {
  const last = snapshot?.last ?? null;
  const prevClose = snapshot?.prevClose ?? null;
  const change = last !== null && prevClose !== null ? last - prevClose : null;
  const newest = Math.max(snapshot?.lastTradeAt ?? -Infinity, snapshot?.quoteAt ?? -Infinity);
  const fresh = newest >= at - STALE_AFTER_MS - (delayed ? FEED_DELAY_MS : 0);
  return {
    symbol,
    last,
    lastTradeAt: snapshot?.lastTradeAt ?? null,
    bid: snapshot?.bid ?? null,
    bidSize: snapshot?.bidSize ?? null,
    ask: snapshot?.ask ?? null,
    askSize: snapshot?.askSize ?? null,
    quoteAt: snapshot?.quoteAt ?? null,
    open: snapshot?.open ?? null,
    high: snapshot?.high ?? null,
    low: snapshot?.low ?? null,
    prevClose,
    volume: snapshot?.volume ?? null,
    change,
    changePct: change !== null && prevClose !== null ? (change / prevClose) * 100 : null,
    status: last === null ? 'unavailable' : !fresh ? 'stale' : delayed ? 'delayed' : 'live',
    updatedAt: at,
  };
}
