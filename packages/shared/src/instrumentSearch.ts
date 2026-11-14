/** Results a search returns when the caller doesn't ask for a number. */
export const DEFAULT_SEARCH_LIMIT = 8;
/** The most results one search returns. */
export const MAX_SEARCH_LIMIT = 50;

interface Searchable {
  symbol: string;
  name: string;
}

/**
 * Ranks instruments for a search box: the exact symbol first, then symbols that start with the query
 * (shortest first), then names that contain it (earliest match first). Case-insensitive. A blank query
 * matches nothing.
 */
export function searchInstruments<T extends Searchable>(
  instruments: readonly T[],
  query: string,
  limit: number,
): T[] {
  const trimmed = query.trim();
  if (trimmed === '' || limit < 1) return [];
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  const exact = instruments.filter((i) => i.symbol === upper);
  const prefix = instruments
    .filter((i) => i.symbol !== upper && i.symbol.startsWith(upper))
    .sort((a, b) => a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol));
  const byName = instruments
    .filter((i) => !i.symbol.startsWith(upper) && i.name.toLowerCase().includes(lower))
    .sort(
      (a, b) =>
        a.name.toLowerCase().indexOf(lower) - b.name.toLowerCase().indexOf(lower) ||
        a.name.localeCompare(b.name),
    );
  return [...exact, ...prefix, ...byName].slice(0, limit);
}
