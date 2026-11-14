import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync } from 'node:fs';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The tests' own throwaway database. Tests never touch the DATABASE_URL from .env. */
    databaseUrl: string;
  }
}

/** The same PostgreSQL image Docker Compose runs, so tests exercise the version the app uses. */
function composePostgresImage(): string {
  const compose = readFileSync(new URL('../../../../compose.yaml', import.meta.url), 'utf8');
  const image = /image:\s*(postgres:\S+)/.exec(compose)?.[1];
  if (image === undefined) throw new Error('compose.yaml has no postgres image for the tests to use.');
  return image;
}

/** Starts one PostgreSQL container for the whole test run and removes it afterwards. Needs Docker. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let container;
  try {
    container = await new PostgreSqlContainer(composePostgresImage()).start();
  } catch (error) {
    throw new Error(
      'The server tests need Docker to run PostgreSQL. Start Docker Desktop and run them again.',
      {
        cause: error,
      },
    );
  }
  project.provide('databaseUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
