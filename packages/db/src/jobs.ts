import { and, eq, lte, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { jobs, type JobRow } from './schema.js';

export interface EnqueueOptions {
  dedupeKey?: string;
  runAfter?: Date;
  maxAttempts?: number;
}

/** Insert a job. When `dedupeKey` is given and already queued, the existing job is returned. */
export async function enqueueJob(
  db: Db,
  kind: string,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<JobRow> {
  const values = {
    kind,
    payload,
    dedupeKey: options.dedupeKey ?? null,
    runAfter: options.runAfter ?? new Date(),
    maxAttempts: options.maxAttempts ?? 3,
  };
  if (options.dedupeKey) {
    const [row] = await db
      .insert(jobs)
      .values(values)
      .onConflictDoUpdate({
        target: jobs.dedupeKey,
        set: { updatedAt: new Date() },
      })
      .returning();
    return row!;
  }
  const [row] = await db.insert(jobs).values(values).returning();
  return row!;
}

/** Claim the next runnable job using SKIP LOCKED so several workers can poll safely. */
export async function claimJob(db: Db, workerId: string, kinds?: string[]): Promise<JobRow | null> {
  return db.transaction(async (tx) => {
    // Drizzle expands a JS array parameter to `($1, $2, ...)`, which fits IN but not ANY.
    const kindFilter = kinds && kinds.length ? sql`AND kind IN ${kinds}` : sql``;
    const rows = await tx.execute<JobRow>(sql`
      SELECT * FROM jobs
      WHERE status = 'queued' AND run_after <= now() ${kindFilter}
      ORDER BY run_after ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    const candidate = (rows as unknown as { rows?: JobRow[] }).rows?.[0] ?? (rows as unknown as JobRow[])[0];
    if (!candidate) return null;
    const [claimed] = await tx
      .update(jobs)
      .set({ status: 'running', lockedAt: new Date(), lockedBy: workerId, attempts: sql`${jobs.attempts} + 1`, updatedAt: new Date() })
      .where(eq(jobs.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

export async function completeJob(db: Db, id: string): Promise<void> {
  await db.update(jobs).set({ status: 'done', updatedAt: new Date(), lockedAt: null, lockedBy: null }).where(eq(jobs.id, id));
}

export async function failJob(db: Db, job: JobRow, error: unknown, backoffMs = 5_000): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const exhausted = job.attempts >= job.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: exhausted ? 'failed' : 'queued',
      lastError: message.slice(0, 4000),
      runAfter: new Date(Date.now() + backoffMs * job.attempts),
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
}

/** Requeue jobs whose worker died mid-run. */
export async function reapStaleJobs(db: Db, staleAfterMs = 10 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const rows = await db
    .update(jobs)
    .set({ status: 'queued', lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(and(eq(jobs.status, 'running'), lte(jobs.lockedAt, cutoff)))
    .returning({ id: jobs.id });
  return rows.length;
}
