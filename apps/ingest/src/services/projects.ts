import { and, asc, count, eq, max, sql } from 'drizzle-orm';
import type { ProjectStats } from '@repro/contracts';
import {
  LOCAL_USER,
  generatedTests,
  incidents,
  projectMembers,
  projects,
  reproductionRuns,
  sessions,
  users,
  type Db,
  type ProjectRow,
} from '@repro/db';
import { AppError } from '../errors.js';

export interface LocalUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Repro runs single-tenant locally: the seed creates one developer user. `/api/me` reports that
 * user (or the first user found), so the dashboard has a name to show without an auth system.
 */
export async function findLocalUser(db: Db): Promise<LocalUser | null> {
  const [seeded] = await db.select().from(users).where(eq(users.email, LOCAL_USER.email)).limit(1);
  const row = seeded ?? (await db.select().from(users).orderBy(asc(users.createdAt)).limit(1))[0];
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}

export async function listProjects(db: Db): Promise<ProjectRow[]> {
  return db.select().from(projects).orderBy(asc(projects.createdAt), asc(projects.slug));
}

export async function getProject(db: Db, projectId: string): Promise<ProjectRow | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  return row ?? null;
}

export async function getProjectBySlug(db: Db, slug: string): Promise<ProjectRow | null> {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return row ?? null;
}

/** Postgres reports a unique-index hit as SQLSTATE 23505; Drizzle may wrap it, so look one level down too. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === '23505';
}

export async function createProject(db: Db, input: { name: string; slug: string }): Promise<ProjectRow> {
  let inserted: ProjectRow | undefined;
  try {
    [inserted] = await db.insert(projects).values({ name: input.name, slug: input.slug }).returning();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('conflict', `A project with slug "${input.slug}" already exists`);
    throw error;
  }
  if (!inserted) throw new Error('Project insert returned no row');
  // Make the local developer the owner so membership stays consistent with the seed.
  const user = await findLocalUser(db);
  if (user) {
    await db.insert(projectMembers).values({ projectId: inserted.id, userId: user.id, role: 'owner' }).onConflictDoNothing();
  }
  return inserted;
}

/** Cascades through the schema: sessions, chunks, keys, incidents, tests, runs and findings go with it. */
export async function deleteProject(db: Db, projectId: string): Promise<boolean> {
  const rows = await db.delete(projects).where(eq(projects.id, projectId)).returning({ id: projects.id });
  return rows.length > 0;
}

export async function projectStats(db: Db, projectId: string): Promise<ProjectStats> {
  const [sessionStats, incidentStats, testStats, runStats] = await Promise.all([
    db
      .select({
        sessions: count(),
        sessionsWithErrors: sql<number>`count(*) filter (where ${sessions.errorCount} > 0)`.mapWith(Number),
        lastSessionAt: max(sessions.startedAt),
      })
      .from(sessions)
      .where(eq(sessions.projectId, projectId)),
    db
      .select({
        openIncidents: count(),
        // Groups, not rows: the same fingerprint seen in ten sessions is one open group.
        openIncidentGroups: sql<number>`count(distinct ${incidents.fingerprint})`.mapWith(Number),
      })
      .from(incidents)
      .where(and(eq(incidents.projectId, projectId), eq(incidents.status, 'open'))),
    db.select({ generatedTests: count() }).from(generatedTests).where(eq(generatedTests.projectId, projectId)),
    db.select({ runs: count() }).from(reproductionRuns).where(eq(reproductionRuns.projectId, projectId)),
  ]);
  const last = sessionStats[0]?.lastSessionAt ?? null;
  return {
    sessions: sessionStats[0]?.sessions ?? 0,
    sessionsWithErrors: sessionStats[0]?.sessionsWithErrors ?? 0,
    openIncidents: incidentStats[0]?.openIncidents ?? 0,
    openIncidentGroups: incidentStats[0]?.openIncidentGroups ?? 0,
    generatedTests: testStats[0]?.generatedTests ?? 0,
    runs: runStats[0]?.runs ?? 0,
    lastSessionAt: last ? new Date(last).toISOString() : null,
  };
}
