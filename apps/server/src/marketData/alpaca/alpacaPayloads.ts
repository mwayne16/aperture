import type { Instrument } from '@aperture/shared/marketData';
import { validateSymbol } from '@aperture/shared/symbols';
import type { LiveQuote, LiveTrade, ProviderBar, ProviderSnapshot } from '../provider.js';

/**
 * Checks Alpaca payloads at the boundary. The SDK's types describe what Alpaca should send, but its
 * parsers copy values without checking them, so every field is checked here: a price must be a finite
 * positive number, a size a finite non-negative one, and a time a valid date. Anything else becomes null,
 * or drops the bar, rather than reaching a chart or an alert as a bad number.
 */

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields {
  return typeof value === 'object' && value !== null ? (value as Fields) : {};
}

function price(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function size(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function time(value: unknown): number | null {
  const ms =
    value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Alpaca has no fund flag, so funds are recognized by name, e.g. "SPDR S&P 500 ETF Trust" or "Invesco QQQ Trust, Series 1". */
const FUND_NAME = /\b(ETF|ETN)s?\b|\bTrust,? Series\b/i;

/**
 * An active asset as an instrument, or null for one the app can't quote: not tradable, listed OTC, or with
 * a symbol the shared rules reject.
 */
export function normalizeAsset(raw: unknown, crypto: boolean): Instrument | null {
  const asset = fields(raw);
  const symbol = validateSymbol(text(asset.symbol) ?? '');
  const exchange = text(asset.exchange);
  // ** IEX carries no OTC quotes, so OTC listings would only ever show as unavailable.
  if (!symbol.ok || asset.tradable !== true || exchange === null || exchange === 'OTC') return null;
  const name = text(asset.name) ?? symbol.value;
  const assetClass = crypto ? 'crypto' : FUND_NAME.test(name) ? 'etf' : 'stock';
  return { symbol: symbol.value, name, exchange, assetClass };
}

/** The valid symbols of a ranked screener list, in rank order. */
export function rankedSymbols(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    const symbol = validateSymbol(text(fields(row).symbol) ?? '');
    return symbol.ok ? [symbol.value] : [];
  });
}

/** A snapshot's latest trade, best bid and ask, today's bar and the previous close. A zero bid or ask means none. */
export function normalizeSnapshot(symbol: string, raw: unknown): ProviderSnapshot {
  const snapshot = fields(raw);
  const trade = fields(snapshot.latestTrade);
  const quote = fields(snapshot.latestQuote);
  const day = fields(snapshot.dailyBar);
  const previous = fields(snapshot.prevDailyBar);
  const bid = price(quote.bp);
  const ask = price(quote.ap);
  return {
    symbol,
    last: price(trade.p),
    lastTradeAt: time(trade.t),
    bid,
    bidSize: bid === null ? null : size(quote.bs),
    ask,
    askSize: ask === null ? null : size(quote.as),
    quoteAt: time(quote.t),
    open: price(day.o),
    high: price(day.h),
    low: price(day.l),
    prevClose: price(previous.c),
    volume: size(day.v),
  };
}

/** One bar from the SDK's normalized shape, or null when any value is missing or malformed. */
export function normalizeBar(raw: unknown): ProviderBar | null {
  const bar = fields(raw);
  const at = time(bar.timestamp);
  const open = price(bar.open);
  const high = price(bar.high);
  const low = price(bar.low);
  const close = price(bar.close);
  const volume = size(bar.volume);
  if (at === null || open === null || high === null || low === null || close === null || volume === null) {
    return null;
  }
  return { time: at, open, high, low, close, volume };
}

/** A streamed trade from the SDK's mapped shape, or null when its symbol, price or time is malformed. */
export function normalizeTrade(raw: unknown): LiveTrade | null {
  const trade = fields(raw);
  const symbol = text(trade.symbol);
  const tradePrice = price(trade.price);
  const at = time(trade.timestamp);
  return symbol === null || tradePrice === null || at === null
    ? null
    : { symbol, price: tradePrice, time: at };
}

/** A streamed quote from the SDK's mapped shape, or null when its symbol or time is malformed. A zero side means none. */
export function normalizeQuote(raw: unknown): LiveQuote | null {
  const quote = fields(raw);
  const symbol = text(quote.symbol);
  const at = time(quote.timestamp);
  if (symbol === null || at === null) return null;
  const bid = price(quote.bidPrice);
  const ask = price(quote.askPrice);
  return {
    symbol,
    bid,
    bidSize: bid === null ? null : size(quote.bidSize),
    ask,
    askSize: ask === null ? null : size(quote.askSize),
    time: at,
  };
}
