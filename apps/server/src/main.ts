// Decorator metadata must be available before any DTO, entity or config class is defined.
import 'reflect-metadata';
import { buildApp } from './app.js';
import type { AppConfig } from './config/appConfig.js';
import { ConfigError, describeConfig, loadConfig } from './config/loadConfig.js';
import { createDataSource } from './db/dataSource.js';
import { closeDatabase, openDatabase } from './db/database.js';
import { describeDatabaseError } from './db/errors.js';
import { createMarketDataProvider } from './marketData/createProvider.js';

function readConfig(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(
      ['The server configuration is invalid:', ...error.problems.map((problem) => `  - ${problem}`)].join(
        '\n',
      ) + '\nSet these in the repository .env file (see .env.example) or the environment.',
    );
    process.exit(1);
  }
}

const config = readConfig();
const dataSource = createDataSource(config.databaseUrl);
const marketData = createMarketDataProvider(config);
const app = buildApp({ config, dataSource, marketData });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => closeDatabase(dataSource))
      .then(() => process.exit(0));
  });
}

try {
  await openDatabase(dataSource, app.log);
} catch (error) {
  app.log.fatal(
    `Could not open the database: ${describeDatabaseError(error)}. Check that PostgreSQL is running ` +
      '(docker compose up -d) and that DATABASE_URL matches the credentials in .env.',
  );
  process.exit(1);
}

await app.listen({ host: config.serverHost, port: config.serverPort });
app.log.info(describeConfig(config));
if (marketData === null) {
  app.log.warn(
    'Market data is off: set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in .env (paper-trading keys), then restart.',
  );
}
