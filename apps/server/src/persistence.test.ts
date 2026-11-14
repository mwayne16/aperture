import type { AlertList } from '@aperture/shared/alerts';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { openTestDatabase, resetDatabase, testConfig } from './test/database.js';

/** Starts the server on its own connection pool, as a fresh process would. */
async function startServer() {
  const dataSource = await openTestDatabase();
  const app = buildApp({ config: testConfig, dataSource }, { logger: false });
  return {
    app,
    dataSource,
    stop: async () => {
      await app.close();
      await dataSource.destroy();
    },
  };
}

describe('after a server restart', () => {
  it('the watchlist and alerts are still there, unchanged', async () => {
    const first = await startServer();
    await resetDatabase(first.dataSource);
    await first.app.inject({ method: 'POST', url: '/watchlist/symbols', payload: { symbol: 'MSFT' } });
    await first.app.inject({ method: 'POST', url: '/watchlist/symbols', payload: { symbol: 'ETH/USD' } });
    await first.app.inject({
      method: 'PUT',
      url: '/watchlist/order',
      payload: { symbols: ['ETH/USD', 'MSFT'] },
    });
    const created = await first.app.inject({
      method: 'POST',
      url: '/alerts',
      payload: { symbol: 'MSFT', condition: 'below', targetPrice: 401.25, tag: 'sell', note: 'support' },
    });
    const watchlistBefore = (await first.app.inject({ method: 'GET', url: '/watchlist' })).json<unknown>();
    await first.stop();

    const second = await startServer();
    try {
      expect((await second.app.inject({ method: 'GET', url: '/watchlist' })).json<unknown>()).toEqual(
        watchlistBefore,
      );
      expect((await second.app.inject({ method: 'GET', url: '/alerts' })).json<AlertList>()).toEqual({
        alerts: [created.json<unknown>()],
      });
    } finally {
      await second.stop();
    }
  });
});
