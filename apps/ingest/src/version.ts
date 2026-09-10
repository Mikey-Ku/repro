import { readFileSync } from 'node:fs';

/**
 * The service version reported by /health. Read from this package's manifest so it stays in
 * step with the workspace version. Works both from src (tsx) and from dist (bundled by tsup),
 * because both sit one level below package.json.
 */
export function readServiceVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return manifest.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
