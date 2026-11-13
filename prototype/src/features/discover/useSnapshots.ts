import { api } from '../../data/dataLayer';
import type { Quote } from '../../domain/types';
import { usePolledRequest, type RequestView } from './usePolledRequest';

/**
 * How often lists outside the live stream refresh. The free IEX stream caps live subscriptions, so
 * these symbols are polled instead.
 */
const SNAPSHOT_REFRESH_MS = 12_000;

export type Snapshots = ReadonlyMap<string, Quote>;

const NO_SNAPSHOTS: Snapshots = new Map();

/**
 * Point-in-time quotes for `symbols`, refreshed every 12 s while mounted. A new set of symbols starts
 * over with a loading state, so quotes never show against the wrong rows.
 */
export function useSnapshots(
  symbols: readonly string[],
  refreshMs = SNAPSHOT_REFRESH_MS,
): { view: RequestView<Snapshots>; retry: () => void } {
  // ** Symbols never contain a comma, so the joined list identifies the request.
  const key = symbols.join(',');
  return usePolledRequest(
    key,
    async () => {
      if (symbols.length === 0) return NO_SNAPSHOTS;
      const quotes = await api.getSnapshots(symbols);
      return new Map(quotes.map((quote) => [quote.symbol, quote]));
    },
    { refreshMs },
  );
}
