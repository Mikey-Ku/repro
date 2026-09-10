import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  target: 'node22',
  // Runtime dependencies stay external so node resolves them from apps/worker/node_modules,
  // which is also where the reproduction workspace finds @playwright/test.
  external: ['@repro/contracts', '@repro/db', '@repro/diagnostics', '@playwright/test', 'drizzle-orm', 'pino', 'zod'],
});
