import fs from 'node:fs';
import path from 'node:path';

export type DemoMode = 'broken' | 'fixed';

export interface DemoConfig {
  port: number;
  mode: DemoMode;
  projectKey: string;
  ingestUrl: string;
  release: string;
}

/** Minimal KEY=VALUE parser. Supports comments, blank lines and single or double quoted values. */
export function parseDotEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) {
      value = quoted[2] ?? '';
    } else {
      // Strip trailing inline comments on unquoted values.
      value = value.replace(/\s+#.*$/, '');
    }
    if (key) result[key] = value;
  }
  return result;
}

/** Loads a .env file into process.env without overriding variables that are already set. */
export function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const parsed = parseDotEnv(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Walks up from `start` until it finds the pnpm workspace file, so the demo can find the repo root .env. */
export function findRepoRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  const mode = env.DEMO_MODE === 'fixed' ? 'fixed' : 'broken';
  const port = Number(env.DEMO_PORT ?? 4100);
  return {
    port: Number.isFinite(port) ? port : 4100,
    mode,
    // Falls back to the key that `pnpm db:seed` creates for the local demo project.
    projectKey: env.DEMO_PROJECT_KEY || 'rp_localdemo_0123456789abcdefghijklmn',
    ingestUrl: env.INGEST_URL || 'http://localhost:4000',
    release: env.DEMO_RELEASE || 'demo@1.4.2',
  };
}
