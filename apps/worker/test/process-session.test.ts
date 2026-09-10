import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diagnosticFindings, incidents, jobs, sessions, type DbHandle } from '@repro/db';
import { loadSessionEvents } from '../src/events.js';
import { processSession } from '../src/jobs/process-session.js';
import { expireStaleSessions, SESSION_IDLE_MS } from '../src/maintenance.js';
import { checkoutEvents, connect, createProject, createSession, deleteProject, storeChunks } from './support/db.js';

let handle: DbHandle;
let projectId: string;

beforeAll(async () => {
  handle = connect();
  projectId = await createProject(handle.db);
});

afterAll(async () => {
  await handle.db.delete(jobs).where(like(jobs.dedupeKey, 'process_session:%'));
  await deleteProject(handle.db, projectId);
  await handle.close();
});

describe('loadSessionEvents (Postgres)', () => {
  it('decodes chunks stored out of order and drops duplicated seqs', async () => {
    const { db } = handle;
    const sessionId = await createSession(db, projectId);
    const events = checkoutEvents();
    // Batch 0 holds the tail, batch 1 the head plus a retried copy of seq 3.
    await storeChunks(db, sessionId, [events.slice(3), [...events.slice(0, 3), events[3]!]]);

    const loaded = await loadSessionEvents(db, sessionId);
    expect(loaded.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('processSession (Postgres)', () => {
  it('inserts incidents once, stores an evidence finding and refreshes the counters', async () => {
    const { db } = handle;
    const sessionId = await createSession(db, projectId);
    await storeChunks(db, sessionId, [checkoutEvents()]);

    const first = await processSession(db, { projectId, sessionId });
    expect(first.events).toBe(7);
    // The uncaught TypeError and the 500 become incidents; the console error is folded into the
    // uncaught error (browsers log those to the console too), so it is not a third incident.
    expect(first.incidentsFound).toBe(2);
    expect(first.incidentsInserted).toBe(2);
    expect(first).toMatchObject({ errorCount: 1, networkFailureCount: 1, routes: ['/login', '/checkout', '/orders/:id'] });

    const stored = await db.select().from(incidents).where(eq(incidents.sessionId, sessionId));
    expect(stored.map((i) => i.kind).sort()).toEqual(['exception', 'network']);
    expect(stored.every((i) => i.projectId === projectId && i.release === '1.4.2')).toBe(true);
    const exception = stored.find((i) => i.kind === 'exception')!;
    expect(exception.title).toContain('TypeError');
    expect(exception.route).toBe('/checkout');
    expect(exception.offsetMs).toBe(2000);

    const findings = await db.select().from(diagnosticFindings).where(eq(diagnosticFindings.sessionId, sessionId));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'evidence', provider: 'deterministic', model: null, projectId });
    const evidence = findings[0]!.evidence as { earliestError: { name?: string } | null; failedRequests: unknown[] };
    expect(evidence.earliestError?.name).toBe('TypeError');
    expect(evidence.failedRequests).toHaveLength(1);

    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(session).toMatchObject({ errorCount: 1, networkFailureCount: 1, routes: ['/login', '/checkout', '/orders/:id'] });

    // Re-processing (a retried job, a duplicate upload) must not duplicate anything.
    const second = await processSession(db, { projectId, sessionId });
    expect(second.incidentsInserted).toBe(0);
    expect(second.incidentsFound).toBe(2);
    expect(await db.select().from(incidents).where(eq(incidents.sessionId, sessionId))).toHaveLength(2);
    expect(await db.select().from(diagnosticFindings).where(eq(diagnosticFindings.sessionId, sessionId))).toHaveLength(1);
  });

  it('handles a session without events', async () => {
    const { db } = handle;
    const sessionId = await createSession(db, projectId);
    const result = await processSession(db, { projectId, sessionId });
    expect(result).toMatchObject({ events: 0, incidentsFound: 0, incidentsInserted: 0, errorCount: 0, routes: ['/login'] });
    expect(await db.select().from(diagnosticFindings).where(eq(diagnosticFindings.sessionId, sessionId))).toHaveLength(1);
  });

  it('refuses a session that belongs to another project', async () => {
    const { db } = handle;
    const other = await createProject(db);
    try {
      const sessionId = await createSession(db, other);
      await expect(processSession(db, { projectId, sessionId })).rejects.toThrow(/not found/);
    } finally {
      await deleteProject(db, other);
    }
  });
});

describe('expireStaleSessions (Postgres)', () => {
  it('expires recording sessions idle for 30 minutes and enqueues their processing once', async () => {
    const { db } = handle;
    const now = new Date();
    const stale = await createSession(db, projectId, { status: 'recording', lastSeenAt: new Date(now.getTime() - SESSION_IDLE_MS - 1000) });
    const fresh = await createSession(db, projectId, { status: 'recording', lastSeenAt: new Date(now.getTime() - 60_000) });
    const done = await createSession(db, projectId, { status: 'completed', lastSeenAt: new Date(now.getTime() - SESSION_IDLE_MS - 1000) });

    const expired = await expireStaleSessions(db, now);
    expect(expired).toEqual([stale]);

    const rows = await db.select().from(sessions).where(eq(sessions.projectId, projectId));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(stale)).toMatchObject({ status: 'expired' });
    expect(byId.get(stale)!.endedAt).toEqual(byId.get(stale)!.lastSeenAt);
    expect(byId.get(fresh)).toMatchObject({ status: 'recording' });
    expect(byId.get(done)).toMatchObject({ status: 'completed' });

    const queued = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, 'process_session'), eq(jobs.dedupeKey, `process_session:${stale}`)));
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toEqual({ projectId, sessionId: stale });

    // A second pass finds nothing new and does not queue a second job.
    expect(await expireStaleSessions(db, now)).toEqual([]);
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, `process_session:${stale}`))).toHaveLength(1);
  });
});
