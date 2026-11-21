import { resolveRange } from '@aperture/shared/chartRanges';
import { searchInstruments } from '@aperture/shared/instrumentSearch';
import type {
  AssetClass,
  ChartRange,
  FeedChannelStatus,
  HistoryResult,
  Instrument,
  MarketDataStatus,
  MarketMovers,
  Quote,
} from '@aperture/shared/marketData';
import { normalizeSymbol } from '@aperture/shared/symbols';
import { ApiHttpError } from '../http/errors.js';
import { isTruncated, lastSessionBars, sessionDate, toChartBars } from './history.js';
import type { LiveMarketData } from './liveMarketData.js';
import { isCryptoSymbol, type MarketDataProvider } from './provider.js';
import { toQuote } from './quotes.js';
import { TtlCache } from './ttlCache.js';

const NOT_CONFIGURED =
  "Market data isn't set up. Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to .env, then restart the server.";

/** The instrument list changes at most daily. */
const INSTRUMENTS_TTL_MS = 24 * 60 * 60_000;
/** Intraday charts move quickly; daily and longer bars barely change within a few minutes. */
const INTRADAY_HISTORY_TTL_MS = 60_000;
const DAILY_HISTORY_TTL_MS = 15 * 60_000;
const INTRADAY_RANGES: ReadonlySet<ChartRange> = new Set(['1D', '1W', '1M']);
const MOVERS_TTL_MS = 60_000;
/** Candidates asked for per list, so enough remain after filtering. */
const MOVER_CANDIDATES = 50;
/** Sub-dollar shares swing by huge percentages on tiny trades, so they are left out of movers. */
const MIN_MOVER_PRICE = 1;
/** Listings that aren't ordinary shares, recognized by name, e.g. "P3 Health Partners Inc. Warrant". */
const NOT_ORDINARY = new RegExp(String.raw`\b(warrants?|units?|rights?)\b`, 'i');
const MAX_CACHED_HISTORIES = 200;
/** Average daily volume barely changes within a day. */
const VOLUME_TTL_MS = 6 * 60 * 60_000;
/** Days averaged, and calendar days fetched to be sure of having them. */
const VOLUME_DAYS = 20;
const VOLUME_LOOKBACK_MS = 40 * 24 * 60 * 60_000;

const IDLE_CHANNEL: FeedChannelStatus = {
  state: 'idle',
  reconnectAttempt: 0,
  error: null,
  lastMessageAt: null,
  streamed: [],
};

interface Catalog {
  /** Every instrument, ordered by symbol. */
  all: Instrument[];
  bySymbol: ReadonlyMap<string, Instrument>;
}

/**
 * Instruments, quotes, chart history and movers from the configured provider. Without a provider every
 * method rejects with UNAVAILABLE and a message saying how to set one up. Results that change slowly
 * are cached in memory, so repeated chart and search requests stay inside the provider's rate limit.
 * Quotes come from the live service when it has current values, and from snapshots otherwise.
 */
export class MarketDataService {
  private readonly provider: MarketDataProvider | null;
  private readonly now: () => number;
  private readonly live: LiveMarketData | null;
  private readonly catalogs: TtlCache<Catalog>;
  private readonly histories: TtlCache<HistoryResult>;
  private readonly movers: TtlCache<MarketMovers>;
  private readonly volumes: TtlCache<ReadonlyMap<string, number>>;

  constructor(
    provider: MarketDataProvider | null,
    now: () => number = Date.now,
    live: LiveMarketData | null = null,
  ) {
    this.provider = provider;
    this.now = now;
    this.live = live;
    this.catalogs = new TtlCache(1, now);
    this.histories = new TtlCache(MAX_CACHED_HISTORIES, now);
    this.movers = new TtlCache(1, now);
    this.volumes = new TtlCache(20, now);
  }

  /** Every instrument, or those of one asset class, ordered by symbol. `limit` caps the list. */
  async listInstruments(assetClass?: AssetClass, limit?: number): Promise<Instrument[]> {
    const { all } = await this.catalog();
    const matching = assetClass === undefined ? all : all.filter((i) => i.assetClass === assetClass);
    return limit === undefined ? matching : matching.slice(0, limit);
  }

