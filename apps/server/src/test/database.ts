import type { DataSource } from 'typeorm';
import { inject } from 'vitest';
import { loadConfig } from '../config/loadConfig.js';
import { createDataSource } from '../db/dataSource.js';

/** App settings for tests. buildApp never connects to these URLs; tests hand it a DataSource. */
export const testConfig = loadConfig({
  DATABASE_URL: 'postgres://test@127.0.0.1:1/unused',
  REDIS_URL: 'redis://127.0.0.1:1',
});

/** The tests' own database with every migration applied. */
export async function openTestDatabase(url: string = inject('databaseUrl')): Promise<DataSource> {
  const dataSource = createDataSource(url);
  await dataSource.initialize();
  await dataSource.runMigrations();
  return dataSource;
}

/** Empties the tables and resets the watchlist row, so each test starts from a fresh install. */
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE "watchlist_symbols", "alerts"');
  await dataSource.query(`UPDATE "watchlists" SET "updated_at" = '2026-01-01T00:00:00Z'`);
}
