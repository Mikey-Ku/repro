import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './env.js';

export const canaries: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps', 'demo', 'canaries.json'), 'utf8'),
);
