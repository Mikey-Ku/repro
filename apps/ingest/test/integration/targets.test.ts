import { randomUUID } from 'node:crypto';
import { ReproductionRunSchema, RunTargetSchema, RunTargetsResponseSchema } from '@repro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

describe('reproduction targets', () => {
  let env: TestEnv;
  let tp: TestProject;
  let other: TestProject;
  const sessionId = randomUUID();
  let testId: string;

  beforeAll(async () => {
    env = await startTestApp({ demoUrl: 'http://demo.test:4100/' });
    tp = await createTestProject(env.db);
    other = await createTestProject(env.db);
    await postBatch(env.app, tp.key, batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/'), ev.click(1, 'Go'), ev.error(2, 'Boom')], { meta: meta(), final: true }));
    const test = await api(env.app, 'POST', `/api/projects/${tp.project.id}/sessions/${sessionId}/tests`, {});
    expect(test.statusCode, test.body).toBe(201);
    testId = test.json<{ id: string }>().id;
  });
  afterAll(async () => {
    await deleteTestProject(env.db, tp.project.id);
    await deleteTestProject(env.db, other.project.id);
    await env.close();
  });

  const base = () => `/api/projects/${tp.project.id}`;

  it('lists the implicit demo target and starts with no external ones', async () => {
    const res = await api(env.app, 'GET', `${base()}/targets`);
    expect(res.statusCode, res.body).toBe(200);
    const body = RunTargetsResponseSchema.parse(res.json());
    expect(body.demo).toEqual({ id: 'demo', name: 'Bundled demo', url: 'http://demo.test:4100', kind: 'demo' });
    expect(body.targets).toEqual([]);
    expectError(await api(env.app, 'GET', `/api/projects/${randomUUID()}/targets`), 404, 'not_found');
  });

  it('creates, lists and deletes targets, storing the url as an origin', async () => {
    const created = await api(env.app, 'POST', `${base()}/targets`, { name: '  Staging  ', url: 'HTTPS://Staging.Example.com:8443/' });
    expect(created.statusCode, created.body).toBe(201);
    const target = RunTargetSchema.parse(created.json());
    expect(target).toMatchObject({ name: 'Staging', url: 'https://staging.example.com:8443', kind: 'external' });
    expect(target.id).toMatch(/^[0-9a-f]{8}$/);

    const local = RunTargetSchema.parse((await api(env.app, 'POST', `${base()}/targets`, { name: 'Local dev', url: 'http://localhost:5173' })).json());
    expect(local.id).not.toBe(target.id);

    const listed = RunTargetsResponseSchema.parse((await api(env.app, 'GET', `${base()}/targets`)).json());
    expect(listed.targets).toEqual([target, local]);
    // The project DTO carries the same list, so the dashboard needs no second call.
    const project = await api(env.app, 'GET', base());
    expect(project.json<{ runTargets: unknown[] }>().runTargets).toEqual([target, local]);

    const removed = await api(env.app, 'DELETE', `${base()}/targets/${target.id}`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(RunTargetsResponseSchema.parse((await api(env.app, 'GET', `${base()}/targets`)).json()).targets).toEqual([local]);
    expectError(await api(env.app, 'DELETE', `${base()}/targets/${target.id}`), 404, 'not_found');
    // Another project's target cannot be removed through this project.
    expectError(await api(env.app, 'DELETE', `/api/projects/${other.project.id}/targets/${local.id}`), 404, 'not_found');
  });

  it('rejects urls that are not a plain http(s) origin', async () => {
    const bad = [
      'javascript:alert(1)',
      'file:///etc/hosts',
      'ftp://example.com',
      'http://example.com/app',
      'http://example.com/?x=1',
      'http://example.com/#top',
      'http://user:secret@example.com',
      'example.com',
      '',
    ];
    for (const url of bad) {
      const res = await api(env.app, 'POST', `${base()}/targets`, { name: 'Bad', url });
      if (res.statusCode !== 400) throw new Error(`expected ${JSON.stringify(url)} to be rejected, got ${res.statusCode}: ${res.body}`);
      expectError(res, 400, 'validation_failed');
    }
    expectError(await api(env.app, 'POST', `${base()}/targets`, { name: '', url: 'http://example.com' }), 400, 'validation_failed');
    expectError(await api(env.app, 'POST', `${base()}/targets`, { url: 'http://example.com' }), 400, 'validation_failed');
    // Nothing above was stored.
    expect(RunTargetsResponseSchema.parse((await api(env.app, 'GET', `${base()}/targets`)).json()).targets).toHaveLength(1);
  });

  it('caps a project at ten targets', async () => {
    const before = RunTargetsResponseSchema.parse((await api(env.app, 'GET', `${base()}/targets`)).json()).targets;
    const added: string[] = [];
    for (let i = before.length; i < 10; i += 1) {
      const res = await api(env.app, 'POST', `${base()}/targets`, { name: `Target ${i}`, url: `http://host${i}.test` });
      expect(res.statusCode, res.body).toBe(201);
      added.push(res.json<{ id: string }>().id);
    }
    expectError(await api(env.app, 'POST', `${base()}/targets`, { name: 'One too many', url: 'http://host11.test' }), 400, 'validation_failed');
    for (const id of added) expect((await api(env.app, 'DELETE', `${base()}/targets/${id}`)).statusCode).toBe(200);
  });

  it('queues a run against an external target and snapshots its name and url on the run', async () => {
    const [target] = RunTargetsResponseSchema.parse((await api(env.app, 'GET', `${base()}/targets`)).json()).targets;
    expect(target).toBeDefined();
    const res = await api(env.app, 'POST', `${base()}/tests/${testId}/runs`, { targetId: target!.id, mode: 'fixed' });
    expect(res.statusCode, res.body).toBe(201);
    const run = ReproductionRunSchema.parse(res.json());
    // The mode is ignored for external targets: nothing is switched there.
    expect(run).toMatchObject({ status: 'queued', target: target!.id, targetMode: 'none', targetName: 'Local dev', targetUrl: 'http://localhost:5173' });

    // Removing the target afterwards does not touch the run's snapshot.
    expect((await api(env.app, 'DELETE', `${base()}/targets/${target!.id}`)).statusCode).toBe(200);
    const fetched = ReproductionRunSchema.parse((await api(env.app, 'GET', `${base()}/runs/${run.id}`)).json());
    expect(fetched).toMatchObject({ target: target!.id, targetName: 'Local dev', targetUrl: 'http://localhost:5173' });

    // The demo target still behaves as before and records no url.
    const demo = ReproductionRunSchema.parse((await api(env.app, 'POST', `${base()}/tests/${testId}/runs`, { targetId: 'demo' })).json());
    expect(demo).toMatchObject({ target: 'demo', targetMode: 'broken', targetName: null, targetUrl: null });
  });

  it('treats a target from another project, or a removed one, as 404', async () => {
    const foreign = RunTargetSchema.parse((await api(env.app, 'POST', `/api/projects/${other.project.id}/targets`, { name: 'Theirs', url: 'http://theirs.test' })).json());
    expectError(await api(env.app, 'POST', `${base()}/tests/${testId}/runs`, { targetId: foreign.id }), 404, 'not_found');
    expectError(await api(env.app, 'POST', `${base()}/tests/${testId}/runs`, { targetId: 'deadbeef' }), 404, 'not_found');
    expectError(await api(env.app, 'POST', `${base()}/tests/${testId}/runs`, { targetId: '' }), 400, 'validation_failed');
  });
});
