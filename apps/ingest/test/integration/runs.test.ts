import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { ReproductionRunSchema } from '@repro/contracts';
import { jobs, reproductionRuns } from '@repro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

describe('reproduction runs', () => {
  let env: TestEnv;
  let tp: TestProject;
  const sessionId = randomUUID();
  let testId: string;

  beforeAll(async () => {
    env = await startTestApp();
    tp = await createTestProject(env.db);
    await postBatch(env.app, tp.key, batch(sessionId, 0, [ev.nav(0, 'http://localhost:4100/'), ev.click(1, 'Go'), ev.error(2, 'Boom')], { meta: meta(), final: true }));
    const test = await api(env.app, 'POST', `/api/projects/${tp.project.id}/sessions/${sessionId}/tests`, {});
    expect(test.statusCode, test.body).toBe(201);
    testId = test.json<{ id: string }>().id;
  });
  afterAll(async () => {
    await deleteTestProject(env.db, tp.project.id);
    await env.close();
  });

  const base = () => `/api/projects/${tp.project.id}`;

  it('queues a run and its job together', async () => {
    const res = await api(env.app, 'POST', `${base()}/tests/${testId}/runs`, { mode: 'fixed' });
    expect(res.statusCode, res.body).toBe(201);
    const run = ReproductionRunSchema.parse(res.json());
    expect(run).toMatchObject({ projectId: tp.project.id, sessionId, generatedTestId: testId, status: 'queued', target: 'demo', targetMode: 'fixed', artifacts: [] });
    expect(run.startedAt).toBeNull();

    const queued = await env.db.select().from(jobs).where(sql`${jobs.payload}->>'runId' = ${run.id}`);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: 'run_reproduction', status: 'queued', payload: { projectId: tp.project.id, runId: run.id } });

    // Default mode is broken; an unknown mode is rejected.
    const defaulted = await api(env.app, 'POST', `${base()}/tests/${testId}/runs`, {});
    expect(ReproductionRunSchema.parse(defaulted.json()).targetMode).toBe('broken');
    expectError(await api(env.app, 'POST', `${base()}/tests/${testId}/runs`, { mode: 'sideways' }), 400, 'validation_failed');

    const list = await api(env.app, 'GET', `${base()}/tests/${testId}/runs`);
    const runs = list.json<{ id: string; queuedAt: string }[]>();
    expect(runs).toHaveLength(2);
    expect(runs[0]!.id).toBe(defaulted.json<{ id: string }>().id);
    for (const item of runs) ReproductionRunSchema.parse(item);

    const byId = await api(env.app, 'GET', `${base()}/runs/${run.id}`);
    expect(ReproductionRunSchema.parse(byId.json())).toEqual(run);
    expectError(await api(env.app, 'GET', `${base()}/runs/${randomUUID()}`), 404, 'not_found');
    expectError(await api(env.app, 'POST', `${base()}/tests/${randomUUID()}/runs`, {}), 404, 'not_found');
  });

  it('serves only artifacts listed on the run, and never their paths', async () => {
    const created = await api(env.app, 'POST', `${base()}/tests/${testId}/runs`, { mode: 'broken' });
    const runId = created.json<{ id: string }>().id;
    expectError(await api(env.app, 'GET', `${base()}/runs/${runId}/artifacts/screenshot.png`), 404, 'not_found');

    // Simulate the worker: write the files and record them on the run (one relative, one absolute).
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await writeFile(path.join(env.artifactsDir, 'shot.png'), png);
    const reportPath = path.join(env.artifactsDir, 'report.json');
    await writeFile(reportPath, '{"status":"failed"}');
    await env.db
      .update(reproductionRuns)
      .set({
        status: 'failed',
        artifacts: [
          { name: 'screenshot.png', contentType: 'image/png', bytes: png.length, path: 'shot.png' },
          { name: 'report.json', contentType: 'application/json', bytes: 19, path: reportPath },
          { name: 'trace.zip', contentType: 'application/zip', bytes: 0, path: 'missing.zip' },
        ],
      })
      .where(eq(reproductionRuns.id, runId));

    const shot = await api(env.app, 'GET', `${base()}/runs/${runId}/artifacts/screenshot.png`);
    expect(shot.statusCode).toBe(200);
    expect(shot.headers['content-type']).toBe('image/png');
    expect(shot.headers['content-length']).toBe(String(png.length));
    expect(shot.rawPayload.equals(png)).toBe(true);

    const report = await api(env.app, 'GET', `${base()}/runs/${runId}/artifacts/report.json`);
    expect(report.statusCode).toBe(200);
    expect(report.json()).toEqual({ status: 'failed' });

    // Listed but not on disk, unknown name, and a traversal attempt all read as 404.
    expectError(await api(env.app, 'GET', `${base()}/runs/${runId}/artifacts/trace.zip`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `${base()}/runs/${runId}/artifacts/shot.png`), 404, 'not_found');
    expectError(await api(env.app, 'GET', `${base()}/runs/${runId}/artifacts/..%2Fshot.png`), 404, 'not_found');

    const dto = ReproductionRunSchema.parse((await api(env.app, 'GET', `${base()}/runs/${runId}`)).json());
    expect(dto.artifacts.map((a) => a.name)).toEqual(['screenshot.png', 'report.json', 'trace.zip']);
    expect(JSON.stringify(dto)).not.toContain(env.artifactsDir);
  });
});
