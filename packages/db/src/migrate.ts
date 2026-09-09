import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Apply all pending SQL migrations from packages/db/drizzle. Safe to run repeatedly. */
export async function runMigrations(url?: string): Promise<void> {
  const handle = createDb(url, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: path.resolve(here, '..', 'drizzle') });
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => {
      console.log('[db] migrations applied');
    })
    .catch((error) => {
      console.error('[db] migration failed', error);
      process.exit(1);
    });
}
