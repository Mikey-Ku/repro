import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

/**
 * Defence in depth: the SDK sanitises before upload, but the server must not trust it. A batch
 * that still carries secrets is stored without them. The check reads the raw chunk bytes from
 * Postgres and gunzips them, so it sees exactly what is on disk, not what an API endpoint chose to show.
 */
describe('server-side sanitisation of persisted data', () => {
  let env: TestEnv;
  let tp: TestProject;
  const CANARIES = ['CANARY_X', 'CANARY_BEARER_Y', 'CANARY_APIKEY_Z', 'CANARY_META_W', 'CANARY_REF_V', 'CANARY_CONSOLE_U'];

  beforeAll(async () => {
    env = await startTestApp();
    tp = await createTestProject(env.db);
  });
  afterAll(async () => {
    await deleteTestProject(env.db, tp.project.id);
    await env.close();
  });

  it('stores chunks, the session row and API responses without the canary secrets', async () => {
    const sessionId = randomUUID();
    const events = [
      ev.nav(0, 'http://localhost:4100/account?token=CANARY_X&tab=billing'),
      ev.network(1, '/api/me?api_key=CANARY_APIKEY_Z', 401, { url: 'http://localhost:4100/api/me?api_key=CANARY_APIKEY_Z' }),
      ev.error(2, 'Request failed with Bearer CANARY_BEARER_Y', { stack: 'Error: Bearer CANARY_BEARER_Y\n  at fetchMe (http://localhost:4100/app.js?token=CANARY_X:1:1)' }),
      ev.consoleError(3, 'auth failed', 'password=CANARY_CONSOLE_U'),
    ];
    const res = await postBatch(
      env.app,
      tp.key,
      batch(sessionId, 0, events, {
        meta: meta({ page: { url: 'http://localhost:4100/account?session=CANARY_META_W', referrer: 'http://ref.example/?sid=CANARY_REF_V' } }),
        final: true,
      }),
    );
    expect(res.statusCode, res.body).toBe(200);

    // Raw storage: every chunk payload, gunzipped, plus the session row as JSON.
    const chunks = await env.handle.sql<{ payload: Buffer }[]>`SELECT payload FROM event_chunks WHERE session_id = ${sessionId} ORDER BY batch_seq`;
    expect(chunks).toHaveLength(1);
    const chunkText = chunks.map((c) => gunzipSync(c.payload).toString('utf8')).join('\n');
    const [row] = await env.handle.sql<{ row: unknown }[]>`SELECT row_to_json(s) AS row FROM sessions s WHERE id = ${sessionId}`;
    const sessionText = JSON.stringify(row!.row);

    for (const canary of CANARIES) {
      expect(chunkText, `chunk contains ${canary}`).not.toContain(canary);
      expect(sessionText, `session row contains ${canary}`).not.toContain(canary);
    }
    // The non-secret parts survive, so the redaction was targeted rather than a wholesale drop.
    expect(chunkText).toContain('tab=billing');
    expect(chunkText).toContain('Request failed with Bearer [redacted]');
    expect(chunkText).toContain('auth failed');
    expect(sessionText).toContain('/account');

    // Everything the dashboard reads goes through the same stored data.
    const endpoints = [`/sessions/${sessionId}`, `/sessions/${sessionId}/events`, `/sessions/${sessionId}/timeline`, `/sessions?limit=5`];
    for (const suffix of endpoints) {
      const out = await api(env.app, 'GET', `/api/projects/${tp.project.id}${suffix}`);
      expect(out.statusCode, suffix).toBe(200);
      for (const canary of CANARIES) expect(out.body, `${suffix} contains ${canary}`).not.toContain(canary);
    }
  });
});
