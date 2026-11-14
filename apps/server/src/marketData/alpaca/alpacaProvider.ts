import {
  ApiError,
  AuthError,
  FetchError,
  MarketDataClient,
  PermissionError,
  RateLimitError,
  TimeFrameUnit,
  timeFrame,
  trading,
} from '@alpacahq/alpaca-trade-api';
import type { BarTimeframe, Instrument } from '@aperture/shared/marketData';
import {
  ProviderError,
  type BarsRequest,
  type MarketDataProvider,
  type ProviderBar,
  type ProviderLimits,
  type ProviderMovers,
  type ProviderSnapshot,
} from '../provider.js';
import { normalizeAsset, normalizeBar, normalizeSnapshot, rankedSymbols, time } from './alpacaPayloads.js';

/** Alpaca feeds: real-time IEX (free), all exchanges (paid), or all exchanges 15 minutes late. */
export const ALPACA_FEEDS = ['iex', 'sip', 'delayed_sip'] as const;
export type AlpacaFeed = (typeof ALPACA_FEEDS)[number];

/** The free plan's limits (checked 2026-11-14). Paid plans raise them; the adapter never needs more. */
const FREE_PLAN_LIMITS: ProviderLimits = {
  requestsPerMinute: 200,
  streamSymbolsPerConnection: { stocks: 30, crypto: 30 },
  streamConnections: 1,
  historyStartMs: Date.UTC(2016, 0, 1),
};

// ** The SDK throttles itself to this many requests a minute, a margin below the plan's limit so retries fit.
const REQUESTS_PER_MINUTE = Math.floor(FREE_PLAN_LIMITS.requestsPerMinute * 0.9);
const REQUEST_TIMEOUT_MS = 10_000;
/** Recent SIP data is only available to paid plans, so delayed history ends this long ago. */
const SIP_DELAY_MS = 15 * 60_000;
/** Upper bound on bars kept per symbol, so a bad request can't fill memory. */
const MAX_BARS_PER_SYMBOL = 10_000;
const MAX_ERROR_DETAIL_LENGTH = 200;

const FEED_LABELS: Record<AlpacaFeed, string> = {
  iex: 'Alpaca IEX',
  sip: 'Alpaca SIP',
  delayed_sip: 'Alpaca SIP (15-minute delay)',
};

const TIMEFRAMES: Record<BarTimeframe, ReturnType<typeof timeFrame>> = {
  '5Min': timeFrame(5, TimeFrameUnit.Minute),
  '15Min': timeFrame(15, TimeFrameUnit.Minute),
  '30Min': timeFrame(30, TimeFrameUnit.Minute),
  '1Hour': timeFrame(1, TimeFrameUnit.Hour),
  '1Day': timeFrame(1, TimeFrameUnit.Day),
  '1Week': timeFrame(1, TimeFrameUnit.Week),
  '1Month': timeFrame(1, TimeFrameUnit.Month),
};

export interface AlpacaProviderOptions {
  keyId: string;
  secret: string;
  feed: AlpacaFeed;
  /** Replaces the network, for tests. */
  fetchApi?: trading.FetchAPI;
  now?: () => number;
}

const isCrypto = (symbol: string) => symbol.includes('/');

/** Stands in for a request that was skipped because no symbol needed it. */
const NO_RESULTS: Readonly<Record<string, unknown>> = {};

/**
 * The Alpaca adapter. It uses only market-data clients and the read-only assets API, so nothing it
 * holds can place orders. The assets API lives on the paper-trading host, which is why the app expects
 * paper-trading keys.
 */
