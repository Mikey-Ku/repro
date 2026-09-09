import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Load the repo root .env without overriding variables that are already set. */
export function loadRootEnv(): void {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = raw!.replace(/^["']|["']$/g, '');
  }
}

loadRootEnv();

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://repro:repro@localhost:5432/repro',
  ingestUrl: process.env.INGEST_URL ?? 'http://localhost:4000',
  webUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  demoUrl: process.env.DEMO_URL ?? 'http://localhost:4100',
  workerUrl: process.env.WORKER_URL ?? 'http://localhost:4200',
  internalToken: process.env.REPRO_INTERNAL_TOKEN ?? 'change-me-local-internal-token',
  /** The key the demo app records with. Seeded by global setup so it always exists. */
  demoProjectKey: process.env.DEMO_PROJECT_KEY ?? 'rp_e2e_demo_key_0123456789abcdefghij',
};
process.env.DEMO_PROJECT_KEY = env.demoProjectKey;
