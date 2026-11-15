import type { NewsItem } from '@aperture/shared/news';
import type { FastifyBaseLogger } from 'fastify';
import { ApiHttpError } from '../http/errors.js';
import { ProviderError } from '../marketData/provider.js';
import type { NewsCache } from './newsCache.js';
import {
  assembleFeed,
  dedupe,
  filterArticles,
  NEWS_WEIGHTS,
  NO_MARKET_INPUTS,
  storiesAbout,
  type Article,
  type MarketInputs,
} from './newsRules.js';
import type { NewsSource } from './newsSource.js';

const NOT_CONFIGURED =
  "News isn't set up. Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to .env, then restart the server.";

/** The feed's pools are fetched again this often, so requests always find them cached. */
export const REFRESH_INTERVAL_MS = 3 * 60_000;
/** Longer than the refresh interval, so one slow refresh doesn't empty the cache. */
const POOL_TTL_MS = 5 * 60_000;
/** A stock page's news, fetched when the page asks for it. */
const SYMBOL_NEWS_TTL_MS = 3 * 60_000;
/** Articles read per query, newest first: enough to rank 25 stories after de-duplication. */
const ARTICLES_PER_QUERY = 100;
/** Pools whose last good copy is kept: the two feed pools plus recently opened stock pages. */
const MAX_LAST_GOOD = 20;
/** Bump when the cached shape changes, so old entries are ignored. */
const KEY_PREFIX = 'news:v1';

export interface NewsServiceOptions {
  /** Null while news isn't configured; requests then answer UNAVAILABLE. */
  source: NewsSource | null;
  cache: NewsCache;
  /** The watchlist's symbols. */
  watchlist: () => Promise<readonly string[]>;
  /** Market conditions for ranking. Should not reject; missing parts score 0. */
  marketInputs: (symbols: readonly string[]) => Promise<MarketInputs>;
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  now?: () => number;
}

const describe = (error: unknown) =>
  error instanceof ProviderError ? error.message : 'Unexpected error; see the server log.';

/**
 * The curated news feed. A refresh every few minutes fetches two pools, news about the watchlist and
 * market news, and caches them; requests read the cache and rank on the spot with current market
 * conditions. When a fetch fails, the last good pool keeps the feed going.
 */
export class NewsService {
  private readonly options: NewsServiceOptions;
  private readonly now: () => number;
  /** The last good copy of recent pools, for when the cache has expired and a fetch fails. Bounded. */
  private readonly lastGood = new Map<string, Article[]>();
  private readonly fetching = new Map<string, Promise<Article[]>>();
  /** Each pool's current failure, so a lasting one is logged once and its recovery once. */
  private readonly failures = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: NewsServiceOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** Refreshes now and then on a schedule, without waiting. Never throws. */
  start(): void {
    if (this.options.source === null || this.timer !== null) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fetches both feed pools into the cache. Never rejects. */
  async refresh(): Promise<void> {
    try {
      const watched = await this.options.watchlist();
      await Promise.all([
        watched.length === 0 ? Promise.resolve() : this.fetchPool(watchlistKey(watched), watched),
        this.fetchPool(marketKey(), undefined),
      ]);
    } catch {
      // ** fetchPool already logged a provider failure; a watchlist failure leaves the cached pools in place.
    }
  }

  /** The dashboard feed, `limit` stories long. */
  async feed(limit: number): Promise<NewsItem[]> {
    this.requireSource();
    const watched = await this.options.watchlist();
    const [aboutWatchlist, market] = await Promise.all([
      watched.length === 0 ? Promise.resolve([]) : this.pool(watchlistKey(watched), watched, POOL_TTL_MS),
      this.pool(marketKey(), undefined, POOL_TTL_MS),
    ]);
    const now = this.now();
    const stories = dedupe(filterArticles([...aboutWatchlist, ...market], now));
    const inputs = await this.options.marketInputs(watched).catch(() => NO_MARKET_INPUTS);
    return assembleFeed(stories, watched, inputs, now, limit);
  }

  /** News for a stock page: stories about `symbols`, newest first. */
  async about(symbols: readonly string[], limit: number): Promise<NewsItem[]> {
    this.requireSource();
    const key = `${KEY_PREFIX}:symbols:${[...new Set(symbols)].sort().join(',')}`;
    const articles = await this.pool(key, symbols, SYMBOL_NEWS_TTL_MS);
    return storiesAbout(dedupe(filterArticles(articles, this.now())), symbols, limit);
  }

  /** A pool from the cache, else fetched now; on a failed fetch, its last good copy if there is one. */
  private async pool(key: string, symbols: readonly string[] | undefined, ttlMs: number): Promise<Article[]> {
    const cached = await this.options.cache.get(key);
    if (cached !== null) return cached;
    try {
      return await this.fetchPool(key, symbols, ttlMs);
    } catch (error) {
      const fallback = this.lastGood.get(key);
      if (fallback) return fallback;
      throw error;
    }
  }

  /** Fetches one pool and caches it. Concurrent fetches of the same pool share one request. */
  private fetchPool(
    key: string,
    symbols: readonly string[] | undefined,
    ttlMs: number = POOL_TTL_MS,
  ): Promise<Article[]> {
    const running = this.fetching.get(key);
    if (running) return running;
    const source = this.requireSource();
    const since = new Date(this.now() - NEWS_WEIGHTS.windowHours * 3_600_000);
    const request = source
      .fetch({ symbols, since, limit: ARTICLES_PER_QUERY })
      .then(async (articles) => {
        await this.options.cache.set(key, articles, ttlMs);
        this.keepLastGood(key, articles);
        if (this.failures.delete(key)) this.options.log.info({ pool: key }, 'Fetching news works again');
        return articles;
      })
      .catch((error: unknown) => {
        const reason = describe(error);
        // ** A lasting failure (e.g. rejected keys) would otherwise repeat the same warning every refresh.
        if (this.failures.get(key) !== reason)
          this.options.log.warn({ pool: key, reason }, 'Fetching news failed');
        this.failures.set(key, reason);
        throw error;
      })
      .finally(() => this.fetching.delete(key));
    this.fetching.set(key, request);
    return request;
  }

  /** Keeps the most recently fetched pools only, so opening many stock pages can't grow memory. */
  private keepLastGood(key: string, articles: Article[]): void {
    this.lastGood.delete(key);
    this.lastGood.set(key, articles);
    while (this.lastGood.size > MAX_LAST_GOOD) {
      const oldest = this.lastGood.keys().next();
      if (oldest.done === true) break;
      this.lastGood.delete(oldest.value);
      this.failures.delete(oldest.value);
    }
  }

  private requireSource(): NewsSource {
    if (this.options.source === null) throw new ApiHttpError('UNAVAILABLE', NOT_CONFIGURED);
    return this.options.source;
  }
}

/** The watchlist pool is keyed by its symbols, so a changed watchlist fetches its own pool. */
const watchlistKey = (symbols: readonly string[]) =>
  `${KEY_PREFIX}:watchlist:${[...symbols].sort().join(',')}`;
const marketKey = () => `${KEY_PREFIX}:market`;
