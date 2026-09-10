import type { FastifyRequest } from 'fastify';
import type { ProjectRow, SessionRow } from '@repro/db';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { notFound, validationFailed } from '../errors.js';
import { getProject } from '../services/projects.js';
import { getSession } from '../services/sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set once the project in the path has been loaded, so the response log can carry it. */
    projectId?: string;
  }
}

/** Every id in the API is a UUID. Anything else can never match a row, so it is a plain 404 rather than a database error. */
const IdSchema = z.uuid();
export function idParam(value: string, what: string): string {
  if (!IdSchema.safeParse(value).success) throw notFound(what);
  return value;
}

/** How many Zod issues are echoed back. Enough to fix a client, not enough to become a payload of its own. */
export const MAX_ISSUES = 20;

export interface IssueSummary {
  path: string;
  code: string;
  message: string;
}

export function summarizeIssues(error: z.ZodError): { issues: IssueSummary[]; issueCount: number } {
  return {
    issues: error.issues.slice(0, MAX_ISSUES).map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    })),
    issueCount: error.issues.length,
  };
}

/** Validate a body or query object and turn failures into the API's 400 shape. */
export function parseWith<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationFailed(`${what} failed validation`, summarizeIssues(parsed.error));
  return parsed.data;
}

/** Load the project from the path or 404. Also tags the request so its log line carries the project id. */
export async function requireProject(ctx: AppContext, request: FastifyRequest, projectId: string): Promise<ProjectRow> {
  const project = await getProject(ctx.db, idParam(projectId, 'Project'));
  if (!project) throw notFound('Project');
  request.projectId = project.id;
  request.log = request.log.child({ projectId: project.id });
  return project;
}

/** Load a session inside a project. A session that exists under another project is a 404, never a 403. */
export async function requireSession(ctx: AppContext, projectId: string, sessionId: string): Promise<SessionRow> {
  const session = await getSession(ctx.db, projectId, idParam(sessionId, 'Session'));
  if (!session) throw notFound('Session');
  return session;
}

export const OK = { ok: true as const };
