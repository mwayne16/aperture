import { mockFetch, type MockRequest } from '@alpacahq/alpaca-trade-api/testing';
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../provider.js';
import { NEWS_PAGE_1, NEWS_PAGE_2 } from './alpacaFixtures.js';
import { createAlpacaProvider } from './alpacaProvider.js';

const SINCE = new Date('2026-11-14T15:00:00Z');

function setup(respond: (request: MockRequest) => Response) {
  const requests: MockRequest[] = [];
  const provider = createAlpacaProvider({
    keyId: 'PKNEWSTEST0000000000',
    secret: 'news-secret',
    feed: 'iex',
    fetchApi: mockFetch([
      {
        path: '/v1beta1/news',
        respond: (request) => {
          requests.push(request);
          return respond(request);
        },
      },
    ]),
  });
  return { news: provider.news, requests };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const pages = ({ url }: MockRequest) => json(url.searchParams.has('page_token') ? NEWS_PAGE_2 : NEWS_PAGE_1);

describe('Alpaca news', () => {
  it('asks for the newest articles about the symbols, with crypto pairs in news form', async () => {
    const { news, requests } = setup(pages);
    await news.fetch({ symbols: ['AAPL', 'BTC/USD'], since: SINCE, limit: 100 });
    expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toMatchObject({
      symbols: 'AAPL,BTCUSD',
      start: SINCE.toISOString(),
      sort: 'desc',
      limit: '50',
      include_content: 'false',
    });
  });

  it('maps articles, keeping only valid symbols and http(s) links, and drops ones without a headline', async () => {
    const { news, requests } = setup(pages);
    const articles = await news.fetch({ since: SINCE, limit: 100 });
    expect(requests).toHaveLength(2);
    expect(articles).toEqual([
      {
        id: 'alpaca:41000002',
        headline: 'Apple Q4 results top revenue estimates',
        summary: 'Apple reported fourth-quarter revenue above estimates.',
        source: 'Benzinga',
        symbols: ['AAPL'],
        publishedAt: Date.parse('2026-11-16T14:30:00Z'),
        url: 'https://www.benzinga.com/news/26/11/41000002/apple-q4',
        tags: [],
      },
      expect.objectContaining({ id: 'alpaca:41000001', symbols: ['BTC/USD'], url: null, summary: '' }),
    ]);
  });

  it('stops reading pages once it has read the limit', async () => {
    const { news, requests } = setup(pages);
    const articles = await news.fetch({ since: SINCE, limit: 2 });
    expect([requests.length, articles.length]).toEqual([1, 2]);
  });

  it('reports failures as provider errors', async () => {
    const { news } = setup(() => json({ message: 'unauthorized' }, 401));
    const error = await news.fetch({ since: SINCE, limit: 10 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).failure).toBe('credentials');
  });
});
