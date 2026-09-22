import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // The result card is authored as JSX. Next compiles it with the automatic runtime; the
  // test runner has to be told to do the same, or every render throws "React is not defined".
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    /*
     * Integration tests run against one real database, and some of them write to it — the
     * import suite adds 500 students to the same tenant the seed suite makes assertions
     * about. Running files in parallel makes those two race, so the suite is sequential.
     * It costs a few seconds and buys a deterministic result.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
