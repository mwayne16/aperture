/**
 * Symbol and watchlist-name rules (shared with the future backend DTO validators).
 *
 * - Symbols are normalized by trimming whitespace and upper-casing.
 * - Valid symbol: 1-5 letters, optionally followed by "." and 1-2 letters for share classes
 *   (e.g. "AAPL", "F", "BRK.B"). Pattern: /^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/
 * - Watchlist names are trimmed, 1-40 characters, and unique per user ignoring case.
 * - A watchlist holds at most MAX_WATCHLIST_SYMBOLS symbols and never the same symbol twice.
 */

export const SYMBOL_PATTERN = /^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/;
export const WATCHLIST_NAME_MAX = 40;
export const MAX_WATCHLIST_SYMBOLS = 100;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export function normalizeSymbol(_input: string): string {
  throw new Error('not implemented');
}

export function validateSymbol(_input: string): ValidationResult<string> {
  throw new Error('not implemented');
}

/**
 * Validates a symbol before adding it to a watchlist. Rejects invalid format, duplicates already in
 * `existing`, and lists that are full. Returns the normalized symbol on success.
 */
export function validateSymbolForWatchlist(_input: string, _existing: readonly string[]): ValidationResult<string> {
  throw new Error('not implemented');
}

/** Validates a watchlist name. `otherNames` are the names of the user's other watchlists. */
export function validateWatchlistName(_input: string, _otherNames: readonly string[]): ValidationResult<string> {
  throw new Error('not implemented');
}
