import type { LiveQuote, LiveTrade, ProviderSnapshot } from './provider.js';

export interface LiveValues extends ProviderSnapshot {
  /** Epoch ms when a snapshot last set the day's values, or null before the first one. */
  baselineAt: number | null;
}

const empty = (symbol: string): LiveValues => ({
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
  baselineAt: null,
});

const newer = (time: number | null, than: number | null) => time !== null && (than === null || time > than);

/**
 * The latest known values for each tracked symbol, merged from snapshots and live ticks. Each group of
 * fields keeps its newest source: trade time decides the last price, quote time decides bid and ask, and
 * snapshots own the day's open, high, low, volume and previous close. So a snapshot that arrives late
 * never replaces a newer trade. Only tracked symbols are kept, which bounds memory to current demand.
 */
export class MarketState {
  private readonly values = new Map<string, LiveValues>();

  /** Tracks exactly these symbols from now on, dropping values for any others. */
  track(symbols: Iterable<string>): void {
    const wanted = new Set(symbols);
    for (const symbol of this.values.keys()) if (!wanted.has(symbol)) this.values.delete(symbol);
    for (const symbol of wanted) if (!this.values.has(symbol)) this.values.set(symbol, empty(symbol));
  }

  get(symbol: string): LiveValues | undefined {
    return this.values.get(symbol);
  }

  applySnapshot(snapshot: ProviderSnapshot, receivedAt: number): void {
    const current = this.values.get(snapshot.symbol);
    if (!current) return;
    current.open = snapshot.open;
    current.high = snapshot.high;
    current.low = snapshot.low;
    current.prevClose = snapshot.prevClose;
    current.volume = snapshot.volume;
    current.baselineAt = receivedAt;
    if (newer(snapshot.lastTradeAt, current.lastTradeAt) || current.lastTradeAt === null) {
      current.last = snapshot.last;
      current.lastTradeAt = snapshot.lastTradeAt;
    }
    if (newer(snapshot.quoteAt, current.quoteAt) || current.quoteAt === null) {
      current.bid = snapshot.bid;
      current.bidSize = snapshot.bidSize;
      current.ask = snapshot.ask;
      current.askSize = snapshot.askSize;
      current.quoteAt = snapshot.quoteAt;
    }
    extendRange(current);
  }

  applyTrade(trade: LiveTrade): void {
    const current = this.values.get(trade.symbol);
    if (!current || !newer(trade.time, current.lastTradeAt)) return;
    current.last = trade.price;
    current.lastTradeAt = trade.time;
    extendRange(current);
  }

  applyQuote(quote: LiveQuote): void {
    const current = this.values.get(quote.symbol);
    if (!current || !newer(quote.time, current.quoteAt)) return;
    current.bid = quote.bid;
    current.bidSize = quote.bidSize;
    current.ask = quote.ask;
    current.askSize = quote.askSize;
    current.quoteAt = quote.time;
  }
}

/** Keeps the day's high and low around the last price, which a newer trade can move past. */
function extendRange(values: LiveValues): void {
  if (values.last === null) return;
  if (values.high !== null && values.last > values.high) values.high = values.last;
  if (values.low !== null && values.last < values.low) values.low = values.last;
}
