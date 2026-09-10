import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { routeFromPath, sanitizePath, type RecordedEvent } from '@repro/contracts';
import { diagnosticFindings, incidents, sessions, type Db, type SessionRow } from '@repro/db';
import { extractIncidents, summarizeEvidence, type SessionContext } from '@repro/diagnostics';
import { loadSessionEvents } from '../events.js';

export const ProcessSessionPayload = z.object({ projectId: z.uuid(), sessionId: z.uuid() });
export type ProcessSessionPayload = z.infer<typeof ProcessSessionPayload>;

export interface ProcessSessionResult {
  events: number;
  /** Incidents newly inserted by this run; re-processing a session inserts none. */
  incidentsInserted: number;
  incidentsFound: number;
  errorCount: number;
  networkFailureCount: number;
  routes: string[];
}

function contextOf(session: SessionRow): SessionContext {
  return {
    startedAt: session.startedAt.getTime(),
    release: session.release,
    browser: session.browserName,
    status: session.status,
  };
}

/**
 * Counters derived from the full event stream. The ingest API keeps running totals per batch;
 * recomputing them here makes the numbers exact after retries and duplicate uploads.
 */
export function summariseSession(events: readonly RecordedEvent[], initialRoute: string) {
  let errorCount = 0;
  let networkFailureCount = 0;
  const routes = new Set<string>([initialRoute]);
  for (const event of events) {
    if (event.type === 'error' && !event.data.handled) errorCount += 1;
    if (event.type === 'network' && !event.data.ok) networkFailureCount += 1;
    if (event.type === 'navigation') routes.add(routeFromPath(sanitizePath(event.data.url)));
  }
  return { errorCount, networkFailureCount, routes: [...routes] };
}

/**
 * Turn a finished session into incidents, an evidence summary and fresh counters.
 * Safe to run more than once: incidents are unique per (session, fingerprint), the evidence
 * finding is replaced, and the counters are recomputed rather than incremented.
 */
export async function processSession(db: Db, payload: ProcessSessionPayload): Promise<ProcessSessionResult> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, payload.sessionId), eq(sessions.projectId, payload.projectId)))
    .limit(1);
  if (!session) throw new Error(`Session ${payload.sessionId} not found in project ${payload.projectId}`);

  const events = await loadSessionEvents(db, session.id);
  const ctx = contextOf(session);
  const candidates = extractIncidents(events, ctx);
  const evidence = summarizeEvidence(events, ctx);
  const summary = summariseSession(events, session.initialRoute);

  let incidentsInserted = 0;
  await db.transaction(async (tx) => {
    if (candidates.length > 0) {
      const inserted = await tx
        .insert(incidents)
        .values(
          candidates.map((candidate) => ({
            projectId: session.projectId,
            sessionId: session.id,
            kind: candidate.kind,
            title: candidate.title,
            message: candidate.message,
            fingerprint: candidate.fingerprint,
            firstSeq: candidate.firstSeq,
            firstTs: new Date(candidate.firstTs),
            offsetMs: candidate.offsetMs,
            route: candidate.route,
            release: session.release,
          })),
        )
        .onConflictDoNothing({ target: [incidents.sessionId, incidents.fingerprint] })
        .returning({ id: incidents.id });
      incidentsInserted = inserted.length;
    }

    // The deterministic summary is derived state, so the previous one is replaced rather than
    // accumulated. AI investigations (provider != deterministic) are left alone.
    await tx
      .delete(diagnosticFindings)
      .where(
        and(
          eq(diagnosticFindings.sessionId, session.id),
          eq(diagnosticFindings.kind, 'evidence'),
          eq(diagnosticFindings.provider, 'deterministic'),
        ),
      );
    await tx.insert(diagnosticFindings).values({
      projectId: session.projectId,
      sessionId: session.id,
      kind: 'evidence',
      provider: 'deterministic',
      model: null,
      evidence,
    });

    await tx
      .update(sessions)
      .set({
        errorCount: summary.errorCount,
        networkFailureCount: summary.networkFailureCount,
        routes: summary.routes,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, session.id));
  });

  return {
    events: events.length,
    incidentsInserted,
    incidentsFound: candidates.length,
    errorCount: summary.errorCount,
    networkFailureCount: summary.networkFailureCount,
    routes: summary.routes,
  };
}
