import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { incidents, type Db, type IncidentRow } from '@repro/db';

export type IncidentStatus = IncidentRow['status'];

export interface IncidentListOptions {
  status?: IncidentStatus;
  limit: number;
}

/** Incidents are written by the worker's process_session job; this service only reads and re-labels them. */
export async function listIncidents(db: Db, projectId: string, options: IncidentListOptions): Promise<IncidentRow[]> {
  const conditions = [eq(incidents.projectId, projectId)];
  if (options.status) conditions.push(eq(incidents.status, options.status));
  return db
    .select()
    .from(incidents)
    .where(and(...conditions))
    .orderBy(desc(incidents.createdAt), desc(incidents.id))
    .limit(options.limit);
}

/** One row per fingerprint, aggregated over every session in the project. */
export interface IncidentGroupRow {
  fingerprint: string;
  kind: IncidentRow['kind'];
  title: string;
  message: string;
  sessionCount: number;
  firstSeen: Date;
  lastSeen: Date;
  releases: string[];
  routes: string[];
  openCount: number;
  latestIncidentId: string;
  latestSessionId: string;
}

/**
 * The value of `column` on the newest incident in the group. Postgres has no "first row" aggregate,
 * so we sort the group inside array_agg and take element one. The id tie-break keeps the pick
 * stable when two incidents share a timestamp. Cast to text so enum columns come back as strings.
 */
const fromLatest = (column: AnyPgColumn): SQL<string> =>
  sql<string>`(array_agg(${column}::text order by ${incidents.firstTs} desc, ${incidents.id} desc))[1]`;

/** Distinct non-null values, sorted, so releases and routes read the same on every request. */
const distinctValues = (column: AnyPgColumn): SQL<string[]> =>
  sql<string[]>`array_remove(array_agg(distinct ${column} order by ${column}), null)`;

const toDate = (value: string | Date): Date => new Date(value);

/**
 * Cross-session grouping in a single grouped query, no extra table. A group's status is derived:
 * `open` means at least one incident in it is still open, `resolved` means all of them are.
 * Counts always cover the whole group, whichever filter is applied.
 */
export async function listIncidentGroups(db: Db, projectId: string, options: IncidentListOptions): Promise<IncidentGroupRow[]> {
  const openCount = sql<number>`count(*) filter (where ${incidents.status} = 'open')`.mapWith(Number);
  const lastSeen = sql<Date>`max(${incidents.firstTs})`.mapWith(toDate);

  const groupFilter: SQL | undefined =
    options.status === 'open' ? sql`${openCount} > 0` : options.status === 'resolved' ? sql`${openCount} = 0` : undefined;

  return db
    .select({
      fingerprint: incidents.fingerprint,
      kind: sql<IncidentRow['kind']>`${fromLatest(incidents.kind)}`,
      title: fromLatest(incidents.title),
      message: fromLatest(incidents.message),
      sessionCount: sql<number>`count(distinct ${incidents.sessionId})`.mapWith(Number),
      firstSeen: sql<Date>`min(${incidents.firstTs})`.mapWith(toDate),
      lastSeen,
      releases: distinctValues(incidents.release),
      routes: distinctValues(incidents.route),
      openCount,
      latestIncidentId: fromLatest(incidents.id),
      latestSessionId: fromLatest(incidents.sessionId),
    })
    .from(incidents)
    .where(eq(incidents.projectId, projectId))
    .groupBy(incidents.fingerprint)
    .having(groupFilter)
    .orderBy(desc(lastSeen), asc(incidents.fingerprint))
    .limit(options.limit);
}

export async function listIncidentsForSession(db: Db, projectId: string, sessionId: string): Promise<IncidentRow[]> {
  return db
    .select()
    .from(incidents)
    .where(and(eq(incidents.projectId, projectId), eq(incidents.sessionId, sessionId)))
    .orderBy(asc(incidents.firstSeq));
}

export async function getIncident(db: Db, projectId: string, incidentId: string): Promise<IncidentRow | null> {
  const [row] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), eq(incidents.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

export async function updateIncidentStatus(
  db: Db,
  projectId: string,
  incidentId: string,
  status: IncidentStatus,
): Promise<IncidentRow | null> {
  const [row] = await db
    .update(incidents)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(incidents.id, incidentId), eq(incidents.projectId, projectId)))
    .returning();
  return row ?? null;
}
