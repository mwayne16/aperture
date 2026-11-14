import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { AppConfig } from './appConfig.js';
import { declaredEnvNames, envNameOf } from './env.js';

/** A value copied from .env.example without filling it in, e.g. `<SERVER_PORT>`. */
const PLACEHOLDER = /^<[A-Z0-9_]+>$/;

/** Startup configuration problems, one readable line per invalid variable. */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Builds the validated config from `env`. Only the variables AppConfig declares are read, so the rest
 * of the environment (PATH, HOME, ...) is ignored. Messages name the variable and the rule it broke,
 * never its value, so a mistyped secret is not printed to the console.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const placeholders = declaredEnvNames().filter((name) => PLACEHOLDER.test(env[name]?.trim() ?? ''));
  if (placeholders.length > 0) {
    throw new ConfigError(
      placeholders.map((name) => `${name} still has its .env.example placeholder; set a value or delete the line`),
    );
  }
  // ** A blank variable must fall back to the default, and defaults only apply to absent keys.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''));
  const config = plainToInstance(AppConfig, present, { excludeExtraneousValues: true, exposeDefaultValues: true });
  const errors = validateSync(config, { forbidUnknownValues: true, validationError: { target: false, value: false } });
  if (errors.length > 0) throw new ConfigError(errors.flatMap(describe));
  return config;
}

function describe(error: ValidationError): string[] {
  const name = envNameOf(error.property);
  return Object.values(error.constraints ?? {}).map((message) =>
    // ** class-validator words messages with the property name; users set the environment variable.
    message.startsWith(error.property) ? `${name}${message.slice(error.property.length)}` : message,
  );
}

/** A one-line summary for the startup log. Secrets are reported as set or missing, never shown. */
export function describeConfig(config: AppConfig): string {
  const credentials = config.alpacaApiKeyId !== undefined ? 'credentials set' : 'credentials missing';
  return `env ${config.nodeEnv}, market data ${config.marketDataProvider} (${config.alpacaDataFeed}, ${credentials})`;
}
