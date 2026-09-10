import type { FastifyInstance } from 'fastify';
import { SessionFiltersSchema, SessionMetaSchema, type RecordedEventType } from '@repro/contracts';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { toFindingDto, toGeneratedTestDto, toIncidentDto, toSessionDto } from '../mappers.js';
import { loadSessionEvents } from '../services/events.js';
import { buildSessionEvidence, listFindings } from '../services/findings.js';
import { listIncidentsForSession } from '../services/incidents.js';
import { deleteSession, listSessions } from '../services/sessions.js';
import { listTestsForSession } from '../services/tests.js';
import { OK, parseWith, requireProject, requireSession } from './shared.js';

const EVENT_TYPES = [
  'rrweb',
  'click',
  'input',
  'submit',
  'navigation',
  'error',
  'console',
  'network',
  'annotation',
  'identify',
] as const satisfies readonly RecordedEventType[];

/** `?types=rrweb,click` as a list of known event types. Unknown names are a 400, not silently ignored. */
const EventTypesQuery = z.object({
  types: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((t) => t.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(EVENT_TYPES)).optional()),
});

type Query = Record<string, string | undefined>;

/**
 * The contract coerces `hasErrors` with z.coerce.boolean(), which turns the string "false" into
 * true. Treat only "true" and "1" as set so a link such as `?hasErrors=false` means "no filter".
 */
function normalizeListQuery(query: Query): Query {
  if (query.hasErrors === undefined) return query;
  const on = query.hasErrors === 'true' || query.hasErrors === '1';
  const { hasErrors: _dropped, ...rest } = query;
  return on ? { ...rest, hasErrors: 'true' } : rest;
}

type ProjectParams = { Params: { projectId: string }; Querystring: Query };
type SessionParams = { Params: { projectId: string; sessionId: string }; Querystring: Query };

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<ProjectParams>('/projects/:projectId/sessions', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const filters = parseWith(SessionFiltersSchema, normalizeListQuery(request.query), 'Session filters');
    return listSessions(ctx.db, project.id, filters);
  });

  app.get<SessionParams>('/projects/:projectId/sessions/:sessionId', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    const [incidents, tests, findings] = await Promise.all([
      listIncidentsForSession(ctx.db, project.id, session.id),
      listTestsForSession(ctx.db, project.id, session.id),
      listFindings(ctx.db, project.id, session.id),
    ]);
    return {
      session: toSessionDto(session),
      incidents: incidents.map(toIncidentDto),
      tests: tests.map(toGeneratedTestDto),
      findings: findings.map(toFindingDto),
    };
  });

  app.get<SessionParams>('/projects/:projectId/sessions/:sessionId/events', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    const { types } = parseWith(EventTypesQuery, request.query, 'Event filter');
    const events = await loadSessionEvents(ctx.db, session.id, types);
    // Meta was validated on ingest; parsing again guards against rows written by older code.
    const meta = SessionMetaSchema.safeParse(session.meta);
    if (!meta.success) throw notFound('Session meta');
    return { events, meta: meta.data };
  });

  app.get<SessionParams>('/projects/:projectId/sessions/:sessionId/timeline', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    const events = await loadSessionEvents(ctx.db, session.id);
    return buildSessionEvidence(session, events);
  });

  app.delete<SessionParams>('/projects/:projectId/sessions/:sessionId', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    await deleteSession(ctx.db, project.id, session.id);
    request.log.info({ sessionId: session.id }, 'session deleted');
    return OK;
  });
}