  /** Ranked matches for a search box, optionally within one asset class. */
  async searchInstruments(query: string, limit: number, assetClass?: AssetClass): Promise<Instrument[]> {
    const { all } = await this.catalog();
    const pool = assetClass === undefined ? all : all.filter((i) => i.assetClass === assetClass);
    return searchInstruments(pool, query, limit);
  }

  /** Rejects with NOT_FOUND when the provider doesn't list the symbol. */
  async getInstrument(symbol: string): Promise<Instrument> {
    const { bySymbol } = await this.catalog();
    const instrument = bySymbol.get(normalizeSymbol(symbol));
    if (!instrument)
      throw new ApiHttpError('NOT_FOUND', `No instrument found for ${normalizeSymbol(symbol)}.`);
    return instrument;
  }

  /**
   * The latest quote for each symbol, in the order asked. Current live values are used as they are; the
   * rest come from one batched snapshot request. Symbols the provider has no data for come back with
   * status 'unavailable'.
   */
  async getQuotes(symbols: readonly string[]): Promise<Quote[]> {
    const provider = this.requireProvider();
    const wanted = symbols.map(normalizeSymbol);
    const live = new Map(
      wanted.flatMap((symbol) => {
        const quote = this.live?.quote(symbol) ?? null;
        return quote === null ? [] : [[symbol, quote] as const];
      }),
    );
    const missing = [...new Set(wanted.filter((symbol) => !live.has(symbol)))];
    const snapshots = missing.length === 0 ? [] : await provider.getSnapshots(missing);
    const bySymbol = new Map(snapshots.map((s) => [s.symbol, s]));
    const at = this.now();
    return wanted.map(
      (symbol) => live.get(symbol) ?? toQuote(symbol, bySymbol.get(symbol), provider.delayed, at),
    );
  }

  /** How prices currently arrive: each live connection, and what is polled instead. */
  status(): MarketDataStatus {
    if (this.live) return this.live.status();
    return {
      configured: this.provider !== null,
      feedName: this.provider?.feedLabel ?? null,
      delayed: this.provider?.delayed ?? false,
      stocks: IDLE_CHANNEL,
      crypto: IDLE_CHANNEL,
      polled: [],
      lastPollAt: null,
      pollError: null,
    };
  }

  /** Bars for a chart range. Rejects with NOT_FOUND for a symbol the provider doesn't list. */
  async getHistory(symbol: string, range: ChartRange): Promise<HistoryResult> {
    const provider = this.requireProvider();
    const instrument = await this.getInstrument(symbol);
    const ttl = INTRADAY_RANGES.has(range) ? INTRADAY_HISTORY_TTL_MS : DAILY_HISTORY_TTL_MS;
    return this.histories.get(`${instrument.symbol}|${range}`, ttl, async () => {
      const now = this.now();
      const spec = resolveRange(range, new Date(now));
      const result = await provider.getBars({
        symbols: [instrument.symbol],
        timeframe: spec.timeframe,
        start: spec.start,
        end: spec.end,
      });
      const all = result.get(instrument.symbol) ?? [];
      const bars = spec.lastSessionOnly ? lastSessionBars(all, isCryptoSymbol(instrument.symbol), now) : all;
      return {
        symbol: instrument.symbol,
        range,
        timeframe: spec.timeframe,
        bars: toChartBars(bars),
        truncated: isTruncated(
          spec,
          bars[0]?.time ?? null,
          provider.limits.historyStartMs[isCryptoSymbol(instrument.symbol) ? 'crypto' : 'stocks'],
        ),
        simulated: false,
      };
    });
  }

