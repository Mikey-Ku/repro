import { and, asc, desc, eq } from 'drizzle-orm';
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
