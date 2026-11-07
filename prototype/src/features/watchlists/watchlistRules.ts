import { ApiError } from '../../data/api';
import {
  normalizeSymbol,
  validateSymbol,
  validateSymbolForWatchlist,
  validateWatchlistName,
} from '../../domain/symbols';
import type { Watchlist } from '../../domain/types';

/**
 * Pure rules behind the watchlist store: client-side validation that mirrors the API's errors,
 * choosing the active list, and undoing optimistic changes without discarding later ones.
 */

/**
 * Validates a watchlist name against the user's other names and returns the trimmed name.
 * Throws the ApiError the backend would send, so forms show it without a round trip.
 */
export function checkWatchlistName(input: string, otherNames: readonly string[]): string {
  const result = validateWatchlistName(input, otherNames);
  if (result.ok) return result.value;
  // ** A name that is only invalid because of the other names is a duplicate, which the API reports as CONFLICT.
  const duplicate = validateWatchlistName(input, []).ok;
  throw new ApiError(duplicate ? 'CONFLICT' : 'VALIDATION_ERROR', result.reason, duplicate ? 409 : 400, [
    { field: 'name', message: result.reason },
  ]);
}

/** Validates a symbol for a list and returns it normalized. Throws the ApiError the backend would send. */
export function checkWatchlistSymbol(input: string, existing: readonly string[]): string {
  const result = validateSymbolForWatchlist(input, existing);
  if (result.ok) return result.value;
  const symbol = normalizeSymbol(input);
  const duplicate = validateSymbol(input).ok && existing.some((s) => normalizeSymbol(s) === symbol);
  throw new ApiError(duplicate ? 'CONFLICT' : 'VALIDATION_ERROR', result.reason, duplicate ? 409 : 400, [
    { field: 'symbol', message: result.reason },
  ]);
}

/** The first candidate id that names a loaded list, else the first list, else null. */
export function pickActiveId(
  watchlists: readonly Watchlist[],
  candidates: readonly (string | null)[],
): string | null {
  const found = candidates.find((id) => id !== null && watchlists.some((w) => w.id === id));
  return found ?? watchlists[0]?.id ?? null;
}

/** The list that takes over when `id` is deleted: the next one, or the previous one at the end. */
export function neighbourId(watchlists: readonly Watchlist[], id: string): string | null {
  const index = watchlists.findIndex((w) => w.id === id);
  if (index === -1) return null;
  return (watchlists[index + 1] ?? watchlists[index - 1])?.id ?? null;
}

/** Puts `item` back at `index` (clamped), unless it is already there. */
export function reinsertAt<T>(
  items: readonly T[],
  item: T,
  index: number,
  same: (a: T, b: T) => boolean,
): T[] {
  if (items.some((existing) => same(existing, item))) return [...items];
  const at = Math.min(Math.max(0, index), items.length);
  return [...items.slice(0, at), item, ...items.slice(at)];
}

/** True when `next` holds exactly the symbols of `current`, each once, in any order. */
export function isPermutation(next: readonly string[], current: readonly string[]): boolean {
  if (next.length !== current.length || new Set(next).size !== next.length) return false;
  return next.every((symbol) => current.includes(symbol));
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((symbol, i) => symbol === b[i]);
}

/**
 * Undoes a failed reorder from `previous` to `attempted`. Symbols added since stay at the end and
 * removed ones stay removed. If a later reorder already changed the order, `current` is kept.
 */
export function undoReorder(
  current: readonly string[],
  attempted: readonly string[],
  previous: readonly string[],
): string[] {
  const attemptedKept = attempted.filter((s) => current.includes(s));
  const currentKept = current.filter((s) => attempted.includes(s));
  if (!sameOrder(attemptedKept, currentKept)) return [...current];
  const restored = previous.filter((s) => current.includes(s));
  const added = current.filter((s) => !previous.includes(s));
  return [...restored, ...added];
}
