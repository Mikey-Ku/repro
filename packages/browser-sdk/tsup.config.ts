import { defineConfig } from 'tsup';

/**
 * Two bundles:
 * - dist/index.js: ESM with type declarations, for `import { Repro } from '@repro/browser-sdk'`.
 * - dist/repro.iife.js: minified script-tag build exposing `window.Repro`.
 * Both inline rrweb and @repro/contracts so a consumer needs nothing else installed.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    platform: 'browser',
    noExternal: [/.*/],
  },
  {
    entry: { repro: 'src/iife.ts' },
    format: ['iife'],
    globalName: 'Repro',
    minify: true,
    sourcemap: true,
    target: 'es2020',
    platform: 'browser',
    noExternal: [/.*/],
    outExtension: () => ({ js: '.iife.js' }),
  },
]);
