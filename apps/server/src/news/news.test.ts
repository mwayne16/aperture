import type { ApiErrorBody } from '@aperture/shared/errors';
import type { NewsList } from '@aperture/shared/news';
import type { FastifyInstance } from 'fastify';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { openTestDatabase, resetDatabase, testConfig } from '../test/database.js';
import { FakeProvider } from '../test/fakeProvider.js';
import { FakeNewsSource, newsArticle } from '../test/fakeNewsSource.js';

let dataSource: DataSource;
let app: FastifyInstance | null = null;
let source: FakeNewsSource;

beforeAll(async () => {
  dataSource = await openTestDatabase();
});

afterAll(async () => {
  await dataSource.destroy();
});

beforeEach(async () => {
  await resetDatabase(dataSource);
  source = new FakeNewsSource();
});

afterEach(async () => {
  await app?.close();
  app = null;
});

function start(news: FakeNewsSource | null = source): FastifyInstance {
  app = buildApp({ config: testConfig, dataSource, marketData: new FakeProvider(), news }, { logger: false });
  return app;
}

const get = (server: FastifyInstance, url: string) => server.inject({ method: 'GET', url });

describe('GET /news', () => {
  it('curates the feed from the watchlist, then market stories, ten by default', async () => {
    const now = Date.now();
    source.articles = [newsArticle(now, { symbols: ['AAPL'] })];
    source.market = Array.from({ length: 12 }, (_, i) =>
      newsArticle(now, { publishedAt: now - (i + 2) * 3_600_000 }),
    );
    const server = start();
    await server.inject({ method: 'POST', url: '/watchlist/symbols', payload: { symbol: 'AAPL' } });

    const response = await get(server, '/news');

    expect(response.statusCode).toBe(200);
    const { news } = response.json<NewsList>();
    expect(news).toHaveLength(10);
    expect(news[0]).toMatchObject({ symbols: ['AAPL'], reason: 'About AAPL', simulated: false });
    expect(news.slice(1).every((item) => item.reason === 'Top market story')).toBe(true);
  });

  it("returns a stock page's news when given symbols", async () => {
    const now = Date.now();
    source.articles = [newsArticle(now, { symbols: ['BTC/USD'] })];
    const response = await get(start(), '/news?symbols=btc/usd&limit=5');
    expect(response.json<NewsList>().news.map((item) => item.reason)).toEqual(['About BTC/USD']);
    expect(source.queries[0]?.symbols).toEqual(['BTC/USD']);
  });

  it('validates the limit and the symbols', async () => {
    const server = start();
    const cases: [string, string][] = [
      ['/news?limit=26', 'Limit must be a whole number from 1 to 25.'],
      ['/news?limit=0', 'Limit must be a whole number from 1 to 25.'],
      ['/news?symbols=,', 'Enter at least one symbol.'],
      ['/news?symbols=AAPL,A$B', 'Entry 2 is not a valid symbol.'],
    ];
    for (const [url, message] of cases) {
      const response = await get(server, url);
      expect([response.statusCode, response.json<ApiErrorBody>().error.message]).toEqual([400, message]);
    }
  });

  it('answers UNAVAILABLE while news is not configured', async () => {
    const response = await get(start(null), '/news');
    expect(response.statusCode).toBe(503);
    expect(response.json<ApiErrorBody>().error.code).toBe('UNAVAILABLE');
  });
});
