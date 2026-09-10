import { randomUUID } from 'node:crypto';
import { GeneratedTestSchema } from '@repro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

describe('generated tests', () => {
  let env: TestEnv;
  let tp: TestProject;
  const sessionId = randomUUID();

  beforeAll(async () => {
    env = await startTestApp();
    tp = await createTestProject(env.db);
    const res = await postBatch(
      env.app,
      tp.key,
      batch(
        sessionId,
        0,
        [
          ev.nav(0, 'http://localhost:4100/login'),
          ev.fill(1, 'email', 'dev@example.com', 'Email'),
          ev.click(2, 'Sign in'),
          ev.nav(3, 'http://localhost:4100/checkout/42', 'push'),
          ev.click(4, 'Place order'),
          ev.network(5, '/api/orders', 500),
          ev.error(6, 'Cannot read properties of undefined (reading "total")'),
        ],
        { meta: meta(), final: true },
      ),
    );
    expect(res.statusCode, res.body).toBe(200);
  });
  afterAll(async () => {
    await deleteTestProject(env.db, tp.project.id);
    await env.close();
  });

  const base = () => `/api/projects/${tp.project.id}`;
  const generate = (body: unknown) => api(env.app, 'POST', `${base()}/sessions/${sessionId}/tests`, body);

  it('generates a Playwright test with selectors and stores it as version 1', async () => {
    const res = await generate({});
    expect(res.statusCode, res.body).toBe(201);
    const test = GeneratedTestSchema.parse(res.json());
    expect(test).toMatchObject({ projectId: tp.project.id, sessionId, version: 1, language: 'typescript', framework: 'playwright', incidentId: null });
    expect(test.selectors.length).toBeGreaterThan(0);
    expect(test.selectors.some((s) => s.strategy !== 'none')).toBe(true);
    expect(test.code).toContain("from '@playwright/test'");
    expect(test.code).toContain('/checkout/42');
    expect(test.code).toContain('http://dashboard.test/projects/');
    expect(test.sourceHash).toMatch(/^[0-9a-f]{16,}$/);
  });

  it('reuses the latest version for identical input and bumps the version otherwise', async () => {
    const first = (await generate({})).json<{ id: string; version: number }>();
    const again = (await generate({})).json<{ id: string; version: number }>();
    expect(again).toEqual(first);

    const withExpectation = await generate({ expectations: [{ kind: 'url', pathPrefix: '/orders' }] });
    expect(withExpectation.statusCode, withExpectation.body).toBe(201);
    const v2 = GeneratedTestSchema.parse(withExpectation.json());
    expect(v2.version).toBe(first.version + 1);
    expect(v2.expectations).toEqual([{ kind: 'url', pathPrefix: '/orders' }]);
    expect(v2.code).toContain('/orders');

    const renamed = GeneratedTestSchema.parse((await generate({ testName: 'Checkout total is missing' })).json());
    expect(renamed.version).toBe(v2.version + 1);
    expect(renamed.name).toBe('Checkout total is missing');

    const list = await api(env.app, 'GET', `${base()}/sessions/${sessionId}/tests`);
    const versions = list.json<{ version: number }[]>().map((t) => t.version);
    expect(versions).toEqual([...versions].sort((a, b) => b - a));
    expect(versions[0]).toBe(renamed.version);

    const byId = await api(env.app, 'GET', `${base()}/tests/${renamed.id}`);
    expect(GeneratedTestSchema.parse(byId.json())).toEqual(renamed);
  });

  it('serves the code as a text/plain attachment named after the session', async () => {
    const test = (await generate({})).json<{ id: string; code: string }>();
    const res = await api(env.app, 'GET', `${base()}/tests/${test.id}/code`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="repro-${sessionId.slice(0, 8)}.spec.ts"`);
    expect(res.body).toBe(test.code);
  });

  it('validates the request and the incident it references', async () => {
    expectError(await generate({ expectations: [{ kind: 'teleport' }] }), 400, 'validation_failed');
    expectError(await generate({ testName: 'x'.repeat(201) }), 400, 'validation_failed');
    expectError(await generate({ incidentId: randomUUID() }), 404, 'not_found');
    expectError(await generate({ incidentId: 'nope' }), 404, 'not_found');
    expectError(await api(env.app, 'GET', `${base()}/tests/${randomUUID()}`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `${base()}/tests/${randomUUID()}/code`), 404, 'not_found');
  });
});
