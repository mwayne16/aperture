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
    // ** A few limits are in use at once (the dashboard asks for 5, news ranking for 10).
    this.movers = new TtlCache(5, now);
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

  /** Today's top gainers, losers and most active stocks, `limit` of each, with their latest quotes. */
  async getMovers(limit: number): Promise<MarketMovers> {
    const provider = this.requireProvider();
    return await this.movers.get(String(limit), MOVERS_TTL_MS, async () => {
      const ranking = await provider.getMovers(limit);
      const symbols = [...new Set([...ranking.gainers, ...ranking.losers, ...ranking.mostActive])];
      const snapshots = symbols.length === 0 ? [] : await provider.getSnapshots(symbols);
      const bySymbol = new Map(snapshots.map((s) => [s.symbol, s]));
      const at = this.now();
      const quotes = (list: readonly string[]) =>
        list.slice(0, limit).map((symbol) => toQuote(symbol, bySymbol.get(symbol), provider.delayed, at));
      return {
        gainers: quotes(ranking.gainers),
        losers: quotes(ranking.losers),
        mostActive: quotes(ranking.mostActive),
        asOf: ranking.asOf,
        simulated: false,
      };
    });
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
