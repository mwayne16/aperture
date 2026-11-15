import { describe, expect, it } from 'vitest';
import {
  assembleFeed,
  canonicalUrl,
  dedupe,
  eventWeight,
  filterArticles,
  headlineSimilarity,
  isMacro,
  NO_MARKET_INPUTS,
  storiesAbout,
  symbolScore,
  type Article,
  type MarketInputs,
  type Story,
} from './newsRules.js';

const NOW = Date.parse('2026-11-16T15:00:00Z');
const HOUR = 3_600_000;

let sequence = 0;
function article(fields: Partial<Article> = {}): Article {
  sequence += 1;
  return {
    id: `alpaca:${String(sequence)}`,
    headline: `Company update number ${String(sequence)}`,
    summary: 'A summary.',
    source: 'Benzinga',
    symbols: [],
    publishedAt: NOW - HOUR,
    url: `https://www.benzinga.com/news/${String(sequence)}`,
    tags: [],
    ...fields,
  };
}

const story = (fields: Partial<Article> & { coverage?: number } = {}): Story => ({
  coverage: 1,
  ...article(fields),
});

const inputs = (fields: Partial<MarketInputs> = {}): MarketInputs => ({ ...NO_MARKET_INPUTS, ...fields });

describe('canonicalUrl', () => {
  it('drops tracking parameters, the fragment and a trailing slash, and lower-cases the host', () => {
    expect(canonicalUrl('https://WWW.Example.com/a/b/?utm_source=x&id=2&fbclid=y&b=1#top')).toBe(
      'https://www.example.com/a/b?b=1&id=2',
    );
  });

  it('rejects anything that is not an http(s) link', () => {
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
    expect(canonicalUrl(null)).toBeNull();
  });
});

describe('headlineSimilarity', () => {
  it('compares word sets, ignoring case and punctuation, and is 0 for an empty headline', () => {
    expect(headlineSimilarity('Apple beats estimates!', 'apple BEATS estimates')).toBe(1);
    expect(headlineSimilarity('Apple beats estimates', 'Tesla misses estimates')).toBeCloseTo(0.2);
    expect(headlineSimilarity('', '')).toBe(0);
  });
});

describe('filterArticles', () => {
  it('drops blank headlines, future and stale articles, and promotional pieces', () => {
    const kept = article();
    const result = filterArticles(
      [
        kept,
        article({ headline: '   ' }),
        article({ publishedAt: NOW + 60_000 }),
        article({ publishedAt: NOW - 49 * HOUR }),
        article({ headline: 'Sponsored: the next big thing' }),
        article({ tags: ['Press Release'] }),
      ],
      NOW,
    );
    expect(result).toEqual([kept]);
  });
});

describe('dedupe', () => {
  it('groups the same link and near-identical headlines, keeping the most complete then the earliest', () => {
    const early = article({
      headline: 'Apple raises dividend after record quarter',
      publishedAt: NOW - 3 * HOUR,
      symbols: ['AAPL'],
    });
    const later = article({
      headline: 'Apple raises dividend after a record quarter',
      publishedAt: NOW - 2 * HOUR,
      source: 'Reuters',
      symbols: ['AAPL', 'MSFT'],
    });
    const sameLink = article({
      headline: 'Something else entirely',
      url: `${String(early.url)}?utm_source=feed`,
      summary: '',
      source: 'MarketWatch',
    });
    const [only, ...rest] = dedupe([later, sameLink, early]);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ id: early.id, symbols: ['AAPL', 'MSFT'], coverage: 3 });
  });

  it('keeps stories apart when similar headlines are more than six hours apart', () => {
    const stories = dedupe([
      article({ headline: 'Markets open higher on Monday', publishedAt: NOW - 10 * HOUR }),
      article({ headline: 'Markets open higher on Monday', publishedAt: NOW - 3 * HOUR }),
    ]);
    expect(stories).toHaveLength(2);
  });

  it('gives the same groups whatever the input order', () => {
    const a = article({ headline: 'Nvidia unveils new chip lineup today', publishedAt: NOW - 4 * HOUR });
    const b = article({ headline: 'Nvidia unveils new chip lineup', publishedAt: NOW - 3 * HOUR, url: null });
    const c = article({ headline: 'Unrelated headline about oil', publishedAt: NOW - 2 * HOUR });
    const ids = (stories: Story[]) => stories.map((s) => [s.id, s.coverage]).sort();
    expect(ids(dedupe([a, b, c]))).toEqual(ids(dedupe([c, b, a])));
    expect(ids(dedupe([b, c, a]))).toEqual(ids(dedupe([a, c, b])));
  });
});

