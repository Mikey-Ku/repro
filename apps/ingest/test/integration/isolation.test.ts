import { randomUUID } from 'node:crypto';
import { incidents } from '@repro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T0, batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

/**
 * Two projects, A and B. Everything created under A must be invisible through B: appends are
 * refused with 403 on the public API, and reads answer 404 (never 403) on the internal API so
 * the response does not confirm that the resource exists.
 */
describe('project isolation', () => {
  let env: TestEnv;
  let a: TestProject;
  let b: TestProject;
  const sessionId = randomUUID();
  let incidentId: string;
  let testId: string;
  let runId: string;

  beforeAll(async () => {
    env = await startTestApp();
    a = await createTestProject(env.db, 'A');
    b = await createTestProject(env.db, 'B');

    const res = await postBatch(
      env.app,
      a.key,
      batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/checkout'), ev.click(1, 'Pay'), ev.error(2, 'Boom')], { meta: meta() }),
    );
    expect(res.statusCode, res.body).toBe(200);

    const [incident] = await env.db
      .insert(incidents)
      .values({
        projectId: a.project.id,
        sessionId,
        kind: 'exception',
        title: 'TypeError: Boom',
        message: 'Boom',
        fingerprint: 'fp-1',
        firstSeq: 2,
        firstTs: new Date(T0 + 200),
        offsetMs: 200,
        route: '/checkout',
        release: 'v1.0.0',
      })
      .returning();
    incidentId = incident!.id;

    const test = await api(env.app, 'POST', `/api/projects/${a.project.id}/sessions/${sessionId}/tests`, {});
    expect(test.statusCode, test.body).toBe(201);
    testId = test.json<{ id: string }>().id;

    const run = await api(env.app, 'POST', `/api/projects/${a.project.id}/tests/${testId}/runs`, { mode: 'broken' });
    expect(run.statusCode, run.body).toBe(201);
    runId = run.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await deleteTestProject(env.db, a.project.id);
    await deleteTestProject(env.db, b.project.id);
    await env.close();
  });

  it('refuses to append to a session owned by another project', async () => {
    const res = await postBatch(env.app, b.key, batch(sessionId, 1, [ev.click(3, 'Hijack')]));
    expectError(res, 403, 'forbidden');
    // Nothing was written: the session still has one chunk.
    const detail = await api(env.app, 'GET', `/api/projects/${a.project.id}/sessions/${sessionId}`);
    expect(detail.json().session).toMatchObject({ chunkCount: 1, eventCount: 3 });
  });

  it('answers 404 for foreign sessions, incidents, tests and runs', async () => {
    const B = `/api/projects/${b.project.id}`;
    const foreign = [
      ['GET', `${B}/sessions/${sessionId}`],
      ['GET', `${B}/sessions/${sessionId}/events`],
      ['GET', `${B}/sessions/${sessionId}/timeline`],
      ['DELETE', `${B}/sessions/${sessionId}`],
      ['GET', `${B}/sessions/${sessionId}/tests`],
      ['POST', `${B}/sessions/${sessionId}/tests`],
      ['GET', `${B}/sessions/${sessionId}/findings`],
      ['POST', `${B}/sessions/${sessionId}/investigate`],
      ['GET', `${B}/incidents/${incidentId}`],
      ['PATCH', `${B}/incidents/${incidentId}`],
      ['GET', `${B}/tests/${testId}`],
      ['GET', `${B}/tests/${testId}/code`],
      ['GET', `${B}/tests/${testId}/runs`],
      ['POST', `${B}/tests/${testId}/runs`],
      ['GET', `${B}/runs/${runId}`],
      ['GET', `${B}/runs/${runId}/artifacts/screenshot.png`],
    ] as const;
    for (const [method, url] of foreign) {
      const body = method === 'PATCH' ? { status: 'resolved' } : method === 'POST' ? {} : undefined;
      const res = await api(env.app, method, url, body);
      expect(res.statusCode, `${method} ${url} -> ${res.body}`).toBe(404);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('not_found');
    }
    // The session was not deleted through the foreign DELETE.
    expect((await api(env.app, 'GET', `/api/projects/${a.project.id}/sessions/${sessionId}`)).statusCode).toBe(200);
  });

  it('never leaks across projects in list endpoints', async () => {
    const B = `/api/projects/${b.project.id}`;
    expect((await api(env.app, 'GET', `${B}/sessions`)).json()).toMatchObject({ items: [], nextCursor: null, facets: { releases: [], routes: [], browsers: [] } });
    expect((await api(env.app, 'GET', `${B}/incidents`)).json()).toEqual({ items: [] });

    const A = `/api/projects/${a.project.id}`;
    expect((await api(env.app, 'GET', `${A}/sessions`)).json<{ items: { id: string }[] }>().items.map((s) => s.id)).toEqual([sessionId]);
    expect((await api(env.app, 'GET', `${A}/incidents`)).json<{ items: { id: string }[] }>().items.map((i) => i.id)).toEqual([incidentId]);
    // Stats are per project too.
    expect((await api(env.app, 'GET', A)).json().stats).toMatchObject({ sessions: 1, sessionsWithErrors: 1, openIncidents: 1, generatedTests: 1, runs: 1 });
    expect((await api(env.app, 'GET', B)).json().stats).toMatchObject({ sessions: 0, sessionsWithErrors: 0, openIncidents: 0, generatedTests: 0, runs: 0, lastSessionAt: null });
  });

  it('answers 404 for unknown projects and non-uuid ids instead of leaking database errors', async () => {
    expectError(await api(env.app, 'GET', `/api/projects/${randomUUID()}`), 404, 'not_found');
    expectError(await api(env.app, 'GET', '/api/projects/not-a-uuid'), 404, 'not_found');
    expectError(await api(env.app, 'GET', `/api/projects/${a.project.id}/sessions/not-a-uuid`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `/api/projects/${a.project.id}/tests/not-a-uuid`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `/api/projects/${a.project.id}/runs/nope`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `/api/projects/${a.project.id}/incidents/nope`), 404, 'not_found');
    expectError(await api(env.app, 'GET', '/api/projects/by-slug/does-not-exist'), 404, 'not_found');
  });
});
