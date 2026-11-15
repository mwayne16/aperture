import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { readFileSync } from 'node:fs';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The tests' own throwaway database. Tests never touch the DATABASE_URL from .env. */
    databaseUrl: string;
    /** The tests' own throwaway Redis. Tests never touch the REDIS_URL from .env. */
    redisUrl: string;
  }
}

/** The image Docker Compose runs for a service, so tests exercise the versions the app uses. */
function composeImage(name: 'postgres' | 'redis'): string {
  const compose = readFileSync(new URL('../../../../compose.yaml', import.meta.url), 'utf8');
  const image = new RegExp(String.raw`image:\s*(${name}:\S+)`).exec(compose)?.[1];
  if (image === undefined) throw new Error(`compose.yaml has no ${name} image for the tests to use.`);
  return image;
}

/** Starts one PostgreSQL and one Redis container for the whole test run and removes them afterwards. Needs Docker. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let containers;
  try {
    containers = await Promise.all([
      new PostgreSqlContainer(composeImage('postgres')).start(),
      new RedisContainer(composeImage('redis')).start(),
    ]);
  } catch (error) {
    throw new Error(
      'The server tests need Docker to run PostgreSQL and Redis. Start Docker Desktop and run them again.',
      {
        cause: error,
      },
    );
  }
  const [postgres, redis] = containers;
  project.provide('databaseUrl', postgres.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());
  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
