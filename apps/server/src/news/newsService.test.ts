import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiHttpError } from '../http/errors.js';
import { ProviderError } from '../marketData/provider.js';
import { FakeNewsSource, newsArticle } from '../test/fakeNewsSource.js';
import { MemoryNewsCache } from './newsCache.js';
import { NO_MARKET_INPUTS } from './newsRules.js';
import { NewsService, REFRESH_INTERVAL_MS } from './newsService.js';

const START = Date.parse('2026-11-16T15:00:00Z');

let source: FakeNewsSource;
let watchlist: string[];
let warnings: string[];
let service: NewsService;

function create(overrides: Partial<ConstructorParameters<typeof NewsService>[0]> = {}): NewsService {
  return new NewsService({
    source,
    cache: new MemoryNewsCache(),
    watchlist: () => Promise.resolve(watchlist),
    marketInputs: () => Promise.resolve(NO_MARKET_INPUTS),
    log: {
      info: () => undefined,
      warn: (...args: unknown[]) => {
        warnings.push(String(args.at(-1)));
      },
    } as never,
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  source = new FakeNewsSource();
  watchlist = ['AAPL', 'BTC/USD'];
  warnings = [];
  service = create();
});

afterEach(() => {
  service.stop();
  vi.useRealTimers();
});

describe('the feed', () => {
  it('fetches the watchlist and market pools over the last 48 hours and ranks watchlist stories first', async () => {
    const apple = newsArticle(START, { symbols: ['AAPL'] });
    const bitcoin = newsArticle(START, { symbols: ['BTC/USD'], publishedAt: START - 2 * 3_600_000 });
    const market = newsArticle(START, { headline: 'Fed holds interest rates steady' });
    source.articles = [apple, bitcoin];
    source.market = [market];

    const feed = await service.feed(10);

    expect(feed.map((item) => [item.id, item.reason])).toEqual([
      [apple.id, 'About AAPL'],
      [bitcoin.id, 'About BTC/USD'],
      [market.id, 'Top market story'],
    ]);
    expect(source.queries).toEqual([
      { symbols: ['AAPL', 'BTC/USD'], since: new Date(START - 48 * 3_600_000), limit: 100 },
      { symbols: undefined, since: new Date(START - 48 * 3_600_000), limit: 100 },
    ]);
  });

  it('serves later requests from the cache, and fetches a new pool when the watchlist changes', async () => {
    await service.feed(5);
    await service.feed(5);
    expect(source.queries).toHaveLength(2);
    watchlist = ['MSFT'];
    await service.feed(5);
    expect(source.queries.map((query) => query.symbols)).toEqual([['AAPL', 'BTC/USD'], undefined, ['MSFT']]);
  });

  it('asks only for market news when the watchlist is empty', async () => {
    watchlist = [];
    source.market = [newsArticle(START)];
    expect(await service.feed(5)).toHaveLength(1);
    expect(source.queries.map((query) => query.symbols)).toEqual([undefined]);
  });

  it('still ranks when market conditions are unavailable', async () => {
    service = create({ marketInputs: () => Promise.reject(new Error('quotes down')) });
    source.articles = [newsArticle(START, { symbols: ['AAPL'] })];
    expect(await service.feed(5)).toHaveLength(1);
  });

  it('shares one fetch between concurrent requests', async () => {
    await Promise.all([service.feed(5), service.feed(5), service.feed(25)]);
    expect(source.queries).toHaveLength(2);
  });

  it('keeps serving the last good pool when the cache expired and a fetch fails', async () => {
    source.market = [newsArticle(START)];
    watchlist = [];
    await service.feed(5);
    source.failWith = new ProviderError('unavailable', 'Alpaca could not be reached.');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await service.feed(5)).toHaveLength(1);
  });

  it('fails with the provider error when there is nothing to fall back on', async () => {
    source.failWith = new ProviderError('credentials', 'Alpaca rejected the API keys.');
    await expect(service.feed(5)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('news for a stock page', () => {
  it("returns the symbol's stories newest first and caches them briefly", async () => {
    const older = newsArticle(START, { symbols: ['AAPL'], publishedAt: START - 5 * 3_600_000 });
    const newer = newsArticle(START, { symbols: ['AAPL', 'MSFT'] });
    source.articles = [older, newer];
    const items = await service.about(['AAPL'], 5);
    expect(items.map((item) => item.id)).toEqual([newer.id, older.id]);
    await service.about(['AAPL'], 5);
    expect(source.queries).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await service.about(['AAPL'], 5);
    expect(source.queries).toHaveLength(2);
  });
});

describe('refreshing', () => {
  it('refreshes both pools on a schedule, so requests read the cache', async () => {
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(source.queries).toHaveLength(2);
    await service.feed(5);
    expect(source.queries).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(source.queries).toHaveLength(4);
  });

  it('warns once per pool about a lasting failure and never throws', async () => {
    source.failWith = new ProviderError('credentials', 'Alpaca rejected the API keys.');
    service.start();
    await vi.advanceTimersByTimeAsync(3 * REFRESH_INTERVAL_MS);
    // One warning for the watchlist pool and one for the market pool, not one per refresh.
    expect(warnings.filter((warning) => warning === 'Fetching news failed')).toHaveLength(2);
  });

  it('keeps last good copies for a bounded number of pools', async () => {
    for (let page = 0; page < 30; page++) await service.about([`S${String(page)}`], 5);
    source.failWith = new ProviderError('unavailable', 'Alpaca could not be reached.');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // The earliest pages fell out of the last-good copies, the latest are still there.
    await expect(service.about(['S0'], 5)).rejects.toBeInstanceOf(ProviderError);
    await expect(service.about(['S29'], 5)).resolves.toEqual([]);
  });

  it('stops refreshing and leaves no timers behind', () => {
    service.start();
    service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('without a news source', () => {
  it('rejects with UNAVAILABLE and says how to set one up', async () => {
    const off = create({ source: null });
    off.start();
    const error = await off.feed(5).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).code).toBe('UNAVAILABLE');
    await expect(off.about(['AAPL'], 5)).rejects.toThrow('ALPACA_API_KEY_ID');
  });
});
