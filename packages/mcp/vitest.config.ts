import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // Ratchet: set just below measured coverage (2026-07-10: 79.97/74.42/90.72)
      // so it can only go up. Raise when coverage improves.
      thresholds: { lines: 78, statements: 78, branches: 72, functions: 88 },
    },
  },
});

