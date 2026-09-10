import { and, desc, eq } from 'drizzle-orm';
import { buildTimeline, type EvidenceSummary, type RecordedEvent, type TimelineEntry } from '@repro/contracts';
import { diagnosticFindings, type Db, type FindingRow, type SessionRow } from '@repro/db';
import { redactForModel, summarizeEvidence, type InvestigatorInput } from '@repro/diagnostics';
import type { AppContext } from '../context.js';
import { browserLabel } from './tests.js';

export interface SessionEvidence {
  entries: TimelineEntry[];
  evidence: EvidenceSummary;
}

/** The timeline and the deterministic evidence summary for a session, computed from its events. */
export function buildSessionEvidence(session: SessionRow, events: RecordedEvent[]): SessionEvidence {
  const startedAt = session.startedAt.getTime();
  return {
    entries: buildTimeline(events, startedAt),
    evidence: summarizeEvidence(events, {
      startedAt,
      release: session.release,
      browser: browserLabel(session),
      status: session.status,
    }),
  };
}

/**
 * Run the configured investigator and store the result as an `investigation` finding.
 * The evidence summary is stored alongside so the dashboard can show facts and hypothesis
 * side by side without recomputing.
 */
export async function investigateSession(ctx: AppContext, session: SessionRow, events: RecordedEvent[]): Promise<FindingRow> {
  const { entries, evidence } = buildSessionEvidence(session, events);
  // Nothing but the redacted view may reach a provider. The Investigator interface is declared on
  // the unredacted input (an AI investigator redacts again internally, the fake ignores the
  // timeline), and the redacted shape is that input minus the raw `event` on each row, hence the cast.
  const modelInput = redactForModel({ summary: evidence, timeline: entries });
  const investigation = await ctx.investigator.investigate(modelInput as unknown as InvestigatorInput);

  const [row] = await ctx.db
    .insert(diagnosticFindings)
    .values({
      projectId: session.projectId,
      sessionId: session.id,
      kind: 'investigation',
      provider: investigation.provider,
      model: investigation.model,
      evidence,
      investigation,
    })
    .returning();
  if (!row) throw new Error('Finding insert returned no row');
  return row;
}

export async function listFindings(db: Db, projectId: string, sessionId: string): Promise<FindingRow[]> {
  return db
    .select()
    .from(diagnosticFindings)
    .where(and(eq(diagnosticFindings.projectId, projectId), eq(diagnosticFindings.sessionId, sessionId)))
    .orderBy(desc(diagnosticFindings.createdAt), desc(diagnosticFindings.id));
}
