import { randomUUID } from 'node:crypto';
import { DiagnosticFindingSchema, EvidenceSummarySchema, IncidentSchema, SessionSummarySchema, type Investigation } from '@repro/contracts';
import { incidents } from '@repro/db';
import type { Investigator, InvestigatorInput } from '@repro/diagnostics';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T0, batch, ev, meta } from '../fixtures.js';
import { api, createTestProject, deleteTestProject, expectError, postBatch, startTestApp, type TestEnv, type TestProject } from './helpers.js';

describe('incidents, timeline and findings', () => {
  let env: TestEnv;
  let tp: TestProject;
  const sessionId = randomUUID();
  let incidentId: string;

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
          ev.nav(0, 'http://localhost:4100/checkout/5'),
          ev.click(1, 'Place order'),
          ev.network(2, '/api/orders', 200),
          ev.error(3, 'Cannot read properties of undefined (reading "total")', { stack: 'TypeError: x\n  at render (app.js:1:1)' }),
          ev.consoleError(4, 'render failed'),
        ],
        { meta: meta(), final: true },
      ),
    );
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await env.db
      .insert(incidents)
      .values({
        projectId: tp.project.id,
        sessionId,
        kind: 'exception',
        title: 'TypeError: Cannot read properties of undefined',
        message: 'Cannot read properties of undefined (reading "total")',
        fingerprint: 'fp-total',
        firstSeq: 3,
        firstTs: new Date(T0 + 300),
        offsetMs: 300,
        route: '/checkout/:id',
        release: 'v1.0.0',
      })
      .returning();
    incidentId = row!.id;
  });
  afterAll(async () => {
    await deleteTestProject(env.db, tp.project.id);
    await env.close();
  });

  const base = () => `/api/projects/${tp.project.id}`;

  it('lists, shows and updates incidents', async () => {
    const list = await api(env.app, 'GET', `${base()}/incidents?status=open&limit=10`);
    expect(list.statusCode, list.body).toBe(200);
    const items = list.json<{ items: unknown[] }>().items.map((i) => IncidentSchema.parse(i));
    expect(items.map((i) => i.id)).toEqual([incidentId]);
    expect((await api(env.app, 'GET', `${base()}/incidents?status=resolved`)).json()).toEqual({ items: [] });
    expectError(await api(env.app, 'GET', `${base()}/incidents?status=maybe`), 400, 'validation_failed');
    expectError(await api(env.app, 'GET', `${base()}/incidents?limit=0`), 400, 'validation_failed');

    const detail = await api(env.app, 'GET', `${base()}/incidents/${incidentId}`);
    expect(detail.statusCode).toBe(200);
    const body = detail.json<{ incident: unknown; session: unknown; tests: unknown[] }>();
    expect(IncidentSchema.parse(body.incident).id).toBe(incidentId);
    expect(SessionSummarySchema.parse(body.session).id).toBe(sessionId);
    expect(body.tests).toEqual([]);

    const patched = await api(env.app, 'PATCH', `${base()}/incidents/${incidentId}`, { status: 'resolved' });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(IncidentSchema.parse(patched.json()).status).toBe('resolved');
    expect((await api(env.app, 'GET', `${base()}/incidents?status=open`)).json()).toEqual({ items: [] });
    expectError(await api(env.app, 'PATCH', `${base()}/incidents/${incidentId}`, { status: 'closed' }), 400, 'validation_failed');
    expectError(await api(env.app, 'PATCH', `${base()}/incidents/${randomUUID()}`, { status: 'open' }), 404, 'not_found');

    // Session detail carries the incident and, once generated, the test that references it.
    const generated = await api(env.app, 'POST', `${base()}/sessions/${sessionId}/tests`, { incidentId });
    expect(generated.statusCode, generated.body).toBe(201);
    expect(generated.json<{ incidentId: string }>().incidentId).toBe(incidentId);
    const session = await api(env.app, 'GET', `${base()}/sessions/${sessionId}`);
    expect(session.json<{ incidents: { id: string }[]; tests: { incidentId: string }[] }>()).toMatchObject({ incidents: [{ id: incidentId }], tests: [{ incidentId }] });
  });

  it('builds the timeline and evidence summary from stored events', async () => {
    const res = await api(env.app, 'GET', `${base()}/sessions/${sessionId}/timeline`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{ entries: { seq: number; kind: string; severity: string }[]; evidence: unknown }>();
    expect(body.entries.map((e) => e.kind)).toEqual(['navigation', 'click', 'network', 'error', 'console']);
    expect(body.entries[3]).toMatchObject({ seq: 3, severity: 'error', offsetMs: 300 });
    const evidence = EvidenceSummarySchema.parse(body.evidence);
    expect(evidence).toMatchObject({ route: '/checkout/:id', release: 'v1.0.0', browser: 'Chrome 130' });
    expect(evidence.earliestError?.ref.seq).toBe(3);
    expect(evidence.requestsBeforeError.map((r) => r.path)).toEqual(['/api/orders']);
    expect(evidence.stats).toMatchObject({ events: 5, errors: 1, requests: 1, actions: 2 });
  });

  it('runs the fake investigator by default and stores an investigation finding', async () => {
    const res = await api(env.app, 'POST', `${base()}/sessions/${sessionId}/investigate`);
    expect(res.statusCode, res.body).toBe(201);
    const finding = DiagnosticFindingSchema.parse(res.json());
    expect(finding).toMatchObject({ projectId: tp.project.id, sessionId, kind: 'investigation', provider: 'fake', model: 'rules-v1', incidentId: null });
    expect(finding.evidence?.earliestError?.ref.seq).toBe(3);
    expect(finding.investigation?.abstained).toBe(false);
    expect(finding.investigation?.hypothesis).toContain('/api/orders');
    // Every evidence claim points back at a ref the summary exposes.
    const refs = new Set([finding.evidence!.earliestError!.ref.seq, ...finding.evidence!.lastActions.map((a) => a.ref.seq), ...finding.evidence!.requestsBeforeError.map((r) => r.ref.seq)]);
    for (const item of finding.investigation!.evidence) expect(refs.has(item.ref.seq)).toBe(true);

    const list = await api(env.app, 'GET', `${base()}/sessions/${sessionId}/findings`);
    expect(list.json<{ id: string }[]>().map((f) => f.id)).toEqual([finding.id]);
    const detail = await api(env.app, 'GET', `${base()}/sessions/${sessionId}`);
    expect(detail.json<{ findings: { id: string }[] }>().findings.map((f) => f.id)).toEqual([finding.id]);
  });

  it('hands an injected investigator the redacted input only', async () => {
    let received: InvestigatorInput | undefined;
    const stub: Investigator = {
      provider: 'stub',
      model: 'm1',
      async investigate(input) {
        received = input;
        const out: Investigation = { provider: 'stub', model: 'm1', hypothesis: 'h', confidence: 'low', abstained: false, evidence: [], inferences: [], suggestedChecks: [] };
        return out;
      },
    };
    const custom = await startTestApp({ investigator: stub });
    try {
      const res = await api(custom.app, 'POST', `${base()}/sessions/${sessionId}/investigate`);
      expect(res.statusCode, res.body).toBe(201);
      expect(DiagnosticFindingSchema.parse(res.json())).toMatchObject({ provider: 'stub', model: 'm1', investigation: { hypothesis: 'h' } });
      expect(received).toBeDefined();
      expect(received!.timeline.length).toBe(5);
      // Raw event payloads never reach a provider; rows are title/detail only.
      for (const row of received!.timeline) expect(row).not.toHaveProperty('event');
      expect(EvidenceSummarySchema.parse(received!.summary).route).toBe('/checkout/:id');
    } finally {
      await custom.close();
    }
  });
});
