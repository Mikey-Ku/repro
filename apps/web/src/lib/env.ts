import 'server-only';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Server-side configuration. Only ever read on the server: the internal token
 * authenticates the dashboard to the ingest service and must never reach a browser.
 *
 * Next.js only loads .env files from the app directory (apps/web). The monorepo
 * keeps one .env at the repository root, so on first access we walk up from the
 * working directory and fill in any variable that is not already set. Existing
 * process.env values always win, which keeps container and CI overrides intact.
 */

let loaded = false;

function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      applyEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** Minimal KEY=VALUE parser: comments, blank lines and surrounding quotes are handled, nothing else. */
function applyEnvFile(path: string): void {
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function read(name: string): string | undefined {
  if (process.env[name] === undefined) loadRootEnv();
  return process.env[name];
}

export function ingestUrl(): string {
  return (read('INGEST_URL') ?? 'http://localhost:4000').replace(/\/+$/, '');
}

export function internalToken(): string {
  return read('REPRO_INTERNAL_TOKEN') ?? '';
}

export function appUrl(): string {
  return read('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000';
}
