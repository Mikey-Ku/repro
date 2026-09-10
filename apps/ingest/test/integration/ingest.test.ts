import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { IngestResponseSchema, SessionMetaSchema, SessionSummarySchema } from '@repro/contracts';
import { jobs } from '@repro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

describe('POST /v1/ingest', () => {
  let env: TestEnv;
  let tp: TestProject;

  beforeAll(async () => {
    env = await startTestApp();
    tp = await createTestProject(env.db);
  });
  afterAll(async () => {
    await deleteTestProject(env.db, tp.project.id);
    await env.close();
  });

  const sessionUrl = (sessionId: string) => `/api/projects/${tp.project.id}/sessions/${sessionId}`;

  it('creates the session from the first batch, keeps counters, and serves events in seq order', async () => {
    const sessionId = randomUUID();
    const first = [ev.nav(0, 'http://localhost:4100/login'), ev.fill(1, 'email', 'a@b.c'), ev.click(2, 'Sign in')];
    const second = [
      ev.nav(3, 'http://localhost:4100/checkout/123', 'push'),
      ev.network(4, '/api/pay', 500),
      ev.error(5, 'Cannot read properties of undefined'),
      ev.error(6, 'handled one', { handled: true }),
      ev.consoleError(7, 'oops'),
      ev.identify(8, 'user_42'),
      ev.rrweb(9),
    ];

    const r1 = await postBatch(env.app, tp.key, batch(sessionId, 0, first, { meta: meta() }));
    expect(r1.statusCode, r1.body).toBe(200);
    expect(IngestResponseSchema.parse(r1.json())).toEqual({ ok: true, sessionId, batchSeq: 0, accepted: true, duplicate: false });

    const r2 = await postBatch(env.app, tp.key, batch(sessionId, 1, second));
    expect(r2.statusCode, r2.body).toBe(200);
    expect(r2.json()).toMatchObject({ accepted: true, duplicate: false, batchSeq: 1 });

    const detail = await api(env.app, 'GET', sessionUrl(sessionId));
    expect(detail.statusCode, detail.body).toBe(200);
    const session = SessionSummarySchema.parse(detail.json().session);
    expect(session).toMatchObject({
      id: sessionId,
      projectId: tp.project.id,
      status: 'recording',
      endedAt: null,
      durationMs: null,
      release: 'v1.0.0',
      browserName: 'Chrome',
      browserVersion: '130',
      initialUrl: 'http://localhost:4100/login',
      initialRoute: '/login',
      eventCount: 10,
      chunkCount: 2,
      // Only unhandled errors count.
      errorCount: 1,
      networkFailureCount: 1,
      externalUserId: 'user_42',
      sdkVersion: '0.1.0',
      viewportWidth: 1280,
    });
    expect(session.routes).toEqual(['/login', '/checkout/:id']);
    expect(detail.json()).toMatchObject({ incidents: [], tests: [], findings: [] });

    const events = await api(env.app, 'GET', `${sessionUrl(sessionId)}/events`);
    expect(events.statusCode).toBe(200);
    const body = events.json<{ events: { seq: number; type: string }[]; meta: unknown }>();
    expect(body.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(SessionMetaSchema.parse(body.meta).page.url).toBe('http://localhost:4100/login');

    const filtered = await api(env.app, 'GET', `${sessionUrl(sessionId)}/events?types=navigation,error`);
    expect(filtered.json<{ events: { seq: number }[] }>().events.map((e) => e.seq)).toEqual([0, 3, 5, 6]);

    expectError(await api(env.app, 'GET', `${sessionUrl(sessionId)}/events?types=navigation,evil`), 400, 'validation_failed');
  });

  it('acknowledges a repeated (sessionId, batchSeq) as a duplicate without storing it twice', async () => {
    const sessionId = randomUUID();
    const b = batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/'), ev.click(1, 'Go')], { meta: meta() });
    expect((await postBatch(env.app, tp.key, b)).json()).toMatchObject({ accepted: true, duplicate: false });
    const again = await postBatch(env.app, tp.key, b);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ accepted: false, duplicate: true, batchSeq: 0 });

    const detail = await api(env.app, 'GET', sessionUrl(sessionId));
    expect(detail.json().session).toMatchObject({ eventCount: 2, chunkCount: 1 });
    const events = await api(env.app, 'GET', `${sessionUrl(sessionId)}/events`);
    expect(events.json<{ events: unknown[] }>().events).toHaveLength(2);
  });

  it('merges out-of-order batches by seq and dedupes overlapping events', async () => {
    const sessionId = randomUUID();
    await postBatch(env.app, tp.key, batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/')], { meta: meta() }));
    // Batch 2 arrives before batch 1, and both carry seq 3 (an SDK retry overlap).
    await postBatch(env.app, tp.key, batch(sessionId, 2, [ev.click(3, 'Late'), ev.click(4, 'Later')]));
    const r = await postBatch(env.app, tp.key, batch(sessionId, 1, [ev.click(1, 'Early'), ev.click(2, 'Then'), ev.click(3, 'Late')]));
    expect(r.statusCode).toBe(200);

    const events = await api(env.app, 'GET', `${sessionUrl(sessionId)}/events`);
    const list = events.json<{ events: { seq: number; data: { target: { text: string } } }[] }>().events;
    expect(list.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    const detail = await api(env.app, 'GET', sessionUrl(sessionId));
    expect(detail.json().session).toMatchObject({ chunkCount: 3 });
  });

  it('completes the session on final and enqueues exactly one process_session job', async () => {
    const sessionId = randomUUID();
    await postBatch(env.app, tp.key, batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/')], { meta: meta() }));
    const fin = await postBatch(env.app, tp.key, batch(sessionId, 1, [ev.click(1, 'Done')], { final: true }));
    expect(fin.statusCode, fin.body).toBe(200);

    const detail = await api(env.app, 'GET', sessionUrl(sessionId));
    const session = SessionSummarySchema.parse(detail.json().session);
    expect(session.status).toBe('completed');
    expect(session.endedAt).not.toBeNull();
    expect(session.durationMs).toBeGreaterThanOrEqual(0);

    const countJobs = async () =>
      (
        await env.db
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(jobs)
          .where(and(eq(jobs.kind, 'process_session'), sql`${jobs.payload}->>'sessionId' = ${sessionId}`))
      )[0]?.n;
    expect(await countJobs()).toBe(1);

    // A duplicate of the final batch and a second, different final batch both keep the count at one.
    await postBatch(env.app, tp.key, batch(sessionId, 1, [ev.click(1, 'Done')], { final: true }));
    await postBatch(env.app, tp.key, batch(sessionId, 2, [ev.click(2, 'Really done')], { final: true }));
    expect(await countJobs()).toBe(1);
    const [job] = await env.db.select().from(jobs).where(sql`${jobs.payload}->>'sessionId' = ${sessionId}`);
    expect(job).toMatchObject({ kind: 'process_session', status: 'queued', payload: { projectId: tp.project.id, sessionId } });
  });

  it('accepts sendBeacon style uploads (text/plain with ?key=) and gzip bodies', async () => {
    const sessionId = randomUUID();
    const beacon = await postBatch(env.app, tp.key, batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/')], { meta: meta() }), {
      keyInQuery: true,
      contentType: 'text/plain',
    });
    expect(beacon.statusCode, beacon.body).toBe(200);
    const gz = await postBatch(env.app, tp.key, batch(sessionId, 1, [ev.click(1, 'Zip')]), { gzip: true });
    expect(gz.statusCode, gz.body).toBe(200);
    const detail = await api(env.app, 'GET', sessionUrl(sessionId));
    expect(detail.json().session).toMatchObject({ eventCount: 2, chunkCount: 2 });
  });

  it('answers CORS preflight for the public route without a key', async () => {
    const res = await env.app.inject({
      method: 'OPTIONS',
      url: '/v1/ingest',
      headers: { origin: 'http://shop.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-repro-key' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(String(res.headers['access-control-allow-headers'])).toContain('x-repro-key');
  });

  it('deletes a session with everything under it', async () => {
    const sessionId = randomUUID();
    await postBatch(env.app, tp.key, batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/')], { meta: meta() }));
    expect((await api(env.app, 'DELETE', sessionUrl(sessionId))).json()).toEqual({ ok: true });
    expectError(await api(env.app, 'GET', sessionUrl(sessionId)), 404, 'not_found');
    expectError(await api(env.app, 'DELETE', sessionUrl(sessionId)), 404, 'not_found');
  });
});
