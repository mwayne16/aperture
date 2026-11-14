/**
 * The market-data port. Every service that needs prices, history, search or news depends on this
 * interface, never on a vendor SDK, so changing data source means writing one adapter and changing
 * `MARKET_DATA_PROVIDER`. An adapter maps vendor payloads into these types and validates them at its
 * boundary; its limits are data, so the rate limiter and the live-subscription budget adapt to
 * whichever provider is active.
 */

/** Providers the server can be configured with. Add an id here together with its adapter. */
export const MARKET_DATA_PROVIDERS = ['alpaca'] as const;

export type MarketDataProviderId = (typeof MARKET_DATA_PROVIDERS)[number];

/** Usage limits of the provider's plan. Shared services stay inside them for any provider. */
export interface ProviderLimits {
  /** REST requests allowed per minute; the server's limiter stays below it. */
  requestsPerMinute: number;
  /** Live symbols one stream connection may subscribe to, per asset stream. Null when unlimited. */
  streamSymbolsPerConnection: { stocks: number | null; crypto: number | null };
  /** Stream connections allowed per endpoint for the same credentials. */
  streamConnections: number;
}

/** A point-in-time quote in the server's own shape, whatever the vendor sends. */
export interface ProviderQuote {
  symbol: string;
  last: number | null;
  lastTradeAt: number | null;
  bid: number | null;
  ask: number | null;
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
  timeframe: '1Min' | '5Min' | '15Min' | '1Hour' | '1Day' | '1Week';
  start: Date;
  end: Date;
}

export interface ProviderInstrument {
  symbol: string;
  name: string;
  exchange: string;
  assetClass: 'stock' | 'etf' | 'crypto';
}

export interface ProviderNewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  symbols: string[];
  publishedAt: string;
  url: string | null;
}

/** Live trades and quotes for a changing set of symbols over the provider's single stream connection. */
export interface MarketStream {
  setSymbols(symbols: readonly string[]): void;
  close(): Promise<void>;
}

export interface StreamHandlers {
  onQuote(quote: ProviderQuote): void;
  onStatus(status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected', error?: string): void;
}

/**
 * What a market-data adapter implements. All list methods take many symbols at once so callers can
 * batch requests inside the provider's rate limit.
 * @public Implemented by the provider adapters added with the market-data integration.
 */
export interface MarketDataProvider {
  readonly id: MarketDataProviderId;
  readonly limits: ProviderLimits;
  /** Every tradable instrument, for symbol search. Callers cache it; it changes at most daily. */
  listInstruments(): Promise<ProviderInstrument[]>;
  getSnapshots(symbols: readonly string[]): Promise<ProviderQuote[]>;
  getBars(request: BarsRequest): Promise<ReadonlyMap<string, ProviderBar[]>>;
  getNews(options: { symbols?: readonly string[]; limit: number }): Promise<ProviderNewsItem[]>;
  openStream(handlers: StreamHandlers): MarketStream;
}
