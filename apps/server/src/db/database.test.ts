import type { FastifyBaseLogger } from 'fastify';
import { QueryFailedError, type DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { closeDatabase, openDatabase } from './database.js';
import { describeDatabaseError, isDatabaseUnavailable } from './errors.js';

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

const refused = (): Error => withCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED');

describe('isDatabaseUnavailable', () => {
  it('recognises an unreachable or restarting server', () => {
    expect(isDatabaseUnavailable(refused())).toBe(true);
    expect(isDatabaseUnavailable(new AggregateError([refused(), refused()], ''))).toBe(true);
    expect(isDatabaseUnavailable(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isDatabaseUnavailable(withCode('the database system is starting up', '57P03'))).toBe(true);
    expect(isDatabaseUnavailable(withCode('connection failure', '08006'))).toBe(true);
    expect(
      isDatabaseUnavailable(
        new QueryFailedError('SELECT 1', [], withCode('terminating connection', '57P01')),
      ),
    ).toBe(true);
  });

  it('leaves bad queries, bad data and bad credentials alone', () => {
    expect(isDatabaseUnavailable(new QueryFailedError('SELEC', [], withCode('syntax error', '42601')))).toBe(
      false,
    );
    expect(isDatabaseUnavailable(withCode('duplicate key value', '23505'))).toBe(false);
    expect(isDatabaseUnavailable(withCode('password authentication failed', '28P01'))).toBe(false);
    expect(isDatabaseUnavailable('ECONNREFUSED')).toBe(false);
  });
});

describe('describeDatabaseError', () => {
  it('spells out an AggregateError, whose own message is empty', () => {
    expect(describeDatabaseError(new AggregateError([refused(), withCode('', 'ETIMEDOUT')], ''))).toBe(
      'connect ECONNREFUSED 127.0.0.1:5432; ETIMEDOUT',
    );
  });
});

function fakeDataSource(initialize: () => Promise<unknown>) {
  const runMigrations = vi.fn(() => Promise.resolve([{ name: 'CreateTables1' }]));
  const dataSource = { initialize: vi.fn(initialize), runMigrations, isInitialized: false };
  return { dataSource, asDataSource: dataSource as unknown as DataSource };
}

const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

describe('openDatabase', () => {
  it('keeps trying while the database is unreachable, then applies migrations', async () => {
    const attempts = [refused(), refused()];
    const { dataSource, asDataSource } = fakeDataSource(() => {
      const failure = attempts.shift();
      return failure ? Promise.reject(failure) : Promise.resolve();
    });
    await openDatabase(asDataSource, log, [0, 0, 0]);
    expect(dataSource.initialize).toHaveBeenCalledTimes(3);
    expect(dataSource.runMigrations).toHaveBeenCalledOnce();
  });

  it('gives up with the last error once the retries run out', async () => {
    const { dataSource, asDataSource } = fakeDataSource(() => Promise.reject(refused()));
    await expect(openDatabase(asDataSource, log, [0, 0])).rejects.toThrow('ECONNREFUSED');
    expect(dataSource.initialize).toHaveBeenCalledTimes(3);
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
  });

  it('fails at once on errors that retrying cannot fix', async () => {
    const { dataSource, asDataSource } = fakeDataSource(() =>
      Promise.reject(withCode('password authentication failed for user "aperture"', '28P01')),
    );
    await expect(openDatabase(asDataSource, log, [0, 0])).rejects.toThrow('password authentication failed');
    expect(dataSource.initialize).toHaveBeenCalledOnce();
  });
});

describe('closeDatabase', () => {
  it('does nothing for a connection that never opened', async () => {
    const destroy = vi.fn();
    await closeDatabase({ isInitialized: false, destroy } as unknown as DataSource);
    expect(destroy).not.toHaveBeenCalled();
  });
});
