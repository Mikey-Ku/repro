import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb } from './client.js';

/**
 * Delete sessions older than their project's retention window.
 * Cascades remove chunks, incidents, tests, runs and findings.
 */
export async function applyRetention(url?: string): Promise<number> {
  const handle = createDb(url, { max: 1 });
  try {
    const result = await handle.sql`
      DELETE FROM sessions s
      USING projects p
      WHERE s.project_id = p.id
        AND s.started_at < now() - (p.retention_days || ' days')::interval
    `;
    return result.count;
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applyRetention()
    .then((count) => console.log(`[db] retention removed ${count} session(s)`))
    .catch((error) => {
      console.error('[db] retention failed', error);
      process.exit(1);
    });
}
