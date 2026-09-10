import { and, eq, lt, sql } from 'drizzle-orm';
import { enqueueJob, reapStaleJobs, sessions, type Db } from '@repro/db';

export const MAINTENANCE_INTERVAL_MS = 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;

/**
 * A recording session that has not uploaded for 30 minutes will not send a final batch (the tab
 * was closed, the network dropped). Mark it expired and process what was captured so far.
 */
export async function expireStaleSessions(db: Db, now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - SESSION_IDLE_MS);
  const expired = await db
    .update(sessions)
    .set({ status: 'expired', endedAt: sql`coalesce(${sessions.endedAt}, ${sessions.lastSeenAt})`, updatedAt: now })
    .where(and(eq(sessions.status, 'recording'), lt(sessions.lastSeenAt, cutoff)))
    .returning({ id: sessions.id, projectId: sessions.projectId });

  for (const session of expired) {
    await enqueueJob(
      db,
      'process_session',
      { projectId: session.projectId, sessionId: session.id },
      { dedupeKey: `process_session:${session.id}` },
    );
  }
  return expired.map((session) => session.id);
}

export interface MaintenanceResult {
  expiredSessions: string[];
  reapedJobs: number;
}

/** The periodic housekeeping pass: expire idle sessions, requeue jobs whose worker died. */
export async function runMaintenance(db: Db): Promise<MaintenanceResult> {
  const expiredSessions = await expireStaleSessions(db);
  const reapedJobs = await reapStaleJobs(db);
  return { expiredSessions, reapedJobs };
}
