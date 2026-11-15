/**
 * Market-data contracts between the server and the app. Prices are plain numbers in USD. Timestamps are
 * epoch milliseconds unless a field says otherwise.
 */

/** How trustworthy the latest value for a symbol is. Shown next to every quote. */
export type DataStatus =
  /** Real-time updates are arriving from the feed. */
  | 'live'
  /** The provider only offers delayed data for this symbol or plan. */
  | 'delayed'
  /** No update within the staleness threshold, or the connection dropped. Last value kept but greyed. */
  | 'stale'
  /** No value has ever been received, or the provider can't serve this symbol. */
  | 'unavailable';

/** Kind of instrument. Crypto trades around the clock and uses pair symbols such as "BTC/USD". */
export type AssetClass = 'stock' | 'etf' | 'crypto';

export const ASSET_CLASSES = ['stock', 'etf', 'crypto'] as const satisfies readonly AssetClass[];

export interface Instrument {
  /** Normalized upper-case ticker, e.g. "AAPL", "BRK.B" or "BTC/USD". */
  symbol: string;
  /** Company, fund or coin name. */
  name: string;
  /** Primary listing exchange, e.g. "NASDAQ", or "CRYPTO" for coins. */
  exchange: string;
  assetClass: AssetClass;
}

export interface InstrumentList {
  instruments: Instrument[];
}

export interface Quote {
  symbol: string;
  /** Latest trade price. This is the field alerts are evaluated against. */
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
  /** Previous session close. Change values are computed against it. */
  prevClose: number | null;
  /** Session volume (shares). */
  volume: number | null;
  /** last - prevClose. */
  change: number | null;
  /** Percent change vs prevClose, e.g. 1.25 means +1.25%. */
  changePct: number | null;
  status: DataStatus;
  /** Epoch ms when this quote object last changed on the client. */
  updatedAt: number;
}

export interface QuoteList {
  quotes: Quote[];
}

export interface MarketMovers {
  /** Stocks with the largest percent gain today, best first. */
  gainers: Quote[];
  /** Stocks with the largest percent loss today, worst first. */
  losers: Quote[];
  /** Stocks with the highest session volume, highest first. */
  mostActive: Quote[];
  /** Epoch ms when the ranking was computed. */
  asOf: number;
  simulated: boolean;
}

export const CHART_RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y', 'ALL'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

/** Bar sizes the backend may request from the provider. */
export type BarTimeframe = '5Min' | '15Min' | '30Min' | '1Hour' | '1Day' | '1Week' | '1Month';

export interface Bar {
  /** Bar open time in epoch **seconds** (lightweight-charts UTCTimestamp convention). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoryResult {
  symbol: string;
  range: ChartRange;
  timeframe: BarTimeframe;
  bars: Bar[];
  /** True when the provider returned fewer bars than the range asks for (retention limit, new listing). */
  truncated: boolean;
  simulated: boolean;
}

/** State of one of the server's live connections to the market-data provider. */
export type FeedConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface FeedChannelStatus {
  /** 'idle' until the channel first has symbols to stream. */
  state: FeedConnectionState;
  /** The reconnect attempt under way (from 1), or 0. */
  reconnectAttempt: number;
  /** Why the connection failed or closed, or null while healthy. */
  error: string | null;
  /** Epoch ms of the last trade or quote received. */
  lastMessageAt: number | null;
  /** Symbols the provider confirmed on this connection. */
  streamed: string[];
}

/**
 * `GET /market-data/status`: how the server gets prices. Symbols that don't fit a live connection, or
 * whose connection is down, are kept current by polling snapshots instead.
 */
export interface MarketDataStatus {
  /** False until the provider's API keys are set; everything else is then empty. */
  configured: boolean;
  /** Name of the data feed, e.g. "Alpaca IEX", or null when not configured. */
  feedName: string | null;
  /** True when the feed's prices arrive late. */
  delayed: boolean;
  stocks: FeedChannelStatus;
  crypto: FeedChannelStatus;
  /** Symbols currently kept current by polling. */
  polled: string[];
  /** Epoch ms of the last successful poll. */
  lastPollAt: number | null;
  /** Why the last poll failed, or null. */
  pollError: string | null;
}
