import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const envPath = path.join(repoRoot, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && match[1] && process.env[match[1]] === undefined) process.env[match[1]] = match[2]!.replace(/^["']|["']$/g, '');
  }
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://repro:repro@localhost:5432/repro',
  ingestUrl: process.env.INGEST_URL ?? 'http://localhost:4000',
  webUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  demoUrl: process.env.DEMO_URL ?? 'http://localhost:4100',
  internalToken: process.env.REPRO_INTERNAL_TOKEN ?? 'change-me-local-internal-token',
  demoProjectKey: process.env.DEMO_PROJECT_KEY ?? '',
};

export function environmentDetails(): Record<string, string> {
  const cpu = os.cpus()[0]?.model ?? 'unknown';
  return {
    machine: `${cpu}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    platform: `${os.type()} ${os.release()} (${process.arch})`,
    node: process.version,
    date: new Date().toISOString(),
  };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

export const round = (n: number, digits = 1): number => Number(n.toFixed(digits));
