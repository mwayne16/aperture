import type { DataStatus, Quote } from '../../domain/types';
import { roundChange, roundTo, type PriceState } from './priceModel';

/** Quote shapes the simulated backend sends, shared by the realtime feed and the snapshot endpoint. */

export function unavailableQuote(symbol: string, at: number): Quote {
  return {
    symbol,
    last: null,
    lastTradeAt: null,
    bid: null,
    bidSize: null,
    ask: null,
    askSize: null,
    quoteAt: null,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: null,
    change: null,
    changePct: null,
    status: 'unavailable',
    updatedAt: at,
  };
}

export function quoteFromState(state: PriceState, tradeAt: number, status: DataStatus, at: number): Quote {
  return {
    symbol: state.symbol,
    last: state.last,
    lastTradeAt: tradeAt,
    bid: state.bid,
    bidSize: state.bidSize,
    ask: state.ask,
    askSize: state.askSize,
    quoteAt: tradeAt,
    open: state.open,
    high: state.high,
    low: state.low,
    prevClose: state.prevClose,
    volume: state.volume,
    change: roundChange(state.last - state.prevClose),
    changePct: roundTo((state.last / state.prevClose - 1) * 100, 4),
    status,
    updatedAt: at,
  };
}