describe('eventWeight and isMacro', () => {
  it('scores market-moving events 1, other company news 0.5 and commentary 0', () => {
    expect(
      eventWeight(article({ headline: 'Apple Q4 results top revenue estimates', symbols: ['AAPL'] })),
    ).toBe(1);
    expect(
      eventWeight(article({ headline: 'Morgan Stanley upgrades Tesla to Overweight', symbols: ['TSLA'] })),
    ).toBe(1);
    expect(eventWeight(article({ headline: 'Apple opens a new store in Mumbai', symbols: ['AAPL'] }))).toBe(
      0.5,
    );
    expect(eventWeight(article({ headline: '5 stocks to watch this week', symbols: ['AAPL'] }))).toBe(0);
    expect(eventWeight(article({ headline: 'Quiet day', tags: ['Earnings'], symbols: ['AAPL'] }))).toBe(1);
  });

  it('recognizes broad-market topics', () => {
    expect(isMacro(article({ headline: 'Fed holds interest rates steady' }))).toBe(true);
    expect(isMacro(article({ headline: 'Apple opens a new store' }))).toBe(false);
  });
});

describe('symbolScore', () => {
  it('counts a symbol as a primary subject when few are tagged or the headline names it', () => {
    const crowded = { symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN'] };
    const tagged = story({ ...crowded, headline: 'Big tech rallies' });
    const byTicker = story({ ...crowded, headline: 'AAPL leads big tech higher' });
    const byName = story({ ...crowded, headline: 'Apple leads big tech higher' });
    const names = new Map([['AAPL', 'Apple Inc. Common Stock']]);
    expect(symbolScore(tagged, 'AAPL', inputs({ names }))).toBeCloseTo(0.4 * 0.5 + 0.15 * 0.5);
    expect(symbolScore(byTicker, 'AAPL', inputs())).toBeCloseTo(0.4 + 0.15 * 0.5);
    expect(symbolScore(byName, 'AAPL', inputs({ names }))).toBeCloseTo(0.4 + 0.15 * 0.5);
    expect(symbolScore(story({ symbols: ['AAPL'] }), 'AAPL', inputs())).toBeCloseTo(0.4 + 0.15 * 0.5);
  });

  it("adds the day's move and unusual volume, capped, and scores missing inputs as 0", () => {
    const one = story({ symbols: ['AAPL'] });
    const base = symbolScore(one, 'AAPL', inputs());
    expect(symbolScore(one, 'AAPL', inputs({ changePct: new Map([['AAPL', -2.5]]) }))).toBeCloseTo(
      base + 0.125,
    );
    expect(symbolScore(one, 'AAPL', inputs({ changePct: new Map([['AAPL', 12]]) }))).toBeCloseTo(base + 0.25);
    expect(symbolScore(one, 'AAPL', inputs({ volumeRatio: new Map([['AAPL', 2]]) }))).toBeCloseTo(base + 0.1);
    expect(symbolScore(one, 'AAPL', inputs({ volumeRatio: new Map([['AAPL', 0.4]]) }))).toBeCloseTo(base);
  });
});

describe('assembleFeed', () => {
  const ids = (items: { id: string }[]) => items.map((item) => item.id);

  it('puts watchlist stories first, then market stories, each saying why it is there', () => {
    const market = story({ headline: 'Fed holds interest rates steady' });
    const aboutApple = story({ symbols: ['AAPL'], publishedAt: NOW - 2 * HOUR });
    const aboutBitcoin = story({
      symbols: ['BTCUSD'],
      headline: 'Bitcoin tops 90,000',
      publishedAt: NOW - HOUR,
    });
    const feed = assembleFeed([market, aboutApple, aboutBitcoin], ['AAPL', 'BTC/USD'], inputs(), NOW, 10);
    expect(ids(feed)).toEqual([aboutBitcoin.id, aboutApple.id, market.id]);
    expect(feed.map((item) => item.reason)).toEqual(['About BTC/USD', 'About AAPL', 'Top market story']);
    expect(feed[0]).toMatchObject({
      symbols: ['BTC/USD'],
      simulated: false,
      publishedAt: new Date(NOW - HOUR).toISOString(),
    });
  });

  it('gives no symbol more than 3 of the first 10 places, filling capped places with market stories', () => {
    const apple = Array.from({ length: 6 }, (_, i) =>
      story({ symbols: ['AAPL'], publishedAt: NOW - i * 60_000 }),
    );
    const others = Array.from({ length: 6 }, (_, i) =>
      story({
        symbols: ['MSFT'],
        headline: `Microsoft item ${String(i)}`,
        publishedAt: NOW - HOUR - i * 60_000,
      }),
    );
    const extra = Array.from({ length: 4 }, (_, i) =>
      story({
        symbols: ['NVDA'],
        headline: `Nvidia item ${String(i)}`,
        publishedAt: NOW - 2 * HOUR - i * 60_000,
      }),
    );
    const market = Array.from({ length: 2 }, (_, i) =>
      story({ headline: `Market item ${String(i)}`, publishedAt: NOW - 5 * HOUR - i * 60_000 }),
    );
    const feed = assembleFeed(
      [...apple, ...others, ...extra, ...market],
      ['AAPL', 'MSFT', 'NVDA'],
      inputs(),
      NOW,
      25,
    );
    const firstTen = feed.slice(0, 10).map((item) => item.reason);
    for (const reason of ['About AAPL', 'About MSFT', 'About NVDA']) {
      expect(firstTen.filter((r) => r === reason)).toHaveLength(3);
    }
    expect(firstTen[9]).toBe('Top market story');
    expect(feed).toHaveLength(18);
    expect(ids(feed.slice(10))).toContain(apple[3]?.id);
  });

  it('shows market stories alone for an empty watchlist, ranked by impact', () => {
    const macro = story({ headline: 'Fed holds interest rates steady', publishedAt: NOW - 3 * HOUR });
    const plain = story({ headline: 'A company opens an office', publishedAt: NOW - HOUR });
    const active = story({ symbols: ['TSLA'], publishedAt: NOW - 2 * HOUR });
    const feed = assembleFeed([plain, active, macro], [], inputs({ mostActive: new Set(['TSLA']) }), NOW, 5);
    expect(ids(feed)).toEqual([active.id, macro.id, plain.id]);
    expect(new Set(feed.map((item) => item.reason))).toEqual(new Set(['Top market story']));
  });

  it('tops up a quiet watchlist with market stories to reach five', () => {
    const watched = story({ symbols: ['AAPL'] });
    const market = Array.from({ length: 6 }, (_, i) =>
      story({ headline: `Market item ${String(i)}`, publishedAt: NOW - (i + 2) * HOUR }),
    );
    const feed = assembleFeed([watched, ...market], ['AAPL'], inputs(), NOW, 5);
    expect(feed).toHaveLength(5);
    expect(feed[0]?.id).toBe(watched.id);
    expect(feed.slice(1).every((item) => item.reason === 'Top market story')).toBe(true);
  });

  it('breaks ties by publish time, newest first, then by id', () => {
    const older = story({ headline: 'Plain one', publishedAt: NOW - 2 * HOUR });
    const newer = story({ headline: 'Plain two', publishedAt: NOW - HOUR });
    const twinA = story({ id: 'alpaca:a', headline: 'Plain three', publishedAt: NOW - 3 * HOUR });
    const twinB = story({ id: 'alpaca:b', headline: 'Plain four', publishedAt: NOW - 3 * HOUR });
    const feed = assembleFeed([twinB, older, twinA, newer], [], inputs(), NOW, 10);
    expect(ids(feed)).toEqual([newer.id, older.id, 'alpaca:a', 'alpaca:b']);
  });
});

describe('storiesAbout', () => {
  it("returns stories about the page's symbols, newest first", () => {
    const old = story({ symbols: ['AAPL'], publishedAt: NOW - 5 * HOUR });
    const fresh = story({ symbols: ['AAPL', 'MSFT'], publishedAt: NOW - HOUR });
    const other = story({ symbols: ['TSLA'] });
    const items = storiesAbout([old, other, fresh], ['AAPL'], 5);
    expect(items.map((item) => [item.id, item.reason])).toEqual([
      [fresh.id, 'About AAPL'],
      [old.id, 'About AAPL'],
    ]);
  });
});
