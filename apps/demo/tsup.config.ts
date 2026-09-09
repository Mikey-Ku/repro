import { defineConfig } from 'tsup';

// Only the server is built by tsup. The browser bundle is produced by scripts/build-client.mjs.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  dts: false,
});
