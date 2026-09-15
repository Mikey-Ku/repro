import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const demoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Output name (under public/) to source entry. Each example gets its own self-contained bundle. */
const entries = {
  app: 'client/app.ts',
  'examples/settings': 'client/examples/settings.ts',
  'examples/inbox': 'client/examples/inbox.ts',
  'examples/orders': 'client/examples/orders.ts',
  'examples/signup': 'client/examples/signup.ts',
};

// Not minified on purpose: the bugs should be readable in stack traces and in the Repro dashboard.
await build({
  entryPoints: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, path.join(demoRoot, file)])),
  outdir: path.join(demoRoot, 'public'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: false,
  sourcemap: 'linked',
  logLevel: 'info',
});
