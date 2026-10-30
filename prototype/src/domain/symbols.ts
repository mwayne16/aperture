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
  if (!ASCII_ONLY.test(trimmed) || !SYMBOL_PATTERN.test(symbol)) {
    return { ok: false, reason: 'Use 1-5 letters, optionally followed by a share class like ".B".' };
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

/**
 * Compares names ignoring case, including letters whose case forms aren't one-to-one
 * ("ẞ" lower-cases to "ß", which upper-cases to "SS").
 */
function caselessKey(name: string): string {
  return name.toLowerCase().toUpperCase().toLowerCase();
}

/**
 * Validates a watchlist name. `otherNames` are the names of the user's other watchlists.
 * Length counts Unicode code points, so an emoji counts as one character.
 */
export function validateWatchlistName(
  input: string,
  otherNames: readonly string[],
): ValidationResult<string> {
  const name = trimWhitespace(input);
  if (name === '') return { ok: false, reason: 'Enter a watchlist name.' };
  if (Array.from(name).length > WATCHLIST_NAME_MAX) {
    return { ok: false, reason: `Use ${WATCHLIST_NAME_MAX} characters or fewer.` };
  }
  const key = caselessKey(name);
  if (otherNames.some((other) => caselessKey(trimWhitespace(other)) === key)) {
    return { ok: false, reason: 'You already have a watchlist with this name.' };
  }
  return { ok: true, value: name };
}
