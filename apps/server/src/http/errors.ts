import {
  API_ERROR_STATUS,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiErrorDetail,
} from '@aperture/shared/errors';
import type { FastifyError, FastifyInstance } from 'fastify';
import { describeDatabaseError, isDatabaseUnavailable } from '../db/errors.js';
import { ProviderError, type ProviderFailure } from '../marketData/provider.js';

/** What a client is told for each provider failure, on top of the provider's own message. */
const PROVIDER_HINTS: Record<ProviderFailure, string> = {
  credentials: 'Check ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env, then restart the server.',
  entitlement: '',
  rate_limited: 'Try again in a minute.',
  unavailable: 'Try again shortly.',
  rejected: '',
};

/** An error that becomes an API error response. Throw it from services, hooks or handlers. */
export class ApiHttpError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[];

  constructor(code: ApiErrorCode, message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiHttpError';
    this.code = code;
    this.status = API_ERROR_STATUS[code];
    this.details = details;
  }
}

/** A VALIDATION_ERROR whose message is the first problem, so a client can show it without the details. */
export function validationError(details: ApiErrorDetail[]): ApiHttpError {
  return new ApiHttpError('VALIDATION_ERROR', details[0]?.message ?? 'The request is invalid.', details);
}

function body(code: ApiErrorCode, message: string, details: ApiErrorDetail[] = []): ApiErrorBody {
  return { error: { code, message, details } };
}

/**
 * Sends every failure in the shared error shape. Expected errors keep their message; anything
 * unexpected is logged in full and answered with a generic message, so internals never reach clients.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send(body('NOT_FOUND', `No route for ${request.method} ${request.url}.`));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiHttpError) {
      return reply.code(error.status).send(body(error.code, error.message, error.details));
    }
    // Fastify's own client errors (malformed JSON, oversized or unsupported bodies) explain themselves safely.
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send(body('VALIDATION_ERROR', error.message));
    }
    if (error instanceof ProviderError) {
      request.log.warn(
        { failure: error.failure, providerRequestId: error.requestId, reason: error.message },
        'Market data request failed',
      );
      const message = [error.message, PROVIDER_HINTS[error.failure]].filter((part) => part !== '').join(' ');
      return reply.code(API_ERROR_STATUS.PROVIDER_ERROR).send(body('PROVIDER_ERROR', message));
    }
    if (isDatabaseUnavailable(error)) {
      request.log.warn({ reason: describeDatabaseError(error) }, 'Database unavailable');
      return reply
        .code(API_ERROR_STATUS.UNAVAILABLE)
        .send(
          body(
            'UNAVAILABLE',
            'The database is unavailable. Check that PostgreSQL is running, then try again.',
          ),
        );
    }
    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send(body('INTERNAL', 'Something went wrong on the server.'));
  });
}
