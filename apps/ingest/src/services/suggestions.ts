import { and, desc, eq, ne, or, sql, inArray } from 'drizzle-orm';
import type { DomMarkers, ExpectationSuggestion } from '@repro/contracts';
import { sessions, type Db, type SessionRow } from '@repro/db';

/**
 * Expectation suggestions from a passing reference session.
 *
 * A recording of a failure never shows the success state, so the engineer has had to type the
 * expected element by hand. Comparing the failing session's DOM markers with a passing session's
 * on the same route gives a data-driven proposal: whatever appeared only in the passing one is
 * probably what "fixed" looks like. See docs/TEST_GENERATION.md, "Where the success state comes from".
 */

export const REFERENCE_CANDIDATE_LIMIT = 10;

export const NO_REFERENCE_NOTE =
  'The "no uncaught errors" guard is always applied, so there is nothing else to suggest without a reference. ' +
  'Pass ?reference=<sessionId> with a completed or expired session on the same route that recorded no errors and no failed requests ' +
  '(GET /reference-candidates lists them) to get suggestions from what appeared only in that session.';

/** Contract limits on the fields a suggestion can fill. Longer values could never be accepted by the generate endpoint. */
const MAX_TEST_ID = 200;
const MAX_TEXT = 200;
const MAX_PATH_PREFIX = 500;

/**
 * Completed sessions in the same project that touched a route the failing session touched and
 * recorded no uncaught errors and no failed requests. Newest first, never the session itself.
 * "Same route" is the failing session's initialRoute or any entry of its routes list.
 */
export async function listReferenceCandidates(db: Db, projectId: string, session: SessionRow): Promise<SessionRow[]> {
  const routes = [...new Set([session.initialRoute, ...session.routes])];
  const routeArray = sql`array[${sql.join(
    routes.map((route) => sql`${route}`),
    sql`, `,
  )}]::text[]`;
  return db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.projectId, projectId),
        ne(sessions.id, session.id),
        // Expired sessions count too: a tab closed without stop() still recorded a clean run.
        inArray(sessions.status, ['completed', 'expired']),
        eq(sessions.errorCount, 0),
        eq(sessions.networkFailureCount, 0),
        or(eq(sessions.initialRoute, session.initialRoute), sql`${sessions.routes} ?| ${routeArray}`)!,
      ),
    )
    // Richer recordings first: a passing session that reached the success state has more events
    // than one that stopped on the first page, and that is the one worth diffing against.
    .orderBy(desc(sessions.eventCount), desc(sessions.startedAt), desc(sessions.id))
    .limit(REFERENCE_CANDIDATE_LIMIT);
}

const onlyInReference = (reference: readonly string[], failing: readonly string[], max: number): string[] => {
  const seen = new Set(failing);
  return reference.filter((value) => value.length <= max && !seen.has(value));
};

/**
 * Pure and deterministic. Order: test ids first (the most robust locator), then live-region
 * texts, then headings, then the final path. Nothing in the failing session is ever suggested.
 */
export function suggestFromReference(failing: DomMarkers, reference: DomMarkers): ExpectationSuggestion[] {
  const source = 'reference-session' as const;
  const suggestions: ExpectationSuggestion[] = [];

  for (const testId of onlyInReference(reference.testIds, failing.testIds, MAX_TEST_ID)) {
    suggestions.push({ expectation: { kind: 'visible', testId }, source, reason: 'Appears in the passing session but never in this one' });
  }

  const failingTexts = [...failing.statusTexts, ...failing.headings];
  const suggestedTexts = new Set<string>();
  for (const text of onlyInReference(reference.statusTexts, failingTexts, MAX_TEXT)) {
    suggestedTexts.add(text);
    suggestions.push({ expectation: { kind: 'visible', text }, source, reason: 'Appears in the passing session but never in this one' });
  }
  for (const text of onlyInReference(reference.headings, failingTexts, MAX_TEXT)) {
    if (suggestedTexts.has(text)) continue;
    suggestions.push({ expectation: { kind: 'visible', text }, source, reason: 'Heading shown in the passing session but never in this one' });
  }

  if (reference.finalPath && reference.finalPath !== failing.finalPath && reference.finalPath.length <= MAX_PATH_PREFIX) {
    suggestions.push({ expectation: { kind: 'url', pathPrefix: reference.finalPath }, source, reason: 'The passing session ended on this path' });
  }

  return suggestions;
}
