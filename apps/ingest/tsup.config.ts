import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
};

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Everything in dependencies stays external: the service runs from node_modules, not a bundle.
  external: Object.keys(pkg.dependencies ?? {}),
});
