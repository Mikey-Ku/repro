import { randomUUID } from 'node:crypto';
import { SessionListResponseSchema } from '@repro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T0, batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

const HOUR = 3_600_000;

interface Seed {
  id: string;
  startedAt: number;
  release: string;
  browser: string;
  url: string;
  error: boolean;
  extraRoute?: string;
}

describe('GET /api/projects/:projectId/sessions', () => {
  let env: TestEnv;
  let tp: TestProject;
  const seeds: Seed[] = [
    { id: randomUUID(), startedAt: T0, release: 'v1', browser: 'Chrome', url: 'http://h/login', error: false },
    { id: randomUUID(), startedAt: T0 + HOUR, release: 'v1', browser: 'Firefox', url: 'http://h/login', error: true },
    { id: randomUUID(), startedAt: T0 + 2 * HOUR, release: 'v2', browser: 'Chrome', url: 'http://h/checkout/7', error: true, extraRoute: 'http://h/orders/9' },
    { id: randomUUID(), startedAt: T0 + 3 * HOUR, release: 'v2', browser: 'Safari', url: 'http://h/', error: false, extraRoute: 'http://h/checkout/8' },
    { id: randomUUID(), startedAt: T0 + 4 * HOUR, release: 'v3', browser: 'Chrome', url: 'http://h/login', error: false },
  ];
  // Newest first is the list order.
  const byNewest = [...seeds].sort((x, y) => y.startedAt - x.startedAt).map((s) => s.id);

  beforeAll(async () => {
    env = await startTestApp();
    tp = await createTestProject(env.db);
    for (const seed of seeds) {
      const events = [ev.nav(0, seed.url)];
      if (seed.extraRoute) events.push(ev.nav(1, seed.extraRoute, 'push'));
      if (seed.error) events.push(ev.error(2, 'Boom'));
      const res = await postBatch(
        env.app,
        tp.key,
        batch(seed.id, 0, events, { meta: meta({ startedAt: seed.startedAt, release: seed.release, browser: { name: seed.browser, version: '1', userAgent: 'UA' }, page: { url: seed.url } }), final: seed.id === seeds[4]!.id }),
      );
      expect(res.statusCode, res.body).toBe(200);
    }
  });
  afterAll(async () => {
    await deleteTestProject(env.db, tp.project.id);
    await env.close();
  });

  async function list(query = ''): Promise<ReturnType<typeof SessionListResponseSchema.parse>> {
    const res = await api(env.app, 'GET', `/api/projects/${tp.project.id}/sessions${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return SessionListResponseSchema.parse(res.json());
  }
  const ids = (page: { items: { id: string }[] }) => page.items.map((s) => s.id);

  it('lists newest first with facets', async () => {
    const page = await list();
    expect(ids(page)).toEqual(byNewest);
    expect(page.nextCursor).toBeNull();
    expect(page.facets.releases).toEqual(['v1', 'v2', 'v3']);
    expect(page.facets.browsers).toEqual(['Chrome', 'Firefox', 'Safari']);
    expect(page.facets.routes).toEqual(['/', '/checkout/:id', '/login', '/orders/:id']);
  });

  it('applies each filter', async () => {
    expect(ids(await list('?status=completed'))).toEqual([seeds[4]!.id]);
    expect(ids(await list('?status=recording'))).toHaveLength(4);
    expect(ids(await list('?release=v2'))).toEqual([seeds[3]!.id, seeds[2]!.id]);
    expect(ids(await list('?browser=Chrome'))).toEqual([seeds[4]!.id, seeds[2]!.id, seeds[0]!.id]);
    // route matches the initial route or any later route.
    expect(ids(await list('?route=%2Fcheckout%2F%3Aid'))).toEqual([seeds[3]!.id, seeds[2]!.id]);
    expect(ids(await list('?route=%2Forders%2F%3Aid'))).toEqual([seeds[2]!.id]);
    expect(ids(await list('?hasErrors=true'))).toEqual([seeds[2]!.id, seeds[1]!.id]);
    // "false" means no filter, not "sessions without errors".
    expect(ids(await list('?hasErrors=false'))).toHaveLength(5);
    const from = encodeURIComponent(new Date(T0 + 2 * HOUR).toISOString());
    const to = encodeURIComponent(new Date(T0 + 3 * HOUR).toISOString());
    expect(ids(await list(`?from=${from}`))).toEqual([seeds[4]!.id, seeds[3]!.id, seeds[2]!.id]);
    expect(ids(await list(`?to=${to}`))).toEqual([seeds[3]!.id, seeds[2]!.id, seeds[1]!.id, seeds[0]!.id]);
    expect(ids(await list(`?from=${from}&to=${to}&browser=Chrome`))).toEqual([seeds[2]!.id]);
    expect(ids(await list('?release=v1&hasErrors=true'))).toEqual([seeds[1]!.id]);
  });

  it('rejects invalid filters and cursors with 400', async () => {
    expectError(await api(env.app, 'GET', `/api/projects/${tp.project.id}/sessions?status=bogus`), 400, 'validation_failed');
    expectError(await api(env.app, 'GET', `/api/projects/${tp.project.id}/sessions?from=yesterday`), 400, 'validation_failed');
    expectError(await api(env.app, 'GET', `/api/projects/${tp.project.id}/sessions?limit=0`), 400, 'validation_failed');
    expectError(await api(env.app, 'GET', `/api/projects/${tp.project.id}/sessions?cursor=%3F%3F`), 400, 'validation_failed');
  });

  it('paginates with an opaque cursor without gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof list>> = await list(`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...ids(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(byNewest);

    // Filters and cursors compose.
    const first = await list('?limit=1&browser=Chrome');
    expect(ids(first)).toEqual([seeds[4]!.id]);
    const second = await list(`?limit=1&browser=Chrome&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(ids(second)).toEqual([seeds[2]!.id]);
  });
});
