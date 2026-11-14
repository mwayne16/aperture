import { IsIn, IsInt, IsNotEmpty, IsString, IsUrl, Max, Min, ValidateIf } from 'class-validator';
import { ALPACA_FEEDS, type AlpacaFeed } from '../marketData/alpaca/alpacaProvider.js';
import { MARKET_DATA_PROVIDERS, type MarketDataProviderId } from '../marketData/provider.js';
import { Env, EnvInt } from './env.js';

const NODE_ENVS = ['development', 'test', 'production'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const URL_RULES = { require_tld: false, require_protocol: true } as const;

/**
 * The server's settings, read from environment variables (and the repo's .env file in development).
 * Every field is validated at startup, so a bad value stops the server with a readable message instead
 * of failing later. Defaults suit local development and bind only to this machine.
 */
export class AppConfig {
  @Env('NODE_ENV')
  @IsIn(NODE_ENVS)
  nodeEnv: (typeof NODE_ENVS)[number] = 'development';

  /** Loopback by default, so the API is never reachable from the network unless asked. */
  @Env('SERVER_HOST')
  @IsString()
  @IsNotEmpty()
  serverHost = '127.0.0.1';

  @EnvInt('SERVER_PORT')
  @IsInt()
  @Min(1)
  @Max(65535)
  serverPort = 4100;

  @Env('LOG_LEVEL')
  @IsIn(LOG_LEVELS)
  logLevel: (typeof LOG_LEVELS)[number] = 'info';

  @Env('DATABASE_URL')
  @IsUrl({ ...URL_RULES, protocols: ['postgres', 'postgresql'] })
  databaseUrl!: string;

  @Env('REDIS_URL')
  @IsUrl({ ...URL_RULES, protocols: ['redis', 'rediss'] })
  redisUrl!: string;

  @Env('MARKET_DATA_PROVIDER')
  @IsIn(MARKET_DATA_PROVIDERS)
  marketDataProvider: MarketDataProviderId = 'alpaca';

  @Env('ALPACA_DATA_FEED')
  @IsIn(ALPACA_FEEDS)
  alpacaDataFeed: AlpacaFeed = 'iex';

  /**
   * Optional: without keys the server still runs and the market-data endpoints answer UNAVAILABLE. When
   * one key is set, the other is required.
   */
  @Env('ALPACA_API_KEY_ID')
  @ValidateIf(
    (config: AppConfig) => config.alpacaApiKeyId !== undefined || config.alpacaApiSecretKey !== undefined,
  )
  @IsNotEmpty({ message: 'ALPACA_API_KEY_ID is required when ALPACA_API_SECRET_KEY is set' })
  alpacaApiKeyId?: string;

  @Env('ALPACA_API_SECRET_KEY')
  @ValidateIf(
    (config: AppConfig) => config.alpacaApiKeyId !== undefined || config.alpacaApiSecretKey !== undefined,
  )
  @IsNotEmpty({ message: 'ALPACA_API_SECRET_KEY is required when ALPACA_API_KEY_ID is set' })
  alpacaApiSecretKey?: string;
}

/** True when the configured provider has the credentials it needs. */
export function marketDataConfigured(config: AppConfig): boolean {
  return config.alpacaApiKeyId !== undefined && config.alpacaApiSecretKey !== undefined;
}

/** The feed the configured provider streams. */
export function marketDataFeed(config: AppConfig): string {
  return config.alpacaDataFeed;
}
