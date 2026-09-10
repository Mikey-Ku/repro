import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { toIngestionKeyDto, toProjectDto } from '../mappers.js';
import { createIngestionKey, listIngestionKeys, revokeIngestionKey } from '../services/keys.js';
import {
  createProject,
  deleteProject,
  findLocalUser,
  getProjectBySlug,
  listProjects,
  projectStats,
} from '../services/projects.js';
import { OK, parseWith, requireProject } from './shared.js';

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** URL-safe: lowercase letters, digits and dashes, starting with a letter or digit. */
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'slug must be lowercase letters, digits and dashes'),
});

const CreateKeySchema = z.object({ label: z.string().trim().min(1).max(100) });

type ProjectParams = { Params: { projectId: string } };

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/me', async () => {
    const user = await findLocalUser(ctx.db);
    if (!user) throw notFound('Local user (run pnpm db:seed)');
    const rows = await listProjects(ctx.db);
    return { user, projects: rows.map(toProjectDto) };
  });

  app.get('/projects', async () => (await listProjects(ctx.db)).map(toProjectDto));

  app.post('/projects', async (request, reply) => {
    const input = parseWith(CreateProjectSchema, request.body, 'Project');
    const project = await createProject(ctx.db, input);
    request.log.info({ projectId: project.id, slug: project.slug }, 'project created');
    return reply.status(201).send(toProjectDto(project));
  });

  /** Declared before `/projects/:projectId` so "by-slug" is never read as an id. */
  app.get<{ Params: { slug: string } }>('/projects/by-slug/:slug', async (request) => {
    const project = await getProjectBySlug(ctx.db, request.params.slug);
    if (!project) throw notFound('Project');
    request.projectId = project.id;
    return { ...toProjectDto(project), stats: await projectStats(ctx.db, project.id) };
  });

  app.get<ProjectParams>('/projects/:projectId', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    return { ...toProjectDto(project), stats: await projectStats(ctx.db, project.id) };
  });

  /** Used by benchmarks and tests to remove everything a project owns in one call. */
  app.delete<ProjectParams>('/projects/:projectId', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    await deleteProject(ctx.db, project.id);
    request.log.info('project deleted');
    return OK;
  });

  app.get<ProjectParams>('/projects/:projectId/keys', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    return (await listIngestionKeys(ctx.db, project.id)).map(toIngestionKeyDto);
  });

  /** The plaintext key is in this response and nowhere else: only its hash is stored. */
  app.post<ProjectParams>('/projects/:projectId/keys', async (request, reply) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const { label } = parseWith(CreateKeySchema, request.body, 'Key');
    const { row, key } = await createIngestionKey(ctx.db, project.id, label);
    request.log.info({ keyPrefix: row.prefix }, 'ingestion key created');
    return reply.status(201).send({ ...toIngestionKeyDto(row), key });
  });

  app.delete<{ Params: { projectId: string; keyId: string } }>('/projects/:projectId/keys/:keyId', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const revoked = await revokeIngestionKey(ctx.db, project.id, request.params.keyId);
    if (!revoked) throw notFound('Ingestion key');
    request.log.info({ keyId: request.params.keyId }, 'ingestion key revoked');
    return OK;
  });
}
