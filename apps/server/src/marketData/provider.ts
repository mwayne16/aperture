import type { BarTimeframe, Instrument } from '@aperture/shared/marketData';

/**
 * The market-data port. Every service that needs prices, history or search depends on this interface,
 * never on a vendor SDK, so changing data source means writing one adapter and changing
 * `MARKET_DATA_PROVIDER`. An adapter maps vendor payloads into these types and validates them at its
 * boundary; its limits are data, so the services built on it adapt to whichever provider is active.
 */

/** Providers the server can be configured with. Add an id here together with its adapter. */
export const MARKET_DATA_PROVIDERS = ['alpaca'] as const;

export type MarketDataProviderId = (typeof MARKET_DATA_PROVIDERS)[number];

/** Crypto symbols are pairs such as "BTC/USD"; stocks and ETFs never contain a slash. */
export const isCryptoSymbol = (symbol: string) => symbol.includes('/');

/** Usage limits of the provider's plan. Shared services stay inside them for any provider. */
export interface ProviderLimits {
  /** REST requests allowed per minute; the adapter throttles itself below it. */
  requestsPerMinute: number;
  /** Live symbols one stream connection may subscribe to, per asset stream. Null when unlimited. */
  streamSymbolsPerConnection: { stocks: number | null; crypto: number | null };
  /** Stream connections allowed per endpoint for the same credentials. */
  streamConnections: number;
  /** Earliest instant the provider keeps bar history for, per asset class, in epoch ms. */
  historyStartMs: { stocks: number; crypto: number };
}

/** The latest values the provider has for one symbol. Any value it doesn't have, or sent malformed, is null. */
export interface ProviderSnapshot {
  symbol: string;
  last: number | null;
  lastTradeAt: number | null;
  bid: number | null;
  bidSize: number | null;
  ask: number | null;
  askSize: number | null;
  quoteAt: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
}

export interface ProviderBar {
  /** Epoch ms of the bar's start. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** History for several symbols in one request, so a page of sparklines costs one call, not one each. */
export interface BarsRequest {
  symbols: readonly string[];
  timeframe: BarTimeframe;
  /** Inclusive start, or null for the earliest history the provider keeps. */
  start: Date | null;
  end: Date;
}

/** Today's top stocks by percent move and by volume, as symbols in rank order. */
export interface ProviderMovers {
  gainers: string[];
  losers: string[];
  mostActive: string[];
  /** Epoch ms when the provider computed the ranking. */
  asOf: number;
}

/** A live trade from a stream. */
export interface LiveTrade {
  symbol: string;
  price: number;
  /** Epoch ms of the trade. */
  time: number;
}

/** A live best bid and ask from a stream. A side without an active order is null. */
export interface LiveQuote {
  symbol: string;
  bid: number | null;
  bidSize: number | null;
  ask: number | null;
  askSize: number | null;
  /** Epoch ms of the quote. */
  time: number;
}

/** The provider's live connections: one for stocks and ETFs, one for crypto. */
export type StreamChannel = 'stocks' | 'crypto';

export const STREAM_CHANNELS = ['stocks', 'crypto'] as const satisfies readonly StreamChannel[];

export interface StreamStatus {
  channel: StreamChannel;
  /** 'idle' until the channel first has symbols to stream. */
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  /** The reconnect attempt under way (from 1), or 0. */
  reconnectAttempt: number;
  /** Why the connection failed or closed, in words safe to show and log. Null while healthy. */
  error: string | null;
  /** False when trying again can't help until the configuration changes, e.g. rejected API keys. */
  retryable: boolean;
}

export interface StreamHandlers {
  onTrade(trade: LiveTrade): void;
  onQuote(quote: LiveQuote): void;
  onStatus(status: StreamStatus): void;
  /** The symbols the provider confirmed on a channel. Only confirmed symbols are live. */
  onSubscribed(channel: StreamChannel, symbols: string[]): void;
}

/** Live trades and quotes over the provider's connections, one per channel. */
export interface MarketStream {
  /** Streams exactly these symbols. A channel connects the first time it has symbols. */
  setSymbols(symbols: Readonly<Record<StreamChannel, readonly string[]>>): void;
  /** Connects again any channel that stopped retrying. */
  reconnect(): void;
  close(): void;
}

/**
 * What a market-data adapter implements. List methods take many symbols at once so callers can batch
 * requests inside the provider's rate limit. Failures reject with ProviderError.
 */
export interface MarketDataProvider {
  readonly id: MarketDataProviderId;
  readonly limits: ProviderLimits;
  /** Name of the data feed for display, e.g. "Alpaca IEX". */
  readonly feedLabel: string;
  /** True when the feed's prices arrive late (e.g. 15 minutes), so quotes are marked delayed. */
  readonly delayed: boolean;
  /** Every active instrument, for search and browsing. Callers cache it; it changes at most daily. */
  listInstruments(): Promise<Instrument[]>;
  /** Snapshots for the symbols the provider knows. Unknown symbols are left out. */
  getSnapshots(symbols: readonly string[]): Promise<ProviderSnapshot[]>;
  /** Bars per symbol, oldest first. Symbols without history are left out. */
  getBars(request: BarsRequest): Promise<ReadonlyMap<string, ProviderBar[]>>;
  getMovers(limit: number): Promise<ProviderMovers>;
  /** Opens the live stream. Call it once; the stream manages its own connections. */
  openStream(handlers: StreamHandlers): MarketStream;
}

/**
 * Why a provider request failed:
 * - credentials: the provider rejected the API keys.
 * - entitlement: the keys work, but the plan doesn't include this data.
 * - rate_limited: too many requests, even after the adapter's own retries.
 * - unavailable: the provider couldn't be reached or failed on its side.
 * - rejected: the provider refused the request itself, e.g. an unsupported parameter.
 */
export type ProviderFailure = 'credentials' | 'entitlement' | 'rate_limited' | 'unavailable' | 'rejected';

/** A failed provider request. Its message never contains credentials or request headers. */
export class ProviderError extends Error {
  readonly failure: ProviderFailure;
  /** The provider's id for the request, worth logging because it can't be looked up later. */
  readonly requestId: string | null;

  constructor(failure: ProviderFailure, message: string, requestId: string | null = null) {
    super(message);
    this.name = 'ProviderError';
    this.failure = failure;
    this.requestId = requestId;
  }
}
