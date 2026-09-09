import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { env } from '../env.js';
import type { GeneratorResult } from '../report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const internal = { 'x-repro-internal-token': env.internalToken, 'content-type': 'application/json' };

interface Fixture { name: string; expectations: unknown[]; batch: { meta: unknown; events: unknown[] } }

async function waitForRun(projectId: string, runId: string): Promise<{ status: string; failureMessage: string | null }> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const run = (await (await fetch(`${env.ingestUrl}/api/projects/${projectId}/runs/${runId}`, { headers: internal })).json()) as { status: string; failureMessage: string | null };
    if (['passed', 'failed', 'error', 'timeout'].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: 'timeout', failureMessage: 'benchmark wait timed out' };
}

/**
 * For every committed incident fixture: ingest it as a fresh session, generate a test,
 * run it in fixed mode (must pass) and in broken mode (must fail).
 */
export async function benchGenerator(): Promise<GeneratorResult> {
  const dir = path.join(here, '..', 'fixtures');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const projectId = ((await (await fetch(`${env.ingestUrl}/api/projects/by-slug/demo`, { headers: internal })).json()) as { id: string }).id;
  const details: GeneratorResult['details'] = [];
  let generated = 0;
  let passedFixed = 0;
  let failedBroken = 0;

  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Fixture;
    const sessionId = randomUUID();
    const now = Date.now();
    const events = (fixture.batch.events as { ts: number }[]).map((e, i) => ({ ...e, ts: now - 60_000 + i * 200 }));
    const meta = { ...(fixture.batch.meta as Record<string, unknown>), startedAt: now - 60_000 };
    const res = await fetch(`${env.ingestUrl}/v1/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-repro-key': env.demoProjectKey },
      body: JSON.stringify({ v: 1, sessionId, batchSeq: 0, sentAt: now, meta, events, final: true }),
    });
    if (!res.ok) {
      details.push({ name: fixture.name, fixed: 'ingest failed', broken: 'ingest failed', failureMessage: await res.text() });
      continue;
    }
    const test = (await (await fetch(`${env.ingestUrl}/api/projects/${projectId}/sessions/${sessionId}/tests`, { method: 'POST', headers: internal, body: JSON.stringify({ expectations: fixture.expectations, testName: fixture.name }) })).json()) as { id?: string; code?: string };
    if (!test.id) {
      details.push({ name: fixture.name, fixed: 'generation failed', broken: 'generation failed', failureMessage: JSON.stringify(test) });
      continue;
    }
    generated += 1;
    const results: Record<'fixed' | 'broken', { status: string; failureMessage: string | null }> = { fixed: { status: '', failureMessage: null }, broken: { status: '', failureMessage: null } };
    for (const mode of ['fixed', 'broken'] as const) {
      const run = (await (await fetch(`${env.ingestUrl}/api/projects/${projectId}/tests/${test.id}/runs`, { method: 'POST', headers: internal, body: JSON.stringify({ mode }) })).json()) as { id: string };
      results[mode] = await waitForRun(projectId, run.id);
    }
    if (results.fixed.status === 'passed') passedFixed += 1;
    if (results.broken.status === 'failed') failedBroken += 1;
    details.push({ name: fixture.name, fixed: results.fixed.status, broken: results.broken.status, failureMessage: results.broken.failureMessage ?? undefined });
    // Leave the demo in its default mode.
    await fetch(`${env.demoUrl}/__demo/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'broken' }) });
    // Remove the benchmark session again.
    await fetch(`${env.ingestUrl}/api/projects/${projectId}/sessions/${sessionId}`, { method: 'DELETE', headers: internal });
  }
  return { fixtures: files.length, generated, passedFixed, failedBroken, details };
}
