/**
 * Symbol rules (shared with the future backend DTO validators).
 *
 * - Symbols are normalized by trimming whitespace and upper-casing.
 * - Valid symbol: 1-5 letters, optionally followed by "." and 1-2 letters for share classes
 *   (e.g. "AAPL", "F", "BRK.B"). Pattern: /^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/
 * - Crypto pairs are also valid: a 2-10 letter coin, "/", and USD, USDT, USDC or BTC (e.g. "BTC/USD").
 * - A watchlist holds at most MAX_WATCHLIST_SYMBOLS symbols and never the same symbol twice.
 */

export const SYMBOL_PATTERN = /^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/;
const CRYPTO_PAIR_PATTERN = /^[A-Z]{2,10}\/(?:USD|USDT|USDC|BTC)$/;
// ** The free Alpaca plan streams at most 30 symbols live, so a full watchlist still streams every row.
export const MAX_WATCHLIST_SYMBOLS = 30;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Checked before upper-casing, which turns some non-ASCII letters into ASCII ("ſ" -> "S"). */
const ASCII_ONLY = /^[\x20-\x7E]*$/;

// ** String.prototype.trim misses some Unicode White_Space characters, such as NEL (U+0085).
const EDGE_WHITESPACE = /^[\p{White_Space}\uFEFF]+|[\p{White_Space}\uFEFF]+$/gu;

function trimWhitespace(input: string): string {
  return input.replace(EDGE_WHITESPACE, '');
}

export function normalizeSymbol(input: string): string {
  return trimWhitespace(input).toUpperCase();
}

export function validateSymbol(input: string): ValidationResult<string> {
  const trimmed = trimWhitespace(input);
  if (trimmed === '') return { ok: false, reason: 'Enter a symbol.' };
  const symbol = trimmed.toUpperCase();
  if (!ASCII_ONLY.test(trimmed) || !(SYMBOL_PATTERN.test(symbol) || CRYPTO_PAIR_PATTERN.test(symbol))) {
    return { ok: false, reason: 'Use 1-5 letters with an optional class like ".B", or a pair like "BTC/USD".' };
  }
  return { ok: true, value: symbol };
}

/**
 * Validates a symbol before adding it to a watchlist. Rejects invalid format, duplicates already in
 * `existing`, and lists that are full. Returns the normalized symbol on success.
 * Checks run in that order, so a duplicate in a full list reports the duplicate.
 */
export function validateSymbolForWatchlist(
  input: string,
  existing: readonly string[],
): ValidationResult<string> {
  const result = validateSymbol(input);
  if (!result.ok) return result;
  const symbol = result.value;
  // ** Stored symbols should already be normalized; normalizing again still catches legacy data.
  if (existing.some((s) => normalizeSymbol(s) === symbol)) {
    return { ok: false, reason: `${symbol} is already in this watchlist.` };
  }
  if (existing.length >= MAX_WATCHLIST_SYMBOLS) {
    return { ok: false, reason: `This watchlist is full (${MAX_WATCHLIST_SYMBOLS} symbols max).` };
  }
  return { ok: true, value: symbol };
}
