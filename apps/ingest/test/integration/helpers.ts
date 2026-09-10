import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import type { IngestBatch } from '@repro/contracts';
import { createDb, jobs, projects, type Db, type DbHandle, type IngestionKeyRow, type ProjectRow } from '@repro/db';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import { loadRootEnv } from '../../src/env.js';
import { createIngestionKey } from '../../src/services/keys.js';

/**
 * Integration tests run against the real Postgres from the repo-root .env. Each file creates its
 * own project rows (and keys, sessions, jobs under them) and deletes them when done, so files can
 * share the database without seeing each other's data.
 */

export const INTERNAL_TOKEN = 'test-internal-token';
export const MAX_BATCH_BYTES = 200_000;

export interface TestEnv {
  handle: DbHandle;
  db: Db;
  app: FastifyInstance;
  artifactsDir: string;
  close: () => Promise<void>;
}

export async function startTestApp(overrides: Partial<BuildAppOptions> = {}): Promise<TestEnv> {
  loadRootEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set; integration tests need the local Postgres');
  const handle = createDb(url, { max: 4 });
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'repro-ingest-test-'));
  const app = await buildApp({
    db: handle,
    internalToken: INTERNAL_TOKEN,
    maxBatchBytes: MAX_BATCH_BYTES,
    artifactsDir,
    appUrl: 'http://dashboard.test',
    logger: false,
    ...overrides,
  });
  await app.ready();
  return {
    handle,
    db: handle.db,
    app,
    artifactsDir,
    close: async () => {
      await app.close();
      await handle.close();
      await rm(artifactsDir, { recursive: true, force: true });
    },
  };
}

export interface TestProject {
  project: ProjectRow;
  /** Plaintext ingestion key for this project. */
  key: string;
  keyRow: IngestionKeyRow;
}

export async function createTestProject(db: Db, label = 'test key'): Promise<TestProject> {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const [project] = await db.insert(projects).values({ slug, name: `Test ${slug}` }).returning();
  if (!project) throw new Error('could not insert test project');
  const { row, key } = await createIngestionKey(db, project.id, label);
  return { project, key, keyRow: row };
}

/** Jobs are not linked by foreign key, so they are removed by the project id in their payload. */
export async function deleteTestProject(db: Db, projectId: string): Promise<void> {
  await db.delete(jobs).where(sql`${jobs.payload}->>'projectId' = ${projectId}`);
  await db.delete(projects).where(sql`${projects.id} = ${projectId}`);
}

export interface PostBatchOptions {
  gzip?: boolean;
  /** Send the key as ?key= instead of the header (sendBeacon style). */
  keyInQuery?: boolean;
  contentType?: string;
  headers?: Record<string, string>;
  /** Raw body override, for malformed payload tests. */
  rawBody?: string | Buffer;
}

export async function postBatch(
  app: FastifyInstance,
  key: string | null,
  batch: IngestBatch | Record<string, unknown>,
  options: PostBatchOptions = {},
): Promise<LightMyRequestResponse> {
  const encoded = options.rawBody ?? JSON.stringify(batch);
  const payload = options.gzip ? gzipSync(Buffer.from(encoded)) : encoded;
  const headers: Record<string, string> = {
    'content-type': options.contentType ?? 'application/json',
    ...(options.gzip ? { 'content-encoding': 'gzip' } : {}),
    ...(key && !options.keyInQuery ? { 'x-repro-key': key } : {}),
    ...options.headers,
  };
  const url = key && options.keyInQuery ? `/v1/ingest?key=${encodeURIComponent(key)}` : '/v1/ingest';
  return app.inject({ method: 'POST', url, headers, payload });
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Internal API call with the shared token attached. */
export async function api(app: FastifyInstance, method: Method, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: { 'x-repro-internal-token': INTERNAL_TOKEN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

export function expectError(res: LightMyRequestResponse, status: number, code: string): void {
  if (res.statusCode !== status) throw new Error(`expected ${status} ${code}, got ${res.statusCode}: ${res.body}`);
  const body = res.json<{ ok: boolean; error: { code: string } }>();
  if (body.ok !== false || body.error.code !== code) throw new Error(`expected error code ${code}, got ${res.body}`);
}