export function createAlpacaProvider(options: AlpacaProviderOptions): MarketDataProvider {
  const now = options.now ?? Date.now;
  const rest = {
    keyId: options.keyId,
    secret: options.secret,
    timeoutMs: REQUEST_TIMEOUT_MS,
    retry: { maxRetries: 2 },
    rateLimit: { maxRequests: REQUESTS_PER_MINUTE, intervalMs: 60_000 },
    fetchApi: options.fetchApi,
  };
  const data = new MarketDataClient(rest);
  const assets = new trading.AssetsApi(new trading.Configuration({ ...rest, paper: true }));
  const historyFeed = options.feed === 'delayed_sip' ? 'sip' : options.feed;
  const historyLagMs = options.feed === 'delayed_sip' ? SIP_DELAY_MS : 0;

  async function listAssets(assetClass: 'us_equity' | 'crypto'): Promise<Instrument[]> {
    const rows: unknown[] = await call(() => assets.getV2Assets({ status: 'active', assetClass }));
    return rows.flatMap((row) => normalizeAsset(row, assetClass === 'crypto') ?? []);
  }

  return {
    id: 'alpaca',
    limits: FREE_PLAN_LIMITS,
    feedLabel: FEED_LABELS[options.feed],
    delayed: options.feed === 'delayed_sip',

    async listInstruments() {
      const [stocks, crypto] = await Promise.all([listAssets('us_equity'), listAssets('crypto')]);
      return [...stocks, ...crypto];
    },

    async getSnapshots(symbols) {
      const stocks = symbols.filter((s) => !isCrypto(s));
      const crypto = symbols.filter(isCrypto);
      const [stockMap, cryptoMap] = await Promise.all([
        stocks.length === 0
          ? NO_RESULTS
          : call(() => data.stocks.stockSnapshots({ symbols: stocks.join(','), feed: options.feed })),
        crypto.length === 0
          ? NO_RESULTS
          : call(() => data.crypto.cryptoSnapshots({ loc: 'us', symbols: crypto.join(',') })).then(
              (response) => response.snapshots,
            ),
      ]);
      return symbols.flatMap((symbol): ProviderSnapshot[] => {
        const raw: unknown = isCrypto(symbol) ? cryptoMap[symbol] : stockMap[symbol];
        return raw === undefined ? [] : [normalizeSnapshot(symbol, raw)];
      });
    },

    async getBars(request: BarsRequest) {
      const timeframe = TIMEFRAMES[request.timeframe];
      const start = request.start ?? new Date(FREE_PLAN_LIMITS.historyStartMs);
      const end = new Date(Math.min(request.end.getTime(), now() - historyLagMs));
      const limits = { maxPerSymbol: MAX_BARS_PER_SYMBOL };
      const stocks = request.symbols.filter((s) => !isCrypto(s));
      const crypto = request.symbols.filter(isCrypto);
      const [stockBars, cryptoBars] = await Promise.all([
        stocks.length === 0
          ? NO_RESULTS
          : call(() =>
              data.getStockBars(
                { symbols: [...stocks], timeframe, start, end, adjustment: 'split', feed: historyFeed },
                limits,
              ),
            ),
        crypto.length === 0
          ? NO_RESULTS
          : call(() =>
              data.getCryptoBars({ loc: 'us', symbols: [...crypto], timeframe, start, end }, limits),
            ),
      ]);
      const result = new Map<string, ProviderBar[]>();
      for (const symbol of request.symbols) {
        const raw: unknown = isCrypto(symbol) ? cryptoBars[symbol] : stockBars[symbol];
        if (!Array.isArray(raw)) continue;
        const bars = raw.flatMap((bar: unknown) => normalizeBar(bar) ?? []);
        if (bars.length > 0)
          result.set(
            symbol,
            bars.sort((a, b) => a.time - b.time),
          );
      }
      return result;
    },

    async getMovers(limit): Promise<ProviderMovers> {
      const [movers, active] = await Promise.all([
        call(() => data.screener.movers({ marketType: 'stocks', top: limit })),
        call(() => data.screener.mostActives({ by: 'volume', top: limit })),
      ]);
      return {
        gainers: rankedSymbols(movers.gainers),
        losers: rankedSymbols(movers.losers),
        mostActive: rankedSymbols(active.mostActives),
        asOf: time(movers.lastUpdated) ?? now(),
      };
    },
  };
}

/** Runs one SDK request and turns any failure into a ProviderError that is safe to log and show. */
async function call<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw toProviderError(error);
  }
}

function toProviderError(error: unknown): ProviderError {
  if (!(error instanceof ApiError)) {
    const reason =
      error instanceof FetchError ? 'could not be reached' : 'sent a response the server could not read';
    return new ProviderError('unavailable', `Alpaca ${reason}.`);
  }
  const requestId = error.requestId ?? null;
  const detail = error.message.trim().slice(0, MAX_ERROR_DETAIL_LENGTH);
  if (error instanceof AuthError) {
    return new ProviderError('credentials', 'Alpaca rejected the API keys.', requestId);
  }
  if (error instanceof PermissionError) {
    return new ProviderError(
      'entitlement',
      "The Alpaca plan doesn't include this data. The free plan covers the IEX feed (ALPACA_DATA_FEED=iex).",
      requestId,
    );
  }
  if (error instanceof RateLimitError) {
    return new ProviderError('rate_limited', "Alpaca's request limit was reached.", requestId);
  }
  if (error.status >= 500) {
    return new ProviderError(
      'unavailable',
      `Alpaca failed to answer (HTTP ${String(error.status)}).`,
      requestId,
    );
  }
  const reason = detail === '' ? `HTTP ${String(error.status)}` : detail;
  return new ProviderError('rejected', `Alpaca refused the request: ${reason}.`, requestId);
}
