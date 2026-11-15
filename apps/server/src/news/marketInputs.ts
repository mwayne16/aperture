import type { MarketDataService } from '../marketData/marketDataService.js';
import { symbolKey, type MarketInputs } from './newsRules.js';

/** How many most-active stocks count as "active" for market stories. */
const MOST_ACTIVE_COUNT = 10;

/**
 * Market conditions for ranking news about `symbols`: the day's move, volume against the 20-day average,
 * today's most active stocks and company names. Each part is fetched on its own and simply left empty when
 * it fails (the screener may not be on every plan), so ranking degrades instead of failing. Never rejects.
 */
export async function loadMarketInputs(
  marketData: MarketDataService,
  symbols: readonly string[],
): Promise<MarketInputs> {
  const watching = symbols.length > 0;
  const [quotes, averages, movers, instruments] = await Promise.all([
    watching ? marketData.getQuotes(symbols).catch(() => []) : [],
    watching
      ? marketData.averageDailyVolume(symbols).catch(() => new Map<string, number>())
      : new Map<string, number>(),
    marketData.getMovers(MOST_ACTIVE_COUNT).catch(() => null),
    watching ? marketData.listInstruments().catch(() => []) : [],
  ]);
  const changePct = new Map<string, number>();
  const volumeRatio = new Map<string, number>();
  for (const quote of quotes) {
    if (quote.changePct !== null) changePct.set(quote.symbol, quote.changePct);
    const average = averages.get(quote.symbol);
    if (quote.volume !== null && average !== undefined && average > 0) {
      volumeRatio.set(quote.symbol, quote.volume / average);
    }
  }
  const watched = new Set(symbols);
  return {
    changePct,
    volumeRatio,
    mostActive: new Set((movers?.mostActive ?? []).map((quote) => symbolKey(quote.symbol))),
    names: new Map(instruments.filter((i) => watched.has(i.symbol)).map((i) => [i.symbol, i.name])),
  };
}
