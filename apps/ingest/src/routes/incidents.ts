import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { toGeneratedTestDto, toIncidentDto, toIncidentGroupDto, toSessionDto } from '../mappers.js';
import { getIncident, listIncidentGroups, listIncidents, updateIncidentStatus } from '../services/incidents.js';
import { getSession } from '../services/sessions.js';
import { listTestsForSession } from '../services/tests.js';
import { idParam, parseWith, requireProject } from './shared.js';

const IncidentStatusSchema = z.enum(['open', 'resolved']);

const ListQuerySchema = z.object({
  status: IncidentStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const PatchSchema = z.object({ status: IncidentStatusSchema });

type ProjectParams = { Params: { projectId: string }; Querystring: Record<string, string | undefined> };
type IncidentParams = { Params: { projectId: string; incidentId: string } };

export function registerIncidentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<ProjectParams>('/projects/:projectId/incidents', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const query = parseWith(ListQuerySchema, request.query, 'Incident filters');
    const rows = await listIncidents(ctx.db, project.id, query);
    return { items: rows.map(toIncidentDto) };
  });

  // Registered before the /:incidentId route so the literal segment "groups" is never read as an id.
  app.get<ProjectParams>('/projects/:projectId/incidents/groups', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const query = parseWith(ListQuerySchema, request.query, 'Incident group filters');
    const rows = await listIncidentGroups(ctx.db, project.id, query);
    return { items: rows.map(toIncidentGroupDto) };
  });

  app.get<IncidentParams>('/projects/:projectId/incidents/:incidentId', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const incident = await getIncident(ctx.db, project.id, idParam(request.params.incidentId, 'Incident'));
    if (!incident) throw notFound('Incident');
    const session = await getSession(ctx.db, project.id, incident.sessionId);
    if (!session) throw notFound('Session');
    const tests = await listTestsForSession(ctx.db, project.id, incident.sessionId);
    return { incident: toIncidentDto(incident), session: toSessionDto(session), tests: tests.map(toGeneratedTestDto) };
  });

  app.patch<IncidentParams>('/projects/:projectId/incidents/:incidentId', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const { status } = parseWith(PatchSchema, request.body, 'Incident update');
    const updated = await updateIncidentStatus(ctx.db, project.id, idParam(request.params.incidentId, 'Incident'), status);
    if (!updated) throw notFound('Incident');
    request.log.info({ incidentId: updated.id, status }, 'incident status changed');
    return toIncidentDto(updated);
  });
}
