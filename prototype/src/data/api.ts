import type {
  AssetClass,
  ChartRange,
  CreateAlertInput,
  HistoryResult,
  Instrument,
  MarketMovers,
  NewsItem,
  PriceAlert,
  Quote,
  UpdateAlertInput,
  Watchlist,
} from '../domain/types';

/**
 * Mirrors the future backend HTTP API. The prototype implements it in `mock/mockApi.ts`.
 * Every method is async and rejects with `ApiError` on failure, matching the backend's error envelope:
 * `{ error: { code, message, details? } }`.
 */
export interface MarketApi {
  /** The user's single watchlist. */
  getWatchlist(): Promise<Watchlist>;
  /** Appends a symbol. Rejects with VALIDATION_ERROR for a bad format or a full list, CONFLICT for a duplicate. */
  addSymbol(symbol: string): Promise<Watchlist>;
  /** Rejects with NOT_FOUND when the symbol isn't in the watchlist. */
  removeSymbol(symbol: string): Promise<Watchlist>;
  /** `symbols` must be a permutation of the current symbols, or it rejects with VALIDATION_ERROR. */
  reorderSymbols(symbols: readonly string[]): Promise<Watchlist>;

  listAlerts(): Promise<PriceAlert[]>;
  createAlert(input: CreateAlertInput): Promise<PriceAlert>;
  /** Changing condition or targetPrice, or enabling a disabled alert, re-arms it. */
  updateAlert(id: string, input: UpdateAlertInput): Promise<PriceAlert>;
  deleteAlert(id: string): Promise<void>;

  /** Case-insensitive match on symbol prefix first, then company-name substring. Max `limit` results. */
  searchInstruments(query: string, limit?: number): Promise<Instrument[]>;
  getInstrument(symbol: string): Promise<Instrument | null>;
  /** Rejects with PROVIDER_ERROR when history can't be loaded. Honors `signal` for cancellation. */
  getHistory(symbol: string, range: ChartRange, signal?: AbortSignal): Promise<HistoryResult>;

  /** Every instrument of one asset class, for browsing. Ordered by symbol. */
  listInstruments(assetClass: AssetClass): Promise<Instrument[]>;
  /**
   * Latest quote for each symbol in one request, for lists too long to stream (the free IEX stream
   * caps live subscriptions). Unknown symbols come back with status 'unavailable'. Order follows `symbols`.
   */
  getSnapshots(symbols: readonly string[]): Promise<Quote[]>;
  /** Today's biggest stock gainers and losers and the most active stocks, `limit` each (default 5). */
  getMovers(limit?: number): Promise<MarketMovers>;
  /** Recent news, newest first, limited to articles about `symbols` when given. Default limit 10. */
  getNews(options?: { symbols?: readonly string[]; limit?: number }): Promise<NewsItem[]>;
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PROVIDER_ERROR'
  | 'UNAVAILABLE'
  | 'ABORTED'
  | 'INTERNAL';

export interface ApiErrorDetail {
  /** Dotted path of the invalid field, e.g. "name" or "symbols.2". */
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: readonly ApiErrorDetail[];

  constructor(code: ApiErrorCode, message: string, status: number, details: readonly ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
