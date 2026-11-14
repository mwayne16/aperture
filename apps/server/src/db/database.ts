import type { FastifyBaseLogger } from 'fastify';
import { setTimeout as sleep } from 'node:timers/promises';
import type { DataSource } from 'typeorm';
import { isDatabaseUnavailable } from './errors.js';

/** Waits between connection attempts, about 30 seconds in total. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * Connects to PostgreSQL and applies pending migrations. While the database can't be reached (for
 * example, its container is still starting) it retries a bounded number of times, then rethrows the
 * last error. Other failures, such as wrong credentials, fail at once.
 */
export async function openDatabase(
  dataSource: DataSource,
  log: FastifyBaseLogger,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await dataSource.initialize();
      break;
    } catch (error) {
      const delay = retryDelaysMs[attempt];
      if (delay === undefined || !isDatabaseUnavailable(error)) throw error;
      log.warn(`PostgreSQL is not reachable yet; retrying in ${String(delay / 1000)}s`);
      await sleep(delay);
    }
  }
  const applied = await dataSource.runMigrations();
  if (applied.length === 0) log.info('Database schema is up to date');
  else log.info({ migrations: applied.map((migration) => migration.name) }, 'Applied database migrations');
}

/** Closes the connection pool if it is open. */
export async function closeDatabase(dataSource: DataSource): Promise<void> {
  if (dataSource.isInitialized) await dataSource.destroy();
}
