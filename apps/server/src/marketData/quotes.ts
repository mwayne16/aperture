import type { Quote } from '@aperture/shared/marketData';
import type { ProviderSnapshot } from './provider.js';

/** A quote in the API's shape. Without a last price it is 'unavailable'; on a delayed feed, 'delayed'. */
export function toQuote(
  symbol: string,
  snapshot: ProviderSnapshot | undefined,
  delayed: boolean,
  at: number,
): Quote {
  const last = snapshot?.last ?? null;
  const prevClose = snapshot?.prevClose ?? null;
  const change = last !== null && prevClose !== null ? last - prevClose : null;
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
    status: last === null ? 'unavailable' : delayed ? 'delayed' : 'live',
    updatedAt: at,
  };
}
