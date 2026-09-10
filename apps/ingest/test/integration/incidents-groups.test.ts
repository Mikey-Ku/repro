import { randomUUID } from 'node:crypto';
import { IncidentGroupSchema, type IncidentGroup } from '@repro/contracts';
import { incidents, type IncidentRow } from '@repro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T0, batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

/**
 * Project A has three sessions that all hit the same bug (fingerprint fp-shared) plus one session
 * with a second, already resolved bug (fp-other). Project B has one session with fp-shared too,
 * which must never leak into A's counts. Incidents are inserted directly, the way the worker
 * writes them, so timestamps, releases and routes are exact.
 */
describe('GET /api/projects/:projectId/incidents/groups', () => {
  let env: TestEnv;
  let a: TestProject;
  let b: TestProject;
  const sessions = { s1: randomUUID(), s2: randomUUID(), s3: randomUUID(), s4: randomUUID() };
  let latestShared: IncidentRow;

  const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

  async function recordSession(key: string, sessionId: string, release: string, route: string): Promise<void> {
    const res = await postBatch(
      env.app,
      key,
      batch(sessionId, 0, [ev.nav(0, `http://localhost:4100${route}`), ev.error(1, 'Boom')], { meta: meta({ release }) }),
    );
    expect(res.statusCode, res.body).toBe(200);
  }

  type Seed = Pick<IncidentRow, 'projectId' | 'sessionId' | 'fingerprint' | 'title' | 'release' | 'route' | 'status'> & { offsetMs: number };

  async function insertIncident(seed: Seed): Promise<IncidentRow> {
    const [row] = await env.db
      .insert(incidents)
      .values({
        projectId: seed.projectId,
        sessionId: seed.sessionId,
        kind: 'exception',
        title: seed.title,
        message: 'Boom',
        fingerprint: seed.fingerprint,
        firstSeq: 1,
        firstTs: new Date(T0 + seed.offsetMs),
        offsetMs: seed.offsetMs,
        route: seed.route,
        release: seed.release,
        status: seed.status,
      })
      .returning();
    if (!row) throw new Error('incident insert returned no row');
    return row;
  }

  async function groups(projectId: string, query = ''): Promise<IncidentGroup[]> {
    const res = await api(env.app, 'GET', `/api/projects/${projectId}/incidents/groups${query}`);
    expect(res.statusCode, res.body).toBe(200);
    const { items } = res.json<{ items: unknown[] }>();
    // Every item must satisfy the contract the dashboard parses with.
    return items.map((item) => IncidentGroupSchema.parse(item));
  }

  beforeAll(async () => {
    env = await startTestApp();
    a = await createTestProject(env.db, 'A');
    b = await createTestProject(env.db, 'B');

    await recordSession(a.key, sessions.s1, 'v1.0.0', '/checkout');
    await recordSession(a.key, sessions.s2, 'v1.1.0', '/checkout');
    await recordSession(a.key, sessions.s3, 'v1.1.0', '/cart');
    await recordSession(b.key, sessions.s4, 'v9.0.0', '/checkout');

    const shared = { projectId: a.project.id, fingerprint: 'fp-shared', title: 'TypeError: Boom' } as const;
    await insertIncident({ ...shared, sessionId: sessions.s1, release: 'v1.0.0', route: '/checkout', status: 'open', offsetMs: 100 });
    await insertIncident({ ...shared, sessionId: sessions.s2, release: 'v1.1.0', route: '/checkout', status: 'open', offsetMs: 200 });
    latestShared = await insertIncident({ ...shared, sessionId: sessions.s3, title: 'TypeError: Boom (latest)', release: 'v1.1.0', route: '/cart', status: 'resolved', offsetMs: 300 });
    // Seen later than any fp-shared incident, so it must sort first even though it has fewer sessions.
    await insertIncident({ projectId: a.project.id, sessionId: sessions.s1, fingerprint: 'fp-other', title: 'RangeError: Other', release: 'v1.0.0', route: null, status: 'resolved', offsetMs: 5000 });
    // Same fingerprint in another project.
    await insertIncident({ projectId: b.project.id, sessionId: sessions.s4, fingerprint: 'fp-shared', title: 'TypeError: Boom', release: 'v9.0.0', route: '/checkout', status: 'open', offsetMs: 400 });
  });

  afterAll(async () => {
    await deleteTestProject(env.db, a.project.id);
    await deleteTestProject(env.db, b.project.id);
    await env.close();
  });

  it('folds incidents across sessions by fingerprint and orders groups by lastSeen desc', async () => {
    const items = await groups(a.project.id);
    expect(items.map((g) => g.fingerprint)).toEqual(['fp-other', 'fp-shared']);

    const shared = items[1]!;
    expect(shared).toMatchObject({
      kind: 'exception',
      title: 'TypeError: Boom (latest)',
      message: 'Boom',
      sessionCount: 3,
      openCount: 2,
      firstSeen: iso(100),
      lastSeen: iso(300),
      releases: ['v1.0.0', 'v1.1.0'],
      routes: ['/cart', '/checkout'],
      latestIncidentId: latestShared.id,
      latestSessionId: sessions.s3,
    });

    const other = items[0]!;
    expect(other).toMatchObject({ sessionCount: 1, openCount: 0, firstSeen: iso(5000), lastSeen: iso(5000), releases: ['v1.0.0'], routes: [] });
  });

  it('filters by derived group status without changing the counts inside a group', async () => {
    const open = await groups(a.project.id, '?status=open');
    expect(open.map((g) => g.fingerprint)).toEqual(['fp-shared']);
    expect(open[0]).toMatchObject({ sessionCount: 3, openCount: 2 });

    const resolved = await groups(a.project.id, '?status=resolved');
    expect(resolved.map((g) => g.fingerprint)).toEqual(['fp-other']);
  });

  it('honours limit after ordering', async () => {
    const items = await groups(a.project.id, '?limit=1');
    expect(items.map((g) => g.fingerprint)).toEqual(['fp-other']);
  });

  it('does not count another project\'s incidents, even with the same fingerprint', async () => {
    const items = await groups(b.project.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ fingerprint: 'fp-shared', sessionCount: 1, openCount: 1, releases: ['v9.0.0'], latestSessionId: sessions.s4 });
  });

  it('reports open groups in project stats separately from open rows', async () => {
    const res = await api(env.app, 'GET', `/api/projects/${a.project.id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().stats).toMatchObject({ openIncidents: 2, openIncidentGroups: 1 });
  });

  it('rejects an invalid status filter', async () => {
    const res = await api(env.app, 'GET', `/api/projects/${a.project.id}/incidents/groups?status=nope`);
    expect(res.statusCode).toBe(400);
  });
});
