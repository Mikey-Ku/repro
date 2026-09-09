import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Not minified on purpose: the checkout bug should be readable in stack traces and in the Repro dashboard.
await build({
  entryPoints: [path.join(demoRoot, 'client/app.ts')],
  outfile: path.join(demoRoot, 'public/app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: false,
  sourcemap: 'linked',
  logLevel: 'info',
});
