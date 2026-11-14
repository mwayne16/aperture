import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    globalSetup: ['./src/test/globalSetup.ts'],
    environment: 'node',
    // ** Every test file shares the one test database, so files run one at a time.
    fileParallelism: false,
    // Starting a cold PostgreSQL container can exceed the default hook timeout.
    hookTimeout: 60_000,
  },
});
