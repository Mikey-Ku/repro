import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk up from this file until the workspace manifest is found. */
export function findRepoRoot(start: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/**
 * Minimal .env loader. Only `KEY=value` lines are read, quotes are stripped, and a variable
 * that is already set in the process is never overridden (so the shell and CI always win).
 */
export function loadRootEnv(repoRoot: string = findRepoRoot()): void {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = (raw ?? '').replace(/^["']|["']$/g, '');
  }
}

export interface IngestEnv {
  databaseUrl: string;
  host: string;
  port: number;
  internalToken: string;
  maxBatchBytes: number;
  logLevel: string;
  artifactsDir: string;
  appUrl: string;
  /** Ingestion requests per minute per key. Benchmarks raise this. */
  rateLimitPerMinute: number;
}

/** Read and validate the variables this service needs. Throws with a clear message on misconfiguration. */
export function readEnv(env: NodeJS.ProcessEnv = process.env, repoRoot: string = findRepoRoot()): IngestEnv {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const internalToken = env.REPRO_INTERNAL_TOKEN;
  if (!internalToken) throw new Error('REPRO_INTERNAL_TOKEN is not set');
  const port = Number(env.INGEST_PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`INGEST_PORT is not a valid port: ${env.INGEST_PORT}`);
  const maxBatchBytes = Number(env.INGEST_MAX_BATCH_BYTES ?? 2_000_000);
  if (!Number.isInteger(maxBatchBytes) || maxBatchBytes <= 0) {
    throw new Error(`INGEST_MAX_BATCH_BYTES is not a positive integer: ${env.INGEST_MAX_BATCH_BYTES}`);
  }
  return {
    databaseUrl,
    host: env.INGEST_HOST ?? '0.0.0.0',
    port,
    internalToken,
    maxBatchBytes,
    logLevel: env.LOG_LEVEL ?? 'info',
    artifactsDir: env.REPRO_ARTIFACTS_DIR ?? path.join(repoRoot, '.repro', 'artifacts'),
    appUrl: env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    rateLimitPerMinute: Number(env.INGEST_RATE_LIMIT_PER_MINUTE ?? 600),
  };
}
