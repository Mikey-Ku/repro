import { randomUUID } from 'node:crypto';
import { LIMITS } from '@repro/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batch, ev, meta } from '../fixtures.js';
import { MAX_BATCH_BYTES, api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

describe('POST /v1/ingest rejects malformed and unauthorised uploads', () => {
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

  const valid = () => batch(randomUUID(), 0, [ev.nav(0, 'http://localhost:4100/')], { meta: meta() });

  it('returns 400 with Zod issues for schema violations', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['unknown event type', { ...valid(), events: [{ seq: 0, ts: 1, type: 'evil', data: {} }] }],
      ['negative seq', { ...valid(), events: [{ ...ev.nav(0, 'http://x/'), seq: -1 }] }],
      ['oversize message', { ...valid(), events: [ev.error(0, 'x'.repeat(LIMITS.maxMessageLength + 1))] }],
      ['wrong schema version', { ...valid(), v: 2 }],
      ['non-uuid session id', { ...valid(), sessionId: 'session-1' }],
      // Tiny events keep the body under the size cap so the event-count rule is what fails.
      ['too many events', { ...valid(), events: Array.from({ length: LIMITS.maxEventsPerBatch + 1 }, (_, i) => ({ seq: i, ts: 1, type: 'console', data: { level: 'warn', args: [] } })) }],
    ];
    for (const [label, body] of cases) {
      const res = await postBatch(env.app, tp.key, body);
      expect(res.statusCode, label).toBe(400);
      const json = res.json<{ ok: false; error: { code: string; details: { issues: { path: string; message: string }[]; issueCount: number } } }>();
      expect(json.error.code, label).toBe('validation_failed');
      expect(json.error.details.issues.length, label).toBeGreaterThan(0);
      expect(json.error.details.issues.length, label).toBeLessThanOrEqual(20);
      expect(json.error.details.issueCount, label).toBeGreaterThanOrEqual(json.error.details.issues.length);
    }
  });

  it('caps the echoed issues at 20', async () => {
    const events = Array.from({ length: 50 }, (_, i) => ({ seq: i, ts: 1, type: 'evil', data: {} }));
    const res = await postBatch(env.app, tp.key, { ...valid(), events });
    const details = res.json<{ error: { details: { issues: unknown[]; issueCount: number } } }>().error.details;
    expect(details.issues).toHaveLength(20);
    expect(details.issueCount).toBe(50);
  });

  it('rejects a first batch without meta, and empty or non-JSON bodies', async () => {
    const noMeta = await postBatch(env.app, tp.key, batch(randomUUID(), 0, [ev.nav(0, 'http://localhost:4100/')]));
    expectError(noMeta, 400, 'validation_failed');
    expect(noMeta.json<{ error: { message: string } }>().error.message).toMatch(/meta/);

    expectError(await postBatch(env.app, tp.key, {}, { rawBody: '' }), 400, 'validation_failed');
    expectError(await postBatch(env.app, tp.key, {}, { rawBody: '{not json' }), 400, 'validation_failed');
    expectError(await postBatch(env.app, tp.key, {}, { rawBody: Buffer.from('not gzip'), gzip: false, headers: { 'content-encoding': 'gzip' } }), 400, 'validation_failed');
  });

  it('answers 413 for bodies over the cap, raw or after decompression', async () => {
    const huge = { ...valid(), events: [ev.consoleError(0, 'x'.repeat(1500))] };
    const rawBody = JSON.stringify({ ...huge, padding: 'p'.repeat(MAX_BATCH_BYTES) });
    expect(rawBody.length).toBeGreaterThan(MAX_BATCH_BYTES);
    expectError(await postBatch(env.app, tp.key, {}, { rawBody }), 413, 'payload_too_large');
    // The same body gzips to a few hundred bytes; the cap still applies to the decompressed size.
    expectError(await postBatch(env.app, tp.key, {}, { rawBody, gzip: true }), 413, 'payload_too_large');
  });

  it('answers 415 for content encodings other than identity and gzip', async () => {
    expectError(await postBatch(env.app, tp.key, valid(), { headers: { 'content-encoding': 'br' } }), 415, 'unsupported_encoding');
    expectError(await postBatch(env.app, tp.key, valid(), { headers: { 'content-encoding': 'deflate' } }), 415, 'unsupported_encoding');
  });

  it('answers 401 for missing, malformed, unknown and revoked keys', async () => {
    expectError(await postBatch(env.app, null, valid()), 401, 'unauthorized');
    expectError(await postBatch(env.app, 'not-a-key', valid()), 401, 'unauthorized');
    expectError(await postBatch(env.app, 'rp_00000000000000000000000000000000', valid()), 401, 'unauthorized');
    // Same prefix as a real key, different secret: the prefix lookup must not be enough.
    expectError(await postBatch(env.app, `${tp.key.slice(0, 11)}${'z'.repeat(32)}`, valid()), 401, 'unauthorized');

    const created = await api(env.app, 'POST', `/api/projects/${tp.project.id}/keys`, { label: 'to revoke' });
    expect(created.statusCode).toBe(201);
    const { id, key } = created.json<{ id: string; key: string }>();
    expect((await postBatch(env.app, key, valid())).statusCode).toBe(200);
    expect((await api(env.app, 'DELETE', `/api/projects/${tp.project.id}/keys/${id}`)).json()).toEqual({ ok: true });
    expectError(await postBatch(env.app, key, valid()), 401, 'unauthorized');
  });

  it('rate limits per ingestion key with the API error shape', async () => {
    const limited = await startTestApp({ rateLimit: { max: 2, timeWindow: '1 minute' } });
    try {
      const sessionId = randomUUID();
      expect((await postBatch(limited.app, tp.key, batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/')], { meta: meta() }))).statusCode).toBe(200);
      expect((await postBatch(limited.app, tp.key, batch(sessionId, 1, []))).statusCode).toBe(200);
      const third = await postBatch(limited.app, tp.key, batch(sessionId, 2, []));
      expectError(third, 429, 'rate_limited');
      expect(third.headers['retry-after']).toBeDefined();
      // Another key is counted separately.
      const other = await createTestProject(limited.db, 'other');
      try {
        expect((await postBatch(limited.app, other.key, valid())).statusCode).toBe(200);
      } finally {
        await deleteTestProject(limited.db, other.project.id);
      }
    } finally {
      await limited.close();
    }
  });
});
