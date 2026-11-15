import { ApiError, AuthError, FetchError, PermissionError, RateLimitError } from '@alpacahq/alpaca-trade-api';
import { ProviderError } from '../provider.js';

const MAX_ERROR_DETAIL_LENGTH = 200;

/** Runs one SDK request and turns any failure into a ProviderError that is safe to log and show. */
export async function call<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw toProviderError(error);
  }
}

export function toProviderError(error: unknown): ProviderError {
  if (!(error instanceof ApiError)) {
    const reason =
      error instanceof FetchError ? 'could not be reached' : 'sent a response the server could not read';
    return new ProviderError('unavailable', `Alpaca ${reason}.`);
  }
  const requestId = error.requestId ?? null;
  const detail = error.message.trim().slice(0, MAX_ERROR_DETAIL_LENGTH);
  if (error instanceof AuthError) {
    return new ProviderError('credentials', 'Alpaca rejected the API keys.', requestId);
  }
  if (error instanceof PermissionError) {
    return new ProviderError(
      'entitlement',
      "The Alpaca plan doesn't include this data. The free plan covers the IEX feed (ALPACA_DATA_FEED=iex).",
      requestId,
    );
  }
  if (error instanceof RateLimitError) {
    return new ProviderError('rate_limited', "Alpaca's request limit was reached.", requestId);
  }
  if (error.status >= 500) {
    return new ProviderError(
      'unavailable',
      `Alpaca failed to answer (HTTP ${String(error.status)}).`,
      requestId,
    );
  }
  const reason = detail === '' ? `HTTP ${String(error.status)}` : detail;
  return new ProviderError('rejected', `Alpaca refused the request: ${reason}.`, requestId);
}
