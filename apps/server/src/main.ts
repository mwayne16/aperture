// Decorator metadata must be available before any DTO or config class is defined.
import 'reflect-metadata';
import { buildApp } from './app.js';
import { ConfigError, describeConfig, loadConfig } from './config/loadConfig.js';
import type { AppConfig } from './config/appConfig.js';

function readConfig(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(
      ['The server configuration is invalid:', ...error.problems.map((problem) => `  - ${problem}`)].join('\n') +
        '\nSet these in the repository .env file (see .env.example) or the environment.',
    );
    process.exit(1);
  }
}

const config = readConfig();
const app = buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.serverHost, port: config.serverPort });
app.log.info(describeConfig(config));
