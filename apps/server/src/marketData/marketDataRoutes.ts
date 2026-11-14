import { DEFAULT_SEARCH_LIMIT } from '@aperture/shared/instrumentSearch';
import type {
  HistoryResult,
  Instrument,
  InstrumentList,
  MarketMovers,
  QuoteList,
} from '@aperture/shared/marketData';
import type { FastifyInstance } from 'fastify';
import { validateRequest } from '../http/validateRequest.js';
import {
  DEFAULT_MOVERS_LIMIT,
  HistoryQuery,
  InstrumentParams,
  InstrumentQuery,
  MoversQuery,
  QuotesQuery,
} from './marketDataDtos.js';
import type { MarketDataService } from './marketDataService.js';

/**
 * Market-data endpoints. Crypto pairs travel URL-encoded in the path, e.g.
 * `GET /instruments/BTC%2FUSD/history?range=1M`, and plainly in query strings.
 */
export function registerMarketDataRoutes(app: FastifyInstance, marketData: MarketDataService): void {
  app.get<{ Querystring: InstrumentQuery }>(
    '/instruments',
    { preHandler: validateRequest({ query: InstrumentQuery }) },
    async (request): Promise<InstrumentList> => {
      const { q, assetClass, limit } = request.query;
      const instruments =
        q === undefined
          ? await marketData.listInstruments(assetClass, limit)
          : await marketData.searchInstruments(q, limit ?? DEFAULT_SEARCH_LIMIT, assetClass);
      return { instruments };
    },
  );

  app.get<{ Params: InstrumentParams }>(
    '/instruments/:symbol',
    { preHandler: validateRequest({ params: InstrumentParams }) },
    (request): Promise<Instrument> => marketData.getInstrument(request.params.symbol),
  );

  app.get<{ Params: InstrumentParams; Querystring: HistoryQuery }>(
    '/instruments/:symbol/history',
    { preHandler: validateRequest({ params: InstrumentParams, query: HistoryQuery }) },
    (request): Promise<HistoryResult> => marketData.getHistory(request.params.symbol, request.query.range),
  );

  app.get<{ Querystring: QuotesQuery }>(
    '/quotes',
    { preHandler: validateRequest({ query: QuotesQuery }) },
    async (request): Promise<QuoteList> => ({ quotes: await marketData.getQuotes(request.query.symbols) }),
  );

  app.get<{ Querystring: MoversQuery }>(
    '/movers',
    { preHandler: validateRequest({ query: MoversQuery }) },
    (request): Promise<MarketMovers> => marketData.getMovers(request.query.limit ?? DEFAULT_MOVERS_LIMIT),
  );
}
