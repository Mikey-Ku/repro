import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { toFindingDto } from '../mappers.js';
import { loadSessionEvents } from '../services/events.js';
import { investigateSession, listFindings } from '../services/findings.js';
import { requireProject, requireSession } from './shared.js';

type SessionParams = { Params: { projectId: string; sessionId: string } };

export function registerFindingRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post<SessionParams>('/projects/:projectId/sessions/:sessionId/investigate', async (request, reply) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    const events = await loadSessionEvents(ctx.db, session.id);
    const row = await investigateSession(ctx, session, events);
    request.log.info({ sessionId: session.id, findingId: row.id, provider: row.provider }, 'investigation stored');
    return reply.status(201).send(toFindingDto(row));
  });

  app.get<SessionParams>('/projects/:projectId/sessions/:sessionId/findings', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    return (await listFindings(ctx.db, project.id, session.id)).map(toFindingDto);
  });
}
