import type { Article } from '../news/newsRules.js';
import type { NewsQuery, NewsSource } from '../news/newsSource.js';

/**
 * A news source whose articles tests set directly: `market` answers queries without symbols, and each
 * query with symbols gets the articles tagged with any of them. It records every query; set `failWith`
 * to make fetches reject.
 */
export class FakeNewsSource implements NewsSource {
  readonly id = 'fake';
  articles: Article[] = [];
  market: Article[] = [];
  failWith: Error | null = null;
  readonly queries: NewsQuery[] = [];

  fetch(query: NewsQuery): Promise<Article[]> {
    this.queries.push(query);
    if (this.failWith) return Promise.reject(this.failWith);
    const { symbols } = query;
    if (symbols === undefined) return Promise.resolve(this.market);
    const wanted = new Set(symbols.map((symbol) => symbol.replace('/', '')));
    return Promise.resolve(
      this.articles.filter((article) =>
        article.symbols.some((symbol) => wanted.has(symbol.replace('/', ''))),
      ),
    );
  }
}

let sequence = 0;

/** An article with sensible defaults, published an hour before `now`. */
export function newsArticle(now: number, fields: Partial<Article> = {}): Article {
  sequence += 1;
  return {
    id: `fake:${String(sequence)}`,
    headline: `Story number ${String(sequence)}`,
    summary: 'A summary.',
    source: 'Benzinga',
    symbols: [],
    publishedAt: now - 3_600_000,
    url: `https://www.benzinga.com/news/${String(sequence)}`,
    tags: [],
    ...fields,
  };
}
