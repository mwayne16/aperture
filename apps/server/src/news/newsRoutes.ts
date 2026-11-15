import { DEFAULT_NEWS_LIMIT, type NewsList } from '@aperture/shared/news';
import { normalizeSymbol } from '@aperture/shared/symbols';
import type { FastifyInstance } from 'fastify';
import { validateRequest } from '../http/validateRequest.js';
import { NewsQuery } from './newsDtos.js';
import type { NewsService } from './newsService.js';

/** `GET /news`: the curated dashboard feed, or with `symbols`, the news for a stock page. */
export function registerNewsRoutes(app: FastifyInstance, news: NewsService): void {
  app.get<{ Querystring: NewsQuery }>(
    '/news',
    { preHandler: validateRequest({ query: NewsQuery }) },
    async (request): Promise<NewsList> => {
      const { symbols, limit = DEFAULT_NEWS_LIMIT } = request.query;
      const items =
        symbols === undefined
          ? await news.feed(limit)
          : await news.about(symbols.map(normalizeSymbol), limit);
      return { news: items };
    },
  );
}
