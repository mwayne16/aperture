import type { FastifyInstance } from 'fastify';
import { validateRequest } from '../http/validateRequest.js';
import { AddSymbolBody, ReorderSymbolsBody, SymbolParams } from './watchlistDtos.js';
import type { WatchlistService } from './watchlistService.js';

/**
 * Watchlist endpoints. Every one answers with the whole watchlist, so the client never merges changes.
 * Crypto pairs travel URL-encoded in the path, e.g. `DELETE /watchlist/symbols/BTC%2FUSD`.
 */
export function registerWatchlistRoutes(app: FastifyInstance, watchlist: WatchlistService): void {
  app.get('/watchlist', () => watchlist.get());

  app.post<{ Body: AddSymbolBody }>(
    '/watchlist/symbols',
    { preHandler: validateRequest({ body: AddSymbolBody }) },
    (request) => watchlist.add(request.body.symbol),
  );

  app.delete<{ Params: SymbolParams }>(
    '/watchlist/symbols/:symbol',
    { preHandler: validateRequest({ params: SymbolParams }) },
    (request) => watchlist.remove(request.params.symbol),
  );

  app.put<{ Body: ReorderSymbolsBody }>(
    '/watchlist/order',
    { preHandler: validateRequest({ body: ReorderSymbolsBody }) },
    (request) => watchlist.reorder(request.body.symbols),
  );
}
