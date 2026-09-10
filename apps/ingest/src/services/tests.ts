import { and, desc, eq } from 'drizzle-orm';
import type { Expectation, GenerateTestRequest } from '@repro/contracts';
import { generatedTests, type Db, type GeneratedTestRow, type IncidentRow, type ProjectRow, type SessionRow } from '@repro/db';
import type { GeneratorInput } from '@repro/test-generator';
import type { AppContext } from '../context.js';
import { loadSessionEvents } from './events.js';

/** "Chrome 130" style label shared by generated test headers and evidence summaries. */
export function browserLabel(session: Pick<SessionRow, 'browserName' | 'browserVersion'>): string | null {
  const label = [session.browserName, session.browserVersion].filter(Boolean).join(' ');
  return label || null;
}

/** Download name for a test: the first eight characters of the session id are enough to tell files apart. */
export function testFileName(sessionId: string): string {
  return `repro-${sessionId.slice(0, 8)}.spec.ts`;
}

export async function latestTestForSession(db: Db, sessionId: string): Promise<GeneratedTestRow | null> {
  const [row] = await db
    .select()
    .from(generatedTests)
    .where(eq(generatedTests.sessionId, sessionId))
    .orderBy(desc(generatedTests.version))
    .limit(1);
  return row ?? null;
}

/** Order-insensitive comparison is not wanted: expectations are applied in order, so order is part of the identity. */
function sameExpectations(a: readonly Expectation[], b: unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Generate (or reuse) the Playwright test for a session. Generation is deterministic, so when the
 * latest stored version has the same source hash and the same expectations there is nothing new
 * to store: that row is returned as-is. Otherwise a new row with `version + 1` is inserted.
 */
export async function generateTestForSession(
  ctx: AppContext,
  project: ProjectRow,
  session: SessionRow,
  request: GenerateTestRequest,
  incident: IncidentRow | null,
): Promise<GeneratedTestRow> {
  const events = await loadSessionEvents(ctx.db, session.id);
  const input: GeneratorInput = {
    session: {
      id: session.id,
      projectSlug: project.slug,
      startedAt: session.startedAt.getTime(),
      initialUrl: session.initialUrl,
      release: session.release,
      browser: browserLabel(session),
      dashboardUrl: `${ctx.appUrl}/projects/${project.slug}/sessions/${session.id}`,
    },
    events,
    expectations: request.expectations,
    testName: request.testName,
    incident: incident ? { id: incident.id, title: incident.title, message: incident.message } : null,
  };
  const output = await ctx.generateTest(input);

  const latest = await latestTestForSession(ctx.db, session.id);
  if (latest && latest.sourceHash === output.sourceHash && sameExpectations(request.expectations, latest.expectations)) {
    return latest;
  }

  const [inserted] = await ctx.db
    .insert(generatedTests)
    .values({
      projectId: project.id,
      sessionId: session.id,
      incidentId: incident?.id ?? null,
      version: (latest?.version ?? 0) + 1,
      name: output.name,
      code: output.code,
      language: 'typescript',
      framework: 'playwright',
      sourceHash: output.sourceHash,
      generatorVersion: output.generatorVersion,
      selectors: output.selectors,
      omitted: output.omitted,
      warnings: output.warnings,
      expectations: request.expectations,
    })
    .returning();
  if (!inserted) throw new Error('Generated test insert returned no row');
  return inserted;
}

export async function listTestsForSession(db: Db, projectId: string, sessionId: string): Promise<GeneratedTestRow[]> {
  return db
    .select()
    .from(generatedTests)
    .where(and(eq(generatedTests.projectId, projectId), eq(generatedTests.sessionId, sessionId)))
    .orderBy(desc(generatedTests.version), desc(generatedTests.createdAt));
}

export async function getTest(db: Db, projectId: string, testId: string): Promise<GeneratedTestRow | null> {
  const [row] = await db
    .select()
    .from(generatedTests)
    .where(and(eq(generatedTests.id, testId), eq(generatedTests.projectId, projectId)))
    .limit(1);
  return row ?? null;
}
