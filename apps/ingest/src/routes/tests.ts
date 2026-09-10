import type { FastifyInstance } from 'fastify';
import { GenerateTestRequestSchema } from '@repro/contracts';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { toGeneratedTestDto } from '../mappers.js';
import { getIncident } from '../services/incidents.js';
import { generateTestForSession, getTest, listTestsForSession, testFileName } from '../services/tests.js';
import { idParam, parseWith, requireProject, requireSession } from './shared.js';

type SessionParams = { Params: { projectId: string; sessionId: string } };
type TestParams = { Params: { projectId: string; testId: string } };

export function registerTestRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post<SessionParams>('/projects/:projectId/sessions/:sessionId/tests', async (request, reply) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    // An absent body means "defaults" (no extra expectations, derived name).
    const body = parseWith(GenerateTestRequestSchema, request.body ?? {}, 'Generate test request');

    let incident = null;
    if (body.incidentId) {
      incident = await getIncident(ctx.db, project.id, idParam(body.incidentId, 'Incident'));
      // The incident must be this session's: a test cannot claim to reproduce another session's failure.
      if (!incident || incident.sessionId !== session.id) throw notFound('Incident');
    }

    const row = await generateTestForSession(ctx, project, session, body, incident);
    request.log.info({ sessionId: session.id, testId: row.id, version: row.version }, 'test generated');
    return reply.status(201).send(toGeneratedTestDto(row));
  });

  app.get<SessionParams>('/projects/:projectId/sessions/:sessionId/tests', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const session = await requireSession(ctx, project.id, request.params.sessionId);
    return (await listTestsForSession(ctx.db, project.id, session.id)).map(toGeneratedTestDto);
  });

  app.get<TestParams>('/projects/:projectId/tests/:testId', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const row = await getTest(ctx.db, project.id, idParam(request.params.testId, 'Generated test'));
    if (!row) throw notFound('Generated test');
    return toGeneratedTestDto(row);
  });

  /** The raw file, ready for "Download" in the dashboard or `curl -O`. */
  app.get<TestParams>('/projects/:projectId/tests/:testId/code', async (request, reply) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const row = await getTest(ctx.db, project.id, idParam(request.params.testId, 'Generated test'));
    if (!row) throw notFound('Generated test');
    return reply
      .type('text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="${testFileName(row.sessionId)}"`)
      .send(row.code);
  });
}
