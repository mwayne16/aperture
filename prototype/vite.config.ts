import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // Timing-based tests exceed the 5s default when several checks share the machine.
    testTimeout: 15_000,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
