import type { HealthResponse } from '@aperture/shared/health';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import type { DataSource } from 'typeorm';
import { registerAlertRoutes } from './alerts/alertRoutes.js';
import { AlertMonitor } from './alerts/alertMonitor.js';
import { AlertService } from './alerts/alertService.js';
import { marketDataConfigured, marketDataFeed, type AppConfig } from './config/appConfig.js';
import { registerErrorHandling } from './http/errors.js';
import { LiveMarketData } from './marketData/liveMarketData.js';
import { registerMarketDataRoutes } from './marketData/marketDataRoutes.js';
import { MarketDataService } from './marketData/marketDataService.js';
import type { MarketDataProvider } from './marketData/provider.js';
import { loadMarketInputs } from './news/marketInputs.js';
import { MemoryNewsCache, type NewsCache } from './news/newsCache.js';
import { registerNewsRoutes } from './news/newsRoutes.js';
import { RealtimeHub } from './realtime/realtimeHub.js';
import { registerRealtimeRoutes } from './realtime/realtimeRoutes.js';
import { NewsService } from './news/newsService.js';
import type { NewsSource } from './news/newsSource.js';
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
  /** Null or omitted while news isn't configured; `/news` then answers UNAVAILABLE. */
  news?: NewsSource | null;
  /** Where fetched news waits between refreshes. Defaults to an in-process cache. */
  newsCache?: NewsCache;
  /** Reported by /health when given; the caller connects and closes it. */
  redis?: { readonly ready: boolean };
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
  { config, dataSource, marketData, news = null, newsCache = new MemoryNewsCache(), redis }: AppDependencies,
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
      redis: redis?.ready === true ? 'up' : 'down',
      marketData: {
        provider: config.marketDataProvider,
        feed: marketDataFeed(config),
        configured: marketDataConfigured(config),
      },
    };
    return reply.code(up ? 200 : 503).send(health);
  });

  // ** Live prices follow the watchlist and enabled alerts, and alert evaluation follows the alerts, so
  // both services report their changes.
  let live: LiveMarketData | null = null;
  let monitor: AlertMonitor | null = null;
  let hub: RealtimeHub | null = null;
  const watchlist = new WatchlistService(dataSource, undefined, () => void live?.refresh());
  const alerts = new AlertService(dataSource, undefined, () => {
    void live?.refresh();
    void monitor?.reload();
  });
  if (marketData) {
    const started = new LiveMarketData(marketData, {
      log: app.log,
      demand: async () => ({
        focus: hub?.focusSymbols() ?? [],
        alerts: (await alerts.list()).filter((alert) => alert.enabled).map((alert) => alert.symbol),
        viewed: hub?.subscribedSymbols() ?? [],
        watchlist: (await watchlist.get()).symbols,
      }),
    });
    const watcher = new AlertMonitor(dataSource, app.log);
    started.onPrice(({ symbol, price }) => {
      watcher.evaluate(symbol, price);
    });
    live = started;
    monitor = watcher;
    // ** Started without waiting, so the server listens even while the provider is slow to answer. Alerts
    // load first, so each symbol's first price is checked against them.
    app.addHook('onReady', (done) => {
      void watcher.reload().then(() => started.start());
      done();
    });
    // ** Saves in progress finish before the caller closes the database.
    app.addHook('onClose', async () => {
      started.stop();
      await watcher.settled();
    });
  }

  const marketDataService = new MarketDataService(marketData, undefined, live);
  const newsService = new NewsService({
    source: news,
    cache: newsCache,
    watchlist: async () => (await watchlist.get()).symbols,
    marketInputs: (symbols) => loadMarketInputs(marketDataService, symbols),
    log: app.log,
  });
  if (news) {
    // ** Like the live prices: refreshing starts without holding up listen and stops with the app.
    app.addHook('onReady', (done) => {
      newsService.start();
      done();
    });
    app.addHook('onClose', (_instance, done) => {
      newsService.stop();
      done();
    });
  }

  // ** The app's realtime connections: their symbols join live demand, and they hear about prices, status
  // and alerts. Without market data they still connect and get a status saying so.
  const liveSource = live;
  const realtime = new RealtimeHub({
    log: app.log,
    onDemandChange: () => void liveSource?.refresh(),
    sources: {
      status: () => marketDataService.status(),
      latest: (symbol) => liveSource?.latest(symbol) ?? null,
      onChange: liveSource ? (listener) => liveSource.onChange(listener) : undefined,
      onStatus: liveSource ? (listener) => liveSource.onStatus(listener) : undefined,
      onAlert: monitor ? (listener) => monitor.onTriggered(listener) : undefined,
      onAlertUpdated: monitor ? (listener) => monitor.onUpdated(listener) : undefined,
    },
  });
  hub = realtime;
  app.addHook('onClose', (_instance, done) => {
    realtime.close();
    done();
  });

  registerWatchlistRoutes(app, watchlist);
  registerAlertRoutes(app, alerts);
  registerMarketDataRoutes(app, marketDataService);
  registerNewsRoutes(app, newsService);
  registerRealtimeRoutes(app, realtime);
  return app;
}
