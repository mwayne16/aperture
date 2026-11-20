import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { openTestDatabase } from '../test/database.js';

const SCRATCH_DATABASE = 'migration_check';

let admin: DataSource;
let dataSource: DataSource;

// ** Migrations run against their own database, so reverting them never disturbs the other tests.
beforeAll(async () => {
  admin = new DataSource({ type: 'postgres', url: inject('databaseUrl') });
  await admin.initialize();
  await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH_DATABASE}"`);
  await admin.query(`CREATE DATABASE "${SCRATCH_DATABASE}"`);
  const url = new URL(inject('databaseUrl'));
  url.pathname = `/${SCRATCH_DATABASE}`;
  dataSource = await openTestDatabase(url.toString());
});

afterAll(async () => {
  await dataSource.destroy();
  await admin.query(`DROP DATABASE "${SCRATCH_DATABASE}"`);
  await admin.destroy();
});

async function pendingSchemaChanges(): Promise<string[]> {
  const sql = await dataSource.driver.createSchemaBuilder().log();
  return sql.upQueries.map((query) => query.query.trim());
}

async function tables(): Promise<string[]> {
  const rows: { table_name: string }[] = await dataSource.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

describe('database migrations', () => {
  it('produce exactly the schema the entities describe', async () => {
    expect(await pendingSchemaChanges()).toEqual([]);
  });

  it('create the single watchlist row', async () => {
    expect(await dataSource.query('SELECT "id" FROM "watchlists"')).toEqual([{ id: 1 }]);
  });

  it('revert completely and apply again', async () => {
    for (let remaining = dataSource.migrations.length; remaining > 0; remaining -= 1) {
      await dataSource.undoLastMigration();
    }
    expect(await tables()).toEqual(['migrations']);
    await dataSource.runMigrations();
    expect(await tables()).toEqual(['alert_events', 'alerts', 'migrations', 'watchlist_symbols', 'watchlists']);
    expect(await pendingSchemaChanges()).toEqual([]);
  });
});
