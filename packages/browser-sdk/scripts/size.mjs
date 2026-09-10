// Prints the raw, gzip and brotli sizes of the built bundles. Run `pnpm build` first.
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = ['dist/repro.iife.js', 'dist/index.js'];
const kb = (n) => `${(n / 1024).toFixed(1)} kB`.padStart(10);

for (const file of files) {
  let raw;
  try {
    raw = readFileSync(resolve(here, '..', file));
  } catch {
    console.error(`${file}: missing, run pnpm build first`);
    process.exitCode = 1;
    continue;
  }
  const gzip = gzipSync(raw, { level: 9 }).length;
  const brotli = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
  }).length;
  console.log(`${file.padEnd(22)} raw ${kb(raw.length)}   gzip ${kb(gzip)}   brotli ${kb(brotli)}`);
}
