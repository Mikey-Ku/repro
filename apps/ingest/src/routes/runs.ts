import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { CreateRunRequestSchema } from '@repro/contracts';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { toRunDto } from '../mappers.js';
import { findRunTarget } from '../services/projects.js';
import { createRun, getRun, listRunsForTest, resolveArtifact, type ResolvedRunTarget } from '../services/runs.js';
import { getTest } from '../services/tests.js';
import { idParam, parseWith, requireProject } from './shared.js';

type TestParams = { Params: { projectId: string; testId: string } };
type RunParams = { Params: { projectId: string; runId: string } };
type ArtifactParams = { Params: { projectId: string; runId: string; name: string } };

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post<TestParams>('/projects/:projectId/tests/:testId/runs', async (request, reply) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const test = await getTest(ctx.db, project.id, idParam(request.params.testId, 'Generated test'));
    if (!test) throw notFound('Generated test');
    const { targetId, mode } = parseWith(CreateRunRequestSchema, request.body ?? {}, 'Run request');
    let resolved: ResolvedRunTarget;
    if (targetId === 'demo') {
      resolved = { target: 'demo', targetMode: mode ?? 'broken', targetName: null, targetUrl: null };
    } else {
      // A target id from another project can never match this project's list, so it is a plain 404.
      const target = findRunTarget(project, targetId);
      if (!target) throw notFound('Run target');
      resolved = { target: target.id, targetMode: 'none', targetName: target.name, targetUrl: target.url };
    }
    const run = await createRun(ctx.db, test, resolved);
    request.log.info({ testId: test.id, runId: run.id, target: resolved.target, mode: resolved.targetMode }, 'reproduction run queued');
    return reply.status(201).send(toRunDto(run));
  });

  app.get<TestParams>('/projects/:projectId/tests/:testId/runs', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const test = await getTest(ctx.db, project.id, idParam(request.params.testId, 'Generated test'));
    if (!test) throw notFound('Generated test');
    return (await listRunsForTest(ctx.db, project.id, test.id)).map(toRunDto);
  });

  app.get<RunParams>('/projects/:projectId/runs/:runId', async (request) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const run = await getRun(ctx.db, project.id, idParam(request.params.runId, 'Run'));
    if (!run) throw notFound('Run');
    return toRunDto(run);
  });

  /** Streams one of the files the worker recorded on the run. Unknown names and missing files are both 404. */
  app.get<ArtifactParams>('/projects/:projectId/runs/:runId/artifacts/:name', async (request, reply) => {
    const project = await requireProject(ctx, request, request.params.projectId);
    const run = await getRun(ctx.db, project.id, idParam(request.params.runId, 'Run'));
    if (!run) throw notFound('Run');
    const artifact = resolveArtifact(run, request.params.name, ctx.artifactsDir);
    if (!artifact) throw notFound('Artifact');
    const info = await stat(artifact.filePath).catch(() => null);
    if (!info || !info.isFile()) {
      request.log.warn({ runId: run.id, artifact: artifact.name }, 'artifact listed on run but missing on disk');
      throw notFound('Artifact');
    }
    return reply
      .type(artifact.contentType)
      .header('content-length', info.size)
      .header('content-disposition', `inline; filename="${artifact.name}"`)
      .send(createReadStream(artifact.filePath));
  });
}
