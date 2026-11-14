import type { AppConfig } from '../config/appConfig.js';
import { createAlpacaProvider } from './alpaca/alpacaProvider.js';
import type { MarketDataProvider, MarketDataProviderId } from './provider.js';

/** One factory per provider id; each returns null while its credentials aren't set. */
const ADAPTERS: Record<MarketDataProviderId, (config: AppConfig) => MarketDataProvider | null> = {
  alpaca: (config) =>
    config.alpacaApiKeyId === undefined || config.alpacaApiSecretKey === undefined
      ? null
      : createAlpacaProvider({
          keyId: config.alpacaApiKeyId,
          secret: config.alpacaApiSecretKey,
          feed: config.alpacaDataFeed,
        }),
};

/** The configured provider's adapter, or null while its credentials aren't set. */
export function createMarketDataProvider(config: AppConfig): MarketDataProvider | null {
  return ADAPTERS[config.marketDataProvider](config);
}
