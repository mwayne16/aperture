import type {
  ChartRange,
  CreateAlertInput,
  HistoryResult,
  Instrument,
  PriceAlert,
  UpdateAlertInput,
  Watchlist,
} from '../domain/types';

/**
 * Mirrors the future backend HTTP API. The prototype implements it in `mock/mockApi.ts`.
 * Every method is async and rejects with `ApiError` on failure, matching the backend's error envelope:
 * `{ error: { code, message, details? } }`.
 */
export interface MarketApi {
  listWatchlists(): Promise<Watchlist[]>;
  /** Rejects with VALIDATION_ERROR on a bad name and CONFLICT on a duplicate name. */
  createWatchlist(input: { name: string }): Promise<Watchlist>;
  renameWatchlist(id: string, name: string): Promise<Watchlist>;
  deleteWatchlist(id: string): Promise<void>;
  /** Appends a symbol. Rejects with VALIDATION_ERROR for bad format and CONFLICT for duplicates. */
  addSymbol(watchlistId: string, symbol: string): Promise<Watchlist>;
  removeSymbol(watchlistId: string, symbol: string): Promise<Watchlist>;
  /** `symbols` must be a permutation of the current symbols, or it rejects with VALIDATION_ERROR. */
  reorderSymbols(watchlistId: string, symbols: readonly string[]): Promise<Watchlist>;

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
