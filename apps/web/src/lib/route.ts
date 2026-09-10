import 'server-only';

import { ApiError, getProjectBySlug, isUnreachable } from './api';
import type { ProjectWithStats } from './schemas';

/**
 * Helpers for route handlers under src/app/api. They run on the server, so the
 * internal token stays in this process; the browser only ever sees these proxies.
 */

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

/** Map client errors to the same envelope the ingest API uses, so callers handle one shape. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) return jsonError(error.status, error.code, error.message);
  if (isUnreachable(error)) return jsonError(503, 'unreachable', error.message);
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return jsonError(500, 'internal', message);
}

/** Resolve the project and run the handler, translating failures into JSON responses. */
export async function withProject(slug: string, handler: (project: ProjectWithStats) => Promise<Response>): Promise<Response> {
  try {
    const project = await getProjectBySlug(slug);
    return await handler(project);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Copy an upstream binary or text response through, keeping only the headers that matter. */
export function passthrough(upstream: Response, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(upstream.body, { status: upstream.status, headers });
}
