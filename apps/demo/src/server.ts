import path from 'node:path';
import { createApp } from './app.js';
import { findRepoRoot, loadDotEnv, readConfig } from './env.js';
import { demoRoot } from './paths.js';

// Load the repo root .env (if any) without overriding variables already in the environment.
const repoRoot = findRepoRoot(demoRoot);
if (repoRoot) loadDotEnv(path.join(repoRoot, '.env'));

const config = readConfig();
const app = createApp({
  mode: config.mode,
  projectKey: config.projectKey,
  ingestUrl: config.ingestUrl,
  release: config.release,
  logger: true,
});

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[demo] Northwind Supply listening on http://localhost:${config.port} (mode: ${config.mode}, release: ${config.release})`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
