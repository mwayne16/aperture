import type { HealthResponse } from '@aperture/shared/health';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import type { DataSource } from 'typeorm';
import { registerAlertRoutes } from './alerts/alertRoutes.js';
import { AlertService } from './alerts/alertService.js';
import { marketDataConfigured, marketDataFeed, type AppConfig } from './config/appConfig.js';
import { registerErrorHandling } from './http/errors.js';
import { registerMarketDataRoutes } from './marketData/marketDataRoutes.js';
import { MarketDataService } from './marketData/marketDataService.js';
import type { MarketDataProvider } from './marketData/provider.js';
import { registerWatchlistRoutes } from './watchlist/watchlistRoutes.js';
import { WatchlistService } from './watchlist/watchlistService.js';

const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

/** Log paths that may carry credentials. Pino replaces their values before anything is written. */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.alpacaApiKeyId',
  '*.alpacaApiSecretKey',
  '*.databaseUrl',
  '*.redisUrl',
  '*.password',
];

interface AppDependencies {
  config: AppConfig;
  /** The caller opens it before serving requests and closes it after the app closes. */
  dataSource: DataSource;
  /** Null while market data isn't configured; its endpoints then answer UNAVAILABLE. */
  marketData: MarketDataProvider | null;
}

interface BuildOptions {
  /** Turn off request logging, e.g. in tests. */
  logger?: boolean;
  /** Where log lines go instead of stdout, so tests can inspect what gets logged. */
  logStream?: { write(line: string): void };
}

async function databaseReachable(dataSource: DataSource): Promise<boolean> {
  if (!dataSource.isInitialized) return false;
  try {
    await dataSource.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Creates the HTTP server with its error handling and routes, without starting it. */
export function buildApp(
  { config, dataSource, marketData }: AppDependencies,
  { logger = true, logStream }: BuildOptions = {},
): FastifyInstance {
  const app = Fastify({
    logger: logger
      ? {
          level: config.logLevel,
          redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
          ...(logStream && { stream: logStream }),
        }
      : false,
  });
  registerErrorHandling(app);

  app.get('/health', async (_request, reply) => {
    const up = await databaseReachable(dataSource);
    const health: HealthResponse = {
      status: up ? 'ok' : 'unavailable',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      database: up ? 'up' : 'down',
      marketData: {
        provider: config.marketDataProvider,
        feed: marketDataFeed(config),
        configured: marketDataConfigured(config),
      },
    };
    return reply.code(up ? 200 : 503).send(health);
  });

  registerWatchlistRoutes(app, new WatchlistService(dataSource));
  registerAlertRoutes(app, new AlertService(dataSource));
  registerMarketDataRoutes(app, new MarketDataService(marketData));
  return app;
}
