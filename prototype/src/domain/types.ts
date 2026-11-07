/**
 * Domain types shared by the UI, the mock layer, and (in later phases) the backend contracts.
 * Prices are plain numbers in USD. Timestamps are epoch milliseconds unless a field says ISO.
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

/** State of the client's realtime connection to the backend. */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface ConnectionInfo {
  state: ConnectionState;
  /** Name of the upstream feed, e.g. "Alpaca IEX" or "Simulated feed". */
  feedName: string;
  /** True when the feed is simulated. The UI must show a visible marker whenever this is true. */
  simulated: boolean;
  /** Epoch ms of the last message received from the backend, or null if none yet. */
  lastMessageAt: number | null;
  /** Reconnect attempt count while reconnecting, else 0. */
  reconnectAttempt: number;
  /** Epoch ms of the next reconnect attempt while reconnecting, else null. */
  nextRetryAt: number | null;
  /** Human-readable reason for the last disconnect or error, if any. */
  error: string | null;
}

/** Kind of instrument. Crypto trades around the clock and uses pair symbols such as "BTC/USD". */
export type AssetClass = 'stock' | 'etf' | 'crypto';

export interface Instrument {
  /** Normalized upper-case ticker, e.g. "AAPL", "BRK.B" or "BTC/USD". */
  symbol: string;
  /** Company, fund or coin name. */
  name: string;
  /** Primary listing exchange, e.g. "NASDAQ", or "CRYPTO" for coins. */
  exchange: string;
  assetClass: AssetClass;
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

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  /** Symbols the article is about. */
  symbols: string[];
  /** ISO timestamp. */
  publishedAt: string;
  /** Link to the full article, or null when there is none (simulated items). */
  url: string | null;
  /** True for prototype headlines. The UI must label them as simulated. */
  simulated: boolean;
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

export interface Watchlist {
  id: string;
  name: string;
  /** Ordered, unique, normalized symbols. Order is user-defined and persisted. */
  symbols: string[];
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

export type AlertCondition = 'above' | 'below';
export type AlertTag = 'buy' | 'sell';
/** Market-data field an alert is evaluated against. Only the latest trade price is supported. */
type AlertField = 'last';

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  /** User label only. The app never trades. */
  tag: AlertTag;
  field: AlertField;
  enabled: boolean;
  /**
   * True when the alert may fire on the next price that satisfies its condition.
   * Set to false when it fires; set back to true once the price leaves the condition.
   * Persisted so a restart doesn't re-notify for a condition that stayed satisfied.
   */
  armed: boolean;
  note: string | null;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt: string | null;
  lastTriggeredPrice: number | null;
  triggerCount: number;
}

export interface AlertEvent {
  /** Unique per trigger. Clients de-duplicate notifications by this id. */
  id: string;
  alertId: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  tag: AlertTag;
  field: AlertField;
  /** The price that satisfied the condition. */
  price: number;
  /** ISO timestamp. */
  triggeredAt: string;
}

export interface CreateAlertInput {
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  tag: AlertTag;
  enabled?: boolean;
  note?: string | null;
}

/** Partial update. Omitted fields stay unchanged. `note: null` clears the note. */
export interface UpdateAlertInput {
  condition?: AlertCondition;
  targetPrice?: number;
  tag?: AlertTag;
  enabled?: boolean;
  note?: string | null;
}
