import { and, asc, desc, eq, gt, gte, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { IngestBatch, IngestResponse, SessionFilters, SessionListResponse } from '@repro/contracts';
import { enqueueJob, eventChunks, sessions, type Db, type IngestionKeyRow, type SessionRow } from '@repro/db';
import { forbidden, validationFailed } from '../errors.js';
import { toSessionDto } from '../mappers.js';
import { encodeChunk } from './events.js';
import { routeForUrl, sanitizeBatch } from './sanitize.js';
import { asDb, type Tx } from './tx.js';

export interface IngestResult {
  response: IngestResponse;
  /** Session state after this batch, for logging. */
  session: Pick<SessionRow, 'id' | 'projectId' | 'status' | 'eventCount'>;
}

function summariseBatch(batch: IngestBatch) {
  let errors = 0;
  let networkFailures = 0;
  let minSeq = Number.POSITIVE_INFINITY;
  let maxSeq = -1;
  const routes = new Set<string>();
  let externalUserId: string | null = null;
  for (const event of batch.events) {
    if (event.seq < minSeq) minSeq = event.seq;
    if (event.seq > maxSeq) maxSeq = event.seq;
    if (event.type === 'error' && !event.data.handled) errors += 1;
    if (event.type === 'network' && !event.data.ok) networkFailures += 1;
    if (event.type === 'navigation') routes.add(routeForUrl(event.data.url));
    if (event.type === 'identify' && event.data.userId) externalUserId = event.data.userId;
  }
  return { errors, networkFailures, firstSeq: maxSeq >= 0 ? minSeq : -1, lastSeq: maxSeq, routes, externalUserId };
}

async function createSessionRow(tx: Tx, projectId: string, batch: IngestBatch): Promise<SessionRow> {
  const meta = batch.meta;
  if (!meta) {
    throw validationFailed(
      `Session ${batch.sessionId} does not exist and this batch carries no meta. The first batch of a session must include meta.`,
    );
  }
  const initialUrl = meta.page.url;
  const initialRoute = routeForUrl(initialUrl);
  const [inserted] = await tx
    .insert(sessions)
    .values({
      id: batch.sessionId,
      projectId,
      status: 'recording',
      startedAt: new Date(meta.startedAt),
      lastSeenAt: new Date(),
      release: meta.release ?? null,
      environment: meta.environment ?? null,
      browserName: meta.browser.name,
      browserVersion: meta.browser.version,
      os: meta.os ?? null,
      userAgent: meta.browser.userAgent,
      viewportWidth: meta.viewport.width,
      viewportHeight: meta.viewport.height,
      initialUrl,
      initialRoute,
      routes: [initialRoute],
      sdkVersion: meta.sdkVersion,
      meta: meta as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: sessions.id })
    .returning();
  if (inserted) return inserted;
  // Two first batches raced; the other one won. Re-read it under the row lock.
  const [existing] = await tx.select().from(sessions).where(eq(sessions.id, batch.sessionId)).for('update');
  if (!existing) throw new Error(`Session ${batch.sessionId} vanished during insert`);
  return existing;
}

/**
 * Store one batch. Runs in a transaction with the session row locked so counters stay exact
 * under concurrent uploads. Idempotent on (sessionId, batchSeq): a repeat is acknowledged
 * with `duplicate: true` and changes nothing.
 */
export async function ingestBatch(db: Db, key: IngestionKeyRow, rawBatch: IngestBatch): Promise<IngestResult> {
  const batch = sanitizeBatch(rawBatch);
  const summary = summariseBatch(batch);
  const now = new Date();

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(sessions).where(eq(sessions.id, batch.sessionId)).for('update');
    const session = locked ?? (await createSessionRow(tx, key.projectId, batch));
    if (session.projectId !== key.projectId) {
      throw forbidden('This session belongs to a different project');
    }

    const payload = encodeChunk(batch.events);
    const insertedChunk = await tx
      .insert(eventChunks)
      .values({
        sessionId: session.id,
        batchSeq: batch.batchSeq,
        firstSeq: summary.firstSeq,
        lastSeq: summary.lastSeq,
        eventCount: batch.events.length,
        encoding: 'gzip',
        location: 'inline',
        byteSize: payload.length,
        payload,
      })
      .onConflictDoNothing({ target: [eventChunks.sessionId, eventChunks.batchSeq] })
      .returning({ id: eventChunks.id });

    if (insertedChunk.length === 0) {
      return {
        response: { ok: true, sessionId: session.id, batchSeq: batch.batchSeq, accepted: false, duplicate: true },
        session,
      };
    }

    const routes = [...new Set([...session.routes, ...summary.routes])];
    const [updated] = await tx
      .update(sessions)
      .set({
        eventCount: sql`${sessions.eventCount} + ${batch.events.length}`,
        chunkCount: sql`${sessions.chunkCount} + 1`,
        lastSeq: sql`greatest(${sessions.lastSeq}, ${summary.lastSeq})`,
        errorCount: sql`${sessions.errorCount} + ${summary.errors}`,
        networkFailureCount: sql`${sessions.networkFailureCount} + ${summary.networkFailures}`,
        routes,
        lastSeenAt: now,
        updatedAt: now,
        ...(summary.externalUserId ? { externalUserId: summary.externalUserId } : {}),
        ...(batch.final ? { status: 'completed' as const, endedAt: now } : {}),
      })
      .where(eq(sessions.id, session.id))
      .returning({ id: sessions.id, projectId: sessions.projectId, status: sessions.status, eventCount: sessions.eventCount });

    if (batch.final) {
      await enqueueJob(
        asDb(tx),
        'process_session',
        { projectId: session.projectId, sessionId: session.id },
        { dedupeKey: `process_session:${session.id}` },
      );
    }

    return {
      response: { ok: true, sessionId: session.id, batchSeq: batch.batchSeq, accepted: true, duplicate: false },
      session: updated!,
    };
  });
}

