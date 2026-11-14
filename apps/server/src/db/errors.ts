import { QueryFailedError } from 'typeorm';

/** Socket failures: nothing is listening, the connection dropped, or the host can't be reached. */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

/**
 * PostgreSQL error codes for a server that is gone or not accepting work: connection exceptions
 * (class 08), shutting down or still starting (57P01-57P03), and too many connections (53300).
 */
const UNAVAILABLE_SQLSTATE = /^(?:08|57P0[123]$|53300$)/;

/** node-postgres reports these without a code. */
const UNAVAILABLE_MESSAGES = ['Connection terminated', 'timeout exceeded when trying to connect'];

/**
 * True when an error means PostgreSQL can't be reached right now, as opposed to a bad query or bad
 * data. Such failures are worth retrying later and are reported to clients as UNAVAILABLE.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  const cause = error instanceof QueryFailedError ? (error.driverError as unknown) : error;
  if (cause instanceof AggregateError) return cause.errors.some(isDatabaseUnavailable);
  if (!(cause instanceof Error)) return false;
  const code = (cause as { code?: unknown }).code;
  if (typeof code === 'string' && (NETWORK_CODES.has(code) || UNAVAILABLE_SQLSTATE.test(code))) return true;
  return UNAVAILABLE_MESSAGES.some((message) => cause.message.includes(message));
}

/** A one-line reason for a database failure that never includes the connection URL or password. */
export function describeDatabaseError(error: unknown): string {
  if (error instanceof AggregateError && error.message === '') {
    return error.errors.map(describeDatabaseError).join('; ');
  }
  if (!(error instanceof Error)) return String(error);
  if (error.message !== '') return error.message;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : error.name;
}
