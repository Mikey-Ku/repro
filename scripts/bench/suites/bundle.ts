import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { repoRoot } from '../env.js';
import type { BundleResult } from '../report.js';

export async function benchBundle(): Promise<BundleResult> {
  const dist = path.join(repoRoot, 'packages', 'browser-sdk', 'dist');
  const iife = fs.readFileSync(path.join(dist, 'repro.iife.js'));
  const esm = fs.readFileSync(path.join(dist, 'index.js'));
  return {
    rawBytes: iife.length,
    gzipBytes: gzipSync(iife, { level: 9 }).length,
    brotliBytes: brotliCompressSync(iife).length,
    esmRawBytes: esm.length,
  };
}
