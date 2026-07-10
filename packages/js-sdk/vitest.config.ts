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
      // adapter-conformance is test infrastructure, not shipped code.
      exclude: ['src/**/*.test.ts', 'src/integrations/adapter-conformance.ts'],
      // Ratchet: just below measured (2026-07-10: 95.72/83.45/88.23).
      thresholds: { lines: 93, statements: 93, branches: 80, functions: 85 },
    },
  },
});
