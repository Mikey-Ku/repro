import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimJob, completeJob, createDb, enqueueJob, failJob, jobs, reapStaleJobs, type DbHandle } from '../src/index.js';

/**
 * The job queue is what connects ingestion to the worker. These tests run against the real
 * Postgres from DATABASE_URL and use a unique job kind per run so they never touch real jobs.
 */
const url = process.env.DATABASE_URL ?? 'postgres://repro:repro@localhost:5432/repro';
const kind = `test_${randomUUID().slice(0, 8)}`;
let handle: DbHandle;

beforeAll(() => {
  handle = createDb(url, { max: 2 });
});

afterAll(async () => {
  await handle.db.delete(jobs).where(eq(jobs.kind, kind));
  await handle.close();
});

describe('job queue', () => {
  it('deduplicates on dedupeKey and claims with a kind filter', async () => {
    const key = `${kind}:dedupe`;
    const first = await enqueueJob(handle.db, kind, { n: 1 }, { dedupeKey: key });
    const second = await enqueueJob(handle.db, kind, { n: 2 }, { dedupeKey: key });
    expect(second.id).toBe(first.id);

    expect(await claimJob(handle.db, 'w1', ['some_other_kind'])).toBeNull();
    const claimed = await claimJob(handle.db, 'w1', [kind, 'another_kind']);
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.lockedBy).toBe('w1');

    // A running job is not claimable again.
    expect(await claimJob(handle.db, 'w2', [kind])).toBeNull();
    await completeJob(handle.db, first.id);
    const [done] = await handle.db.select().from(jobs).where(eq(jobs.id, first.id));
    expect(done?.status).toBe('done');
  });

  it('requeues a failed job with backoff until attempts are exhausted', async () => {
    const job = await enqueueJob(handle.db, kind, { n: 3 }, { maxAttempts: 2 });
    const firstClaim = await claimJob(handle.db, 'w1', [kind]);
    expect(firstClaim?.id).toBe(job.id);
    await failJob(handle.db, firstClaim!, new Error('boom'), 0);
    const [requeued] = await handle.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(requeued?.status).toBe('queued');
    expect(requeued?.lastError).toContain('boom');

    const secondClaim = await claimJob(handle.db, 'w1', [kind]);
    expect(secondClaim?.attempts).toBe(2);
    await failJob(handle.db, secondClaim!, 'still broken', 0);
    const [failed] = await handle.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(failed?.status).toBe('failed');
  });

  it('reaps jobs whose worker went silent', async () => {
    const job = await enqueueJob(handle.db, kind, { n: 4 });
    await claimJob(handle.db, 'w-dead', [kind]);
    expect(await reapStaleJobs(handle.db, 0)).toBeGreaterThanOrEqual(1);
    const [row] = await handle.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.status).toBe('queued');
    expect(row?.lockedBy).toBeNull();
  });
});
