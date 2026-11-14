import { describe, expect, it } from 'vitest';
import { marketDataConfigured } from './appConfig.js';
import { ConfigError, describeConfig, loadConfig } from './loadConfig.js';

const REQUIRED = {
  DATABASE_URL: 'postgres://aperture:aperture@127.0.0.1:5432/aperture',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

function problemsFor(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies local-development defaults around the required URLs', () => {
    const config = loadConfig(REQUIRED);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      serverHost: '127.0.0.1',
      serverPort: 4100,
      logLevel: 'info',
      databaseUrl: REQUIRED.DATABASE_URL,
      redisUrl: REQUIRED.REDIS_URL,
      marketDataProvider: 'alpaca',
      alpacaDataFeed: 'iex',
    });
    expect(marketDataConfigured(config)).toBe(false);
  });

  it('reads and converts set variables, trimming them', () => {
    const config = loadConfig({ ...REQUIRED, SERVER_PORT: ' 5000 ', LOG_LEVEL: 'debug', ALPACA_DATA_FEED: 'sip' });
    expect(config.serverPort).toBe(5000);
    expect(config.logLevel).toBe('debug');
    expect(config.alpacaDataFeed).toBe('sip');
  });

  it('treats an empty variable as unset', () => {
    expect(loadConfig({ ...REQUIRED, SERVER_PORT: '', ALPACA_API_KEY_ID: '  ' }).serverPort).toBe(4100);
  });

  it('ignores the rest of the environment', () => {
    const config = loadConfig({ ...REQUIRED, PATH: '/usr/bin', HOME: '/home/me' });
    expect(Object.values(config)).not.toContain('/usr/bin');
  });

  it('names the variable and the rule for every problem', () => {
    const problems = problemsFor({ SERVER_PORT: 'eighty', LOG_LEVEL: 'loud' });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^SERVER_PORT must be an integer number/),
        expect.stringMatching(/^LOG_LEVEL must be one of/),
        expect.stringMatching(/^DATABASE_URL must be a URL address/),
        expect.stringMatching(/^REDIS_URL must be a URL address/),
      ]),
    );
  });

  it('rejects URLs with the wrong scheme', () => {
    expect(problemsFor({ ...REQUIRED, DATABASE_URL: 'mysql://localhost/db' })).toEqual([
      expect.stringMatching(/^DATABASE_URL/),
    ]);
  });

  it('requires both Alpaca keys once one is set', () => {
    expect(problemsFor({ ...REQUIRED, ALPACA_API_SECRET_KEY: 'secret-value' })).toEqual([
      'ALPACA_API_KEY_ID is required when ALPACA_API_SECRET_KEY is set',
    ]);
    const config = loadConfig({ ...REQUIRED, ALPACA_API_KEY_ID: 'key-id', ALPACA_API_SECRET_KEY: 'secret-value' });
    expect(marketDataConfigured(config)).toBe(true);
  });

  it('never prints a secret value in a problem or the startup summary', () => {
    const secret = 'super-secret-value-123';
    const problems = problemsFor({ DATABASE_URL: secret, ALPACA_API_SECRET_KEY: secret });
    expect(problems.join(' ')).not.toContain(secret);
    const config = loadConfig({ ...REQUIRED, ALPACA_API_KEY_ID: 'key-id', ALPACA_API_SECRET_KEY: secret });
    expect(describeConfig(config)).not.toContain(secret);
    expect(describeConfig(config)).toContain('credentials set');
  });
});
