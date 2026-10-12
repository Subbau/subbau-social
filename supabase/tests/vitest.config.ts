import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['db/**/*.test.ts', 'logika/**/*.test.ts'],
    globalSetup: ['./pomocnik/server.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
