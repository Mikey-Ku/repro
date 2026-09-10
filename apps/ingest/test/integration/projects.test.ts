import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { IngestionKeySchema, ProjectSchema, ProjectStatsSchema } from '@repro/contracts';
import { sessions } from '@repro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

describe('projects and keys', () => {
  let env: TestEnv;
  let tp: TestProject;
  const created: string[] = [];

  beforeAll(async () => {
    env = await startTestApp();
    tp = await createTestProject(env.db);
  });
  afterAll(async () => {
    for (const id of created) await deleteTestProject(env.db, id);
    await deleteTestProject(env.db, tp.project.id);
    await env.close();
  });

  it('requires the internal token on every /api route', async () => {
    for (const url of ['/api/me', '/api/projects', `/api/projects/${tp.project.id}`, `/api/projects/${tp.project.id}/sessions`]) {
      expectError(await env.app.inject({ method: 'GET', url }), 401, 'unauthorized');
      expectError(await env.app.inject({ method: 'GET', url, headers: { 'x-repro-internal-token': 'wrong' } }), 401, 'unauthorized');
    }
    // The public route does not accept the internal token as a key.
    expectError(await postBatch(env.app, null, {}, { headers: { 'x-repro-internal-token': 'test-internal-token' } }), 401, 'unauthorized');
  });

  it('GET /api/me and GET /api/projects list the local user and projects', async () => {
    const me = await api(env.app, 'GET', '/api/me');
    expect(me.statusCode, me.body).toBe(200);
    const body = me.json<{ user: { id: string; email: string; name: string }; projects: unknown[] }>();
    expect(body.user.email).toContain('@');
    expect(body.projects.map((p) => ProjectSchema.parse(p).id)).toContain(tp.project.id);

    const all = await api(env.app, 'GET', '/api/projects');
    expect(all.json<{ id: string }[]>().map((p) => p.id)).toContain(tp.project.id);
  });

  it('creates projects, refuses duplicate slugs and validates input', async () => {
    const slug = `made-${randomUUID().slice(0, 8)}`;
    const res = await api(env.app, 'POST', '/api/projects', { name: 'Made in test', slug });
    expect(res.statusCode, res.body).toBe(201);
    const project = ProjectSchema.parse(res.json());
    created.push(project.id);
    expect(project).toMatchObject({ name: 'Made in test', slug, retentionDays: 30 });

    expectError(await api(env.app, 'POST', '/api/projects', { name: 'Again', slug }), 409, 'conflict');
    expectError(await api(env.app, 'POST', '/api/projects', { name: '', slug: 'ok-slug' }), 400, 'validation_failed');
    expectError(await api(env.app, 'POST', '/api/projects', { name: 'x', slug: 'Not A Slug' }), 400, 'validation_failed');
    expectError(await api(env.app, 'POST', '/api/projects', {}), 400, 'validation_failed');

    const bySlug = await api(env.app, 'GET', `/api/projects/by-slug/${slug}`);
    expect(bySlug.statusCode).toBe(200);
    expect(bySlug.json()).toMatchObject({ id: project.id, stats: { sessions: 0, lastSessionAt: null } });
  });

  it('reports stats for a project', async () => {
    const sessionId = randomUUID();
    await postBatch(env.app, tp.key, batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/'), ev.error(1, 'Boom')], { meta: meta({ startedAt: 1_800_000_000_000 }), final: true }));
    await postBatch(env.app, tp.key, batch(randomUUID(), 0, [ev.nav(0, 'http://localhost:4100/')], { meta: meta() }));
    const res = await api(env.app, 'GET', `/api/projects/${tp.project.id}`);
    expect(res.statusCode).toBe(200);
    expect(ProjectSchema.parse(res.json())).toMatchObject({ id: tp.project.id });
    const stats = ProjectStatsSchema.parse(res.json().stats);
    expect(stats).toMatchObject({ sessions: 2, sessionsWithErrors: 1, openIncidents: 0, generatedTests: 0, runs: 0 });
    expect(stats.lastSessionAt).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it('creates, lists and revokes ingestion keys, showing the plaintext only once', async () => {
    const res = await api(env.app, 'POST', `/api/projects/${tp.project.id}/keys`, { label: 'CI' });
    expect(res.statusCode, res.body).toBe(201);
    const { key, ...dto } = res.json<{ key: string } & Record<string, unknown>>();
    expect(key).toMatch(/^rp_[A-Za-z0-9_-]{20,}$/);
    const parsed = IngestionKeySchema.parse(dto);
    expect(parsed).toMatchObject({ projectId: tp.project.id, label: 'CI', prefix: key.slice(0, 11), revokedAt: null });

    const list = await api(env.app, 'GET', `/api/projects/${tp.project.id}/keys`);
    const rows = list.json<Record<string, unknown>[]>();
    expect(rows.map((k) => IngestionKeySchema.parse(k).id)).toContain(parsed.id);
    expect(list.body).not.toContain(key);
    expect(list.body).not.toContain('keyHash');

    expect((await api(env.app, 'DELETE', `/api/projects/${tp.project.id}/keys/${parsed.id}`)).json()).toEqual({ ok: true });
    const after = (await api(env.app, 'GET', `/api/projects/${tp.project.id}/keys`)).json<{ id: string; revokedAt: string | null }[]>();
    expect(after.find((k) => k.id === parsed.id)?.revokedAt).not.toBeNull();
    expectError(await api(env.app, 'DELETE', `/api/projects/${tp.project.id}/keys/${parsed.id}`), 404, 'not_found');
    expectError(await api(env.app, 'POST', `/api/projects/${tp.project.id}/keys`, { label: '' }), 400, 'validation_failed');
  });

  it('deletes a project and everything under it', async () => {
    const other = await createTestProject(env.db);
    const sessionId = randomUUID();
    await postBatch(env.app, other.key, batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/')], { meta: meta() }));
    expect((await api(env.app, 'DELETE', `/api/projects/${other.project.id}`)).json()).toEqual({ ok: true });
    expectError(await api(env.app, 'GET', `/api/projects/${other.project.id}`), 404, 'not_found');
    expect(await env.db.select().from(sessions).where(eq(sessions.id, sessionId))).toHaveLength(0);
    expectError(await postBatch(env.app, other.key, batch(randomUUID(), 0, [], { meta: meta() })), 401, 'unauthorized');
  });
});