  /**
   * Each symbol's average daily volume over its last 20 sessions before today, from the configured feed
   * (IEX volume compares with IEX history, never consolidated figures). One batched bars request, cached.
   * Symbols with fewer than 5 past sessions are left out.
   */
  async averageDailyVolume(symbols: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const provider = this.requireProvider();
    const wanted = [...new Set(symbols.map(normalizeSymbol))].sort();
    return await this.volumes.get(wanted.join(','), VOLUME_TTL_MS, async () => {
      const now = this.now();
      const bars = await provider.getBars({
        symbols: wanted,
        timeframe: '1Day',
        start: new Date(now - VOLUME_LOOKBACK_MS),
        end: new Date(now),
      });
      const today = sessionDate(now);
      const averages = new Map<string, number>();
      for (const [symbol, list] of bars) {
        const past = list.filter((bar) => sessionDate(bar.time) !== today).slice(-VOLUME_DAYS);
        if (past.length >= 5)
          averages.set(symbol, past.reduce((sum, bar) => sum + bar.volume, 0) / past.length);
      }
      return averages;
    });
  }

  /**
   * Today's top gainers, losers and most active stocks, `limit` of each, with their latest quotes. The
   * provider's rankings include warrants, units, sub-dollar shares and symbols whose own prices are days
   * old, so candidates are kept only when they are ordinary stocks or ETFs in the catalog, cost at least $1
   * and traded in the latest session. Gainers and losers are then ordered by the quote's own change, and
   * any whose quote moved the other way are dropped, so the list matches the numbers shown.
   */
  async getMovers(limit: number): Promise<MarketMovers> {
    const provider = this.requireProvider();
    // ** The filtered lists don't depend on `limit`, so every limit shares one fetch and gets a slice of it.
    const all = await this.movers.get('all', MOVERS_TTL_MS, async () => {
      const [ranking, { bySymbol: catalog }] = await Promise.all([
        provider.getMovers(MOVER_CANDIDATES),
        this.catalog(),
      ]);
      const ordinary = (symbol: string) => {
        const instrument = catalog.get(symbol);
        return (
          instrument !== undefined &&
          instrument.assetClass !== 'crypto' &&
          !NOT_ORDINARY.test(instrument.name)
        );
      };
      const candidates = [...new Set([...ranking.gainers, ...ranking.losers, ...ranking.mostActive])].filter(
        ordinary,
      );
      const snapshots = candidates.length === 0 ? [] : await provider.getSnapshots(candidates);
      const at = this.now();
      const quotes = new Map(
        snapshots.map((snapshot) => [
          snapshot.symbol,
          toQuote(snapshot.symbol, snapshot, provider.delayed, at),
        ]),
      );
      const sessions = [...quotes.values()].flatMap((q) =>
        q.lastTradeAt === null ? [] : [sessionDate(q.lastTradeAt)],
      );
      const latestSession = sessions.sort().at(-1);
      const tradedToday = (symbol: string): Quote[] => {
        const quote = quotes.get(symbol);
        if (quote?.last == null || quote.lastTradeAt === null || quote.last < MIN_MOVER_PRICE) return [];
        return sessionDate(quote.lastTradeAt) === latestSession ? [quote] : [];
      };
      const byChange = (list: readonly string[], direction: 1 | -1) =>
        list
          .flatMap(tradedToday)
          .filter((quote) => quote.changePct !== null && Math.sign(quote.changePct) === direction)
          .sort((a, b) => direction * ((b.changePct ?? 0) - (a.changePct ?? 0)));
      return {
        gainers: byChange(ranking.gainers, 1),
        losers: byChange(ranking.losers, -1),
        mostActive: ranking.mostActive.flatMap(tradedToday),
        asOf: ranking.asOf,
        simulated: false,
      };
    });
    return {
      ...all,
      gainers: all.gainers.slice(0, limit),
      losers: all.losers.slice(0, limit),
      mostActive: all.mostActive.slice(0, limit),
    };
  }

  private async catalog(): Promise<Catalog> {
    const provider = this.requireProvider();
    return await this.catalogs.get('all', INSTRUMENTS_TTL_MS, async () => {
      const all = (await provider.listInstruments()).sort((a, b) => a.symbol.localeCompare(b.symbol));
      return { all, bySymbol: new Map(all.map((i) => [i.symbol, i])) };
    });
  }

  private requireProvider(): MarketDataProvider {
    if (this.provider === null) throw new ApiHttpError('UNAVAILABLE', NOT_CONFIGURED);
    return this.provider;
  }
}
