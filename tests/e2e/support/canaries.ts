import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './env.js';

/** The canary secrets planted in the demo application. None may leave the SDK. */
export const canaries: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps', 'demo', 'canaries.json'), 'utf8'),
);

export const canaryValues = Object.values(canaries);

/** Return the canary values found in a blob of text. Empty means clean. */
export function findCanaries(text: string): string[] {
  const found = new Set<string>();
  for (const value of canaryValues) {
    if (text.includes(value)) found.add(value);
  }
  // Also catch the bare token without the "Bearer " prefix and any CANARY_ marker.
  const marker = /CANARY_[A-Z_]+[A-Za-z0-9_]*/g;
  for (const match of text.match(marker) ?? []) found.add(match);
  return [...found];
}
