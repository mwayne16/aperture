import type { HealthResponse } from '@aperture/shared/health';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { marketDataConfigured, marketDataFeed, type AppConfig } from './config/appConfig.js';
import { registerErrorHandling } from './http/errors.js';

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
  .version;

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

interface BuildOptions {
  /** Turn off request logging, e.g. in tests. */
  logger?: boolean;
}

/** Creates the HTTP server with its error handling and routes, without starting it. */
export function buildApp(config: AppConfig, { logger = true }: BuildOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: logger ? { level: config.logLevel, redact: { paths: REDACTED_PATHS, censor: '[redacted]' } } : false,
  });
  registerErrorHandling(app);

  app.get('/health', (): HealthResponse => ({
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    marketData: {
      provider: config.marketDataProvider,
      feed: marketDataFeed(config),
      configured: marketDataConfigured(config),
    },
  }));

  return app;
}
