import type { AppConfig } from '../config/appConfig.js';
import type { NewsSource } from '../news/newsSource.js';
import { createAlpacaProvider } from './alpaca/alpacaProvider.js';
import type { MarketDataProvider, MarketDataProviderId } from './provider.js';

/** The configured provider's adapters. Both are null while its credentials aren't set. */
export interface MarketDataSources {
  marketData: MarketDataProvider | null;
  news: NewsSource | null;
}

const NONE: MarketDataSources = { marketData: null, news: null };

/** One factory per provider id. */
const ADAPTERS: Record<MarketDataProviderId, (config: AppConfig) => MarketDataSources> = {
  alpaca: (config) => {
    if (config.alpacaApiKeyId === undefined || config.alpacaApiSecretKey === undefined) return NONE;
    const alpaca = createAlpacaProvider({
      keyId: config.alpacaApiKeyId,
      secret: config.alpacaApiSecretKey,
      feed: config.alpacaDataFeed,
    });
    // ** Alpaca is the only news source for now, at the user's choice (2026-11-15); the plan wants a second.
    return { marketData: alpaca, news: alpaca.news };
  },
};

export function createMarketDataSources(config: AppConfig): MarketDataSources {
  return ADAPTERS[config.marketDataProvider](config);
}
