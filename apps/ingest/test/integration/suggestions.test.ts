import { randomUUID } from 'node:crypto';
import { ExpectationSuggestionsResponseSchema, ReferenceCandidateSchema } from '@repro/contracts';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batch, dom, ev, meta, T0, type RrwebNode } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

/**
 * Two synthetic sessions on /checkout: one that fails at "Place order" and one that reaches the
 * confirmation. The passing one is the reference; what it shows and the failing one never does
 * becomes the suggested expectations.
 */
describe('expectation suggestions from a reference session', () => {
  let env: TestEnv;
  let tp: TestProject;
  let other: TestProject;
  const failing = randomUUID();
  const passing = randomUUID();
  const passingViaRoutes = randomUUID();
  const withErrors = randomUUID();
  const otherRoute = randomUUID();
  const stillRecording = randomUUID();
  const otherProject = randomUUID();

  const checkoutPage = (): RrwebNode =>
    dom.el('html', {}, [dom.el('body', {}, [dom.el('h1', {}, [dom.text('Checkout')]), dom.el('div', { 'data-testid': 'cart' }, [dom.text('1 item')])], 2)]);
  const confirmation = (): RrwebNode =>
    dom.el('section', { 'data-testid': 'order-confirmation' }, [dom.el('h2', {}, [dom.text('Thank you')]), dom.el('div', { role: 'status' }, [dom.text('Order placed')])]);

  async function ingest(sessionId: string, events: ReturnType<typeof ev.nav>[], options: { key?: string; meta?: ReturnType<typeof meta>; final?: boolean } = {}) {
    const res = await postBatch(env.app, options.key ?? tp.key, batch(sessionId, 0, events, { meta: options.meta ?? meta(), final: options.final ?? true }));
    expect(res.statusCode, res.body).toBe(200);
  }

  beforeAll(async () => {
    env = await startTestApp();
    tp = await createTestProject(env.db);
    other = await createTestProject(env.db, 'other');

    await ingest(failing, [
      ev.nav(0, 'http://localhost:4100/checkout'),
      ev.snapshot(1, checkoutPage()),
      ev.click(2, 'Place order'),
      ev.network(3, '/api/orders', 500),
      ev.error(4, 'Cannot read properties of undefined (reading "total")'),
    ]);
    await ingest(passing, [
      ev.nav(0, 'http://localhost:4100/checkout'),
      ev.snapshot(1, checkoutPage()),
      ev.click(2, 'Place order'),
      ev.network(3, '/api/orders', 201),
      ev.mutationAdds(4, [{ parentId: 2, node: confirmation() }]),
      ev.nav(5, 'http://localhost:4100/checkout/confirmation?order=7', 'push'),
    ]);
    // Reaches /checkout only through a later navigation, so it matches on `routes`, not initialRoute. Newer than `passing`.
    await ingest(passingViaRoutes, [ev.nav(0, 'http://localhost:4100/home'), ev.nav(1, 'http://localhost:4100/checkout', 'push'), ev.snapshot(2, checkoutPage())], {
      meta: meta({ startedAt: T0 + 5_000, page: { url: 'http://localhost:4100/home' } }),
    });
    // Not candidates: an error, a different route, still recording, another project.
    await ingest(withErrors, [ev.nav(0, 'http://localhost:4100/checkout'), ev.error(1, 'boom')]);
    await ingest(otherRoute, [ev.nav(0, 'http://localhost:4100/account')], { meta: meta({ page: { url: 'http://localhost:4100/account' } }) });
    await ingest(stillRecording, [ev.nav(0, 'http://localhost:4100/checkout')], { final: false });
    await ingest(otherProject, [ev.nav(0, 'http://localhost:4100/checkout'), ev.snapshot(1, confirmation())], { key: other.key });
  });
  afterAll(async () => {
    await deleteTestProject(env.db, tp.project.id);
    await deleteTestProject(env.db, other.project.id);
    await env.close();
  });

  const base = () => `/api/projects/${tp.project.id}/sessions/${failing}`;

  it('lists completed or expired error-free sessions on a shared route as candidates, richest recording first, never itself', async () => {
    const res = await api(env.app, 'GET', `${base()}/reference-candidates`);
    expect(res.statusCode, res.body).toBe(200);
    const items = z.array(ReferenceCandidateSchema).parse(res.json());
    // `passing` recorded more events than `passingViaRoutes`, so it ranks first even though it is older.
    expect(items.map((item) => item.id)).toEqual([passing, passingViaRoutes]);
    for (const item of items) {
      expect(item.errorCount).toBe(0);
      expect(item.durationMs).not.toBeNull();
      expect(item.browserName).toBe('Chrome');
      expect(item.release).toBe('v1.0.0');
    }
  });

  it('suggests what appeared only in the reference: test ids first, then texts, then the final path', async () => {
    const res = await api(env.app, 'GET', `${base()}/expectation-suggestions?reference=${passing}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = ExpectationSuggestionsResponseSchema.parse(res.json());
    expect(body.reference).toBe(passing);
    expect(body.note).toBeUndefined();
    expect(body.suggestions).toEqual([
      { expectation: { kind: 'visible', testId: 'order-confirmation' }, source: 'reference-session', reason: 'Appears in the passing session but never in this one' },
      { expectation: { kind: 'visible', text: 'Order placed' }, source: 'reference-session', reason: 'Appears in the passing session but never in this one' },
      { expectation: { kind: 'visible', text: 'Thank you' }, source: 'reference-session', reason: 'Heading shown in the passing session but never in this one' },
      { expectation: { kind: 'url', pathPrefix: '/checkout/confirmation' }, source: 'reference-session', reason: 'The passing session ended on this path' },
    ]);
    // Shared markers (the cart test id, the Checkout heading) are never suggested.
    const json = JSON.stringify(body);
    expect(json).not.toContain('"cart"');
    expect(json).not.toContain('Checkout');
  });

  it('returns no differences for a reference that shows nothing new', async () => {
    const res = await api(env.app, 'GET', `${base()}/expectation-suggestions?reference=${passingViaRoutes}`);
    expect(res.statusCode, res.body).toBe(200);
    // Same page, same final path: the only difference is the /home start, which is not a marker.
    expect(ExpectationSuggestionsResponseSchema.parse(res.json())).toEqual({ suggestions: [], reference: passingViaRoutes });
  });

  it('returns the empty heuristic list with a note when no reference is given', async () => {
    const res = await api(env.app, 'GET', `${base()}/expectation-suggestions`);
    expect(res.statusCode, res.body).toBe(200);
    const body = ExpectationSuggestionsResponseSchema.parse(res.json());
    expect(body.suggestions).toEqual([]);
    expect(body.reference).toBeNull();
    expect(body.note).toMatch(/reference/);
  });

  it('rejects references outside the project, unknown ids and the session itself', async () => {
    expectError(await api(env.app, 'GET', `${base()}/expectation-suggestions?reference=${otherProject}`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `${base()}/expectation-suggestions?reference=${randomUUID()}`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `${base()}/expectation-suggestions?reference=nope`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `${base()}/expectation-suggestions?reference=${failing}`), 400, 'validation_failed');
    expectError(await api(env.app, 'GET', `/api/projects/${tp.project.id}/sessions/${randomUUID()}/reference-candidates`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `/api/projects/${other.project.id}/sessions/${failing}/reference-candidates`), 404, 'not_found');
  });
});
