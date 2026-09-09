import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { env, percentile, round } from '../env.js';
import type { IngestResult } from '../report.js';

interface Batch { v: 1; sessionId: string; batchSeq: number; sentAt: number; meta?: unknown; events: { seq: number; ts: number; type: string; data: unknown }[]; final?: boolean }

const internal = { 'x-repro-internal-token': env.internalToken, 'content-type': 'application/json' };

/** A synthetic batch used when no recorded sample is available. */
function syntheticBatch(): Batch {
  const now = Date.now();
  const events: Batch['events'] = [];
  for (let i = 0; i < 200; i += 1) {
    events.push({ seq: i, ts: now + i * 10, type: 'rrweb', data: { type: 3, timestamp: now + i * 10, data: { source: 0, adds: [{ parentId: 1, nextId: null, node: { type: 2, tagName: 'div', attributes: { class: `row-${i}` }, childNodes: [], id: 100 + i } }], removes: [], texts: [], attributes: [] } } });
  }
  return {
    v: 1,
    sessionId: randomUUID(),
    batchSeq: 0,
    sentAt: now,
    meta: { startedAt: now, sdkVersion: 'bench', browser: { name: 'Chrome', version: '1', userAgent: 'bench' }, viewport: { width: 1280, height: 720 }, page: { url: 'http://localhost:4100/bench' } },
    events,
  };
}

export async function benchIngest(sample: unknown, options: { seconds?: number; concurrency?: number } = {}): Promise<IngestResult> {
  const seconds = options.seconds ?? 10;
  const concurrency = options.concurrency ?? 16;

  // Use a throwaway project so benchmark sessions never pollute the demo project.
  const slug = `bench-${Date.now().toString(36)}`;
  const project = (await (await fetch(`${env.ingestUrl}/api/projects`, { method: 'POST', headers: internal, body: JSON.stringify({ name: 'Benchmark', slug }) })).json()) as { id: string };
  const keyRes = (await (await fetch(`${env.ingestUrl}/api/projects/${project.id}/keys`, { method: 'POST', headers: internal, body: JSON.stringify({ label: 'bench' }) })).json()) as { key: string };

  const template = (sample as Batch | null) ?? syntheticBatch();
  const body = (sessionId: string) => gzipSync(Buffer.from(JSON.stringify({ ...template, sessionId, batchSeq: 0, sentAt: Date.now() })));
  const batchBytes = body(randomUUID()).length;

  const latencies: number[] = [];
  let errors = 0;
  const deadline = Date.now() + seconds * 1000;

  const client = async () => {
    while (Date.now() < deadline) {
      const sessionId = randomUUID();
      const payload = body(sessionId);
      const t0 = performance.now();
      try {
        const res = await fetch(`${env.ingestUrl}/v1/ingest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'x-repro-key': keyRes.key },
          body: payload,
        });
        if (!res.ok) errors += 1;
        await res.arrayBuffer();
      } catch {
        errors += 1;
      }
      latencies.push(performance.now() - t0);
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, client));
  const elapsed = (performance.now() - started) / 1000;

  // Clean up: deleting the project cascades to its sessions and chunks.
  await fetch(`${env.ingestUrl}/api/projects/${project.id}`, { method: 'DELETE', headers: internal }).catch(() => undefined);

  const requests = latencies.length;
  return {
    seconds,
    concurrency,
    requests,
    requestsPerSecond: round(requests / elapsed),
    eventsPerSecond: round((requests * template.events.length) / elapsed),
    p50Ms: round(percentile(latencies, 50)),
    p95Ms: round(percentile(latencies, 95)),
    p99Ms: round(percentile(latencies, 99)),
    errors,
    batchEvents: template.events.length,
    batchBytes,
  };
}
