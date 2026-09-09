import { runMigrations, seed } from '@repro/db';
import { env } from './support/env.js';

/**
 * Runs once before the web servers start: migrations are idempotent and the seed
 * guarantees the demo project exists with the ingestion key the demo app will use.
 */
export default async function globalSetup(): Promise<void> {
  await runMigrations(env.databaseUrl);
  const result = await seed({ url: env.databaseUrl, key: env.demoProjectKey });
  console.log(`[e2e] demo project ${result.projectId} ready`);
}