export async function getSession(db: Db, projectId: string, sessionId: string): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

/** Cascades to chunks, incidents, tests, runs and findings through the schema's foreign keys. */
export async function deleteSession(db: Db, projectId: string, sessionId: string): Promise<boolean> {
  const rows = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.projectId, projectId)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/** Opaque cursor: base64 of `startedAt|id`, matching the sort order `startedAt desc, id desc`. */
export function encodeCursor(row: Pick<SessionRow, 'startedAt' | 'id'>): string {
  return Buffer.from(`${row.startedAt.toISOString()}|${row.id}`, 'utf8').toString('base64');
}

export function decodeCursor(cursor: string): { startedAt: Date; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.indexOf('|');
  if (separator <= 0) return null;
  const startedAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(startedAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { startedAt, id };
}

const FACET_LIMIT = 50;

export async function sessionFacets(db: Db, projectId: string): Promise<SessionListResponse['facets']> {
  const [releases, browsers, routes] = await Promise.all([
    db
      .selectDistinct({ value: sessions.release })
      .from(sessions)
      .where(and(eq(sessions.projectId, projectId), isNotNull(sessions.release)))
      .orderBy(asc(sessions.release))
      .limit(FACET_LIMIT),
    db
      .selectDistinct({ value: sessions.browserName })
      .from(sessions)
      .where(and(eq(sessions.projectId, projectId), isNotNull(sessions.browserName)))
      .orderBy(asc(sessions.browserName))
      .limit(FACET_LIMIT),
    db.execute<{ value: string }>(sql`
      SELECT DISTINCT r.value AS value
      FROM ${sessions}, jsonb_array_elements_text(${sessions.routes}) AS r(value)
      WHERE ${sessions.projectId} = ${projectId}
      ORDER BY r.value
      LIMIT ${FACET_LIMIT}
    `),
  ]);
  return {
    releases: releases.map((r) => r.value).filter((v): v is string => v !== null),
    browsers: browsers.map((r) => r.value).filter((v): v is string => v !== null),
    routes: [...routes].map((r) => r.value),
  };
}

export async function listSessions(db: Db, projectId: string, filters: SessionFilters): Promise<SessionListResponse> {
  const conditions = [eq(sessions.projectId, projectId)];
  if (filters.status) conditions.push(eq(sessions.status, filters.status));
  if (filters.release) conditions.push(eq(sessions.release, filters.release));
  if (filters.browser) conditions.push(eq(sessions.browserName, filters.browser));
  if (filters.route) {
    conditions.push(
      or(eq(sessions.initialRoute, filters.route), sql`${sessions.routes} @> ${JSON.stringify([filters.route])}::jsonb`)!,
    );
  }
  if (filters.hasErrors) conditions.push(gt(sessions.errorCount, 0));
  if (filters.from) conditions.push(gte(sessions.startedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(sessions.startedAt, new Date(filters.to)));
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor);
    if (!cursor) throw validationFailed('Invalid cursor');
    conditions.push(
      or(lt(sessions.startedAt, cursor.startedAt), and(eq(sessions.startedAt, cursor.startedAt), lt(sessions.id, cursor.id)))!,
    );
  }

  const rows = await db
    .select()
    .from(sessions)
    .where(and(...conditions))
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(filters.limit + 1);

  const page = rows.slice(0, filters.limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > filters.limit && last ? encodeCursor(last) : null;
  return { items: page.map(toSessionDto), nextCursor, facets: await sessionFacets(db, projectId) };
}
