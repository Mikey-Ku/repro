import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The apps/worker directory. This file is one level below it both in src/ (tsx, vitest) and in
 * dist/ (tsup bundles everything into dist/main.js), so the same relative hop works in both.
 */
export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Walk up from `start` until the workspace manifest is found. Falls back to `start`. */
export function findRepoRoot(start: string = appDir): string {
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
 * Minimal .env loader for the repo root. Only `KEY=value` lines are read, surrounding quotes are
 * stripped, and a variable that is already set in the process is never overridden, so the shell,
 * CI and the E2E harness always win over the file.
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

export interface WorkerEnv {
  databaseUrl: string;
  /** How long to sleep between polls when the queue is empty. */
  pollMs: number;
  /** Hard cap for one Playwright execution; the child is SIGKILLed past it. */
  runTimeoutMs: number;
  /** Origin of the bundled demo application, the only allowed reproduction target. */
  demoUrl: string;
  /** Absolute directory that keeps run artifacts (screenshot, trace, report). */
  artifactsDir: string;
  /** Absolute directory for the throwaway Playwright workspaces. */
  workspaceDir: string;
  port: number;
  workerId: string;
  logLevel: string;
}

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
}

/** Read and validate the variables the worker needs. Throws with a clear message on misconfiguration. */
export function readEnv(env: NodeJS.ProcessEnv = process.env, base: string = appDir): WorkerEnv {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const demoUrl = (env.DEMO_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
  try {
    const parsed = new URL(demoUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('not http(s)');
  } catch {
    throw new Error(`DEMO_URL is not a valid http(s) URL: "${demoUrl}"`);
  }

  return {
    databaseUrl,
    pollMs: positiveInteger('WORKER_POLL_MS', env.WORKER_POLL_MS, 1000),
    runTimeoutMs: positiveInteger('RUN_TIMEOUT_MS', env.RUN_TIMEOUT_MS, 90_000),
    demoUrl,
    // REPRO_ARTIFACTS_DIR is the name the ingest API uses for the same directory; accepting
    // both means one variable can point both services at the same place.
    artifactsDir: path.resolve(base, env.ARTIFACTS_DIR ?? env.REPRO_ARTIFACTS_DIR ?? 'artifacts'),
    // Keeping the workspace under apps/worker matters: node resolves @playwright/test for the
    // generated spec by walking up from the spec file, and apps/worker/node_modules has it.
    workspaceDir: path.resolve(base, env.WORKSPACE_DIR ?? 'workspace'),
    port: positiveInteger('WORKER_PORT', env.WORKER_PORT, 4200),
    workerId: env.WORKER_ID ?? `${os.hostname()}-${process.pid}`,
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
