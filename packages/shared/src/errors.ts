/**
 * The error shape every API response uses. The desktop app's `ApiError` mirrors it, so the UI handles
 * a real server error exactly like the prototype's simulated ones. The client adds `ABORTED` itself
 * for requests it cancels; the server never sends it.
 */

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PROVIDER_ERROR',
  'UNAVAILABLE',
  'INTERNAL',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The HTTP status that goes with each error code. */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PROVIDER_ERROR: 502,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** One invalid input, by its dotted path, e.g. "symbol" or "symbols.2". */
export interface ApiErrorDetail {
  field: string;
  message: string;
}

/** The body of every error response. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details: ApiErrorDetail[];
  };
}
