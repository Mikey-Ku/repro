import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import type { RecordedEvent } from '@repro/contracts';
import { createDb, eventChunks, projects, sessions, type Db, type DbHandle } from '@repro/db';
import { loadRootEnv } from '../../src/env.js';

loadRootEnv();

/** Real Postgres, as the brief requires. The URL comes from the repo root .env or the shell. */
export function connect(): DbHandle {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set; start Postgres and copy .env.example to .env');
  return createDb(process.env.DATABASE_URL, { max: 2 });
}

/** A throwaway project. Deleting it cascades to sessions, chunks, incidents, findings and runs. */
export async function createProject(db: Db): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const [row] = await db
    .insert(projects)
    .values({ slug: `worker-test-${suffix}`, name: `Worker test ${suffix}` })
    .returning({ id: projects.id });
  return row!.id;
}

export async function deleteProject(db: Db, projectId: string): Promise<void> {
  await db.delete(projects).where(eq(projects.id, projectId));
}

export const STARTED_AT = Date.parse('2026-09-09T12:00:00.000Z');

export interface SessionOptions {
  status?: 'recording' | 'completed' | 'expired';
  lastSeenAt?: Date;
}

export async function createSession(db: Db, projectId: string, options: SessionOptions = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(sessions).values({
    id,
    projectId,
    status: options.status ?? 'completed',
    startedAt: new Date(STARTED_AT),
    lastSeenAt: options.lastSeenAt ?? new Date(),
    release: '1.4.2',
    browserName: 'Chrome',
    browserVersion: '140',
    initialUrl: 'http://localhost:4100/login',
    initialRoute: '/login',
    routes: ['/login'],
  });
  return id;
}

/** Store events as gzip chunks the way the ingest API does. */
export async function storeChunks(db: Db, sessionId: string, batches: RecordedEvent[][]): Promise<void> {
  for (const [batchSeq, events] of batches.entries()) {
    const payload = gzipSync(Buffer.from(JSON.stringify(events), 'utf8'));
    const seqs = events.map((e) => e.seq);
    await db.insert(eventChunks).values({
      sessionId,
      batchSeq,
      firstSeq: seqs.length ? Math.min(...seqs) : -1,
      lastSeq: seqs.length ? Math.max(...seqs) : -1,
      eventCount: events.length,
      encoding: 'gzip',
      location: 'inline',
      byteSize: payload.length,
      payload,
    });
  }
}

const at = (seq: number) => ({ seq, ts: STARTED_AT + seq * 500 });

/** A short failing checkout: two navigations, a click, a 500, an uncaught error and a console error. */
export function checkoutEvents(): RecordedEvent[] {
  return [
    { ...at(0), type: 'navigation', data: { url: 'http://localhost:4100/login', kind: 'load' } },
    { ...at(1), type: 'navigation', data: { url: 'http://localhost:4100/checkout', kind: 'push' } },
    {
      ...at(2),
      type: 'click',
      data: { target: { tag: 'button', role: 'button', accessibleName: 'Place order', sensitive: false } },
    },
    {
      ...at(3),
      type: 'network',
      data: {
        kind: 'fetch',
        method: 'POST',
        url: 'http://localhost:4100/api/orders',
        path: '/api/orders',
        status: 500,
        ok: false,
        durationMs: 120,
        requestId: 'r1',
      },
    },
    {
      ...at(4),
      type: 'error',
      data: {
        kind: 'exception',
        name: 'TypeError',
        message: "Cannot read properties of undefined (reading 'toUpperCase')",
        stack: "TypeError: Cannot read properties of undefined (reading 'toUpperCase')\n    at renderOrder (http://localhost:4100/app.js:42:13)",
        handled: false,
      },
    },
    { ...at(5), type: 'console', data: { level: 'error', args: ['Order failed'] } },
    { ...at(6), type: 'navigation', data: { url: 'http://localhost:4100/orders/12345', kind: 'push' } },
  ];
}
