import 'server-only';

import { cache } from 'react';
import type { z } from 'zod';
import {
  ErrorResponseSchema,
  ExpectationSuggestionsResponseSchema,
  GeneratedTestSchema,
  HealthSchema,
  IncidentSchema,
  IngestionKeySchema,
  ProjectSchema,
  ReferenceCandidateSchema,
  ReproductionRunSchema,
  DiagnosticFindingSchema,
  SessionListResponseSchema,
  type CreateRunRequest,
  type GenerateTestRequest,
  type Health,
  type IncidentKind,
  type RunTargetMode,
  type SessionFilters,
} from '@repro/contracts';
import { z as zod } from 'zod';
import { ingestUrl, internalToken } from './env';
import {
  IncidentDetailSchema,
  IncidentGroupListSchema,
  IncidentListSchema,
  OkSchema,
  ProjectWithStatsSchema,
  SessionDetailSchema,
  SessionEventsSchema,
  TimelineResponseSchema,
} from './schemas';

/**
 * Typed client for the internal API in apps/ingest. Runs only on the server:
 * the shared token is attached here and never leaves the Next.js process.
 * Every response body is validated with the contracts schema before use.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** The ingest service could not be reached at all (connection refused, DNS, timeout). */
export class ApiUnreachableError extends Error {
  readonly url: string;

  constructor(url: string, cause: unknown) {
    super(`Could not reach the ingest service at ${url}`);
    this.name = 'ApiUnreachableError';
    this.url = url;
    this.cause = cause;
  }
}

export function isUnreachable(error: unknown): error is ApiUnreachableError {
  return error instanceof ApiUnreachableError;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.isNotFound;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, `${ingestUrl()}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Perform a request and return the raw Response. Throws ApiError on non-2xx. */
async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const url = buildUrl(path, options.query);
  const headers: Record<string, string> = { 'x-repro-internal-token': internalToken(), accept: 'application/json, text/plain, */*' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (error) {
    throw new ApiUnreachableError(ingestUrl(), error);
  }

  if (!response.ok) {
    // Errors share one shape; fall back to the status text when the body is not JSON.
    let code = 'internal';
    let message = `${response.status} ${response.statusText}`;
    let details: unknown;
    try {
      const parsed = ErrorResponseSchema.safeParse(await response.json());
      if (parsed.success) {
        code = parsed.data.error.code;
        message = parsed.data.error.message;
        details = parsed.data.error.details;
      }
    } catch {
      // Body was not JSON; keep the status text.
    }
    throw new ApiError(response.status, code, message, details);
  }
  return response;
}

async function request<T extends z.ZodType>(path: string, schema: T, options: RequestOptions = {}): Promise<z.infer<T>> {
  const response = await rawRequest(path, options);
  const json: unknown = await response.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // The ingest API disagrees with the contract. Surface the issues instead of rendering garbage.
    throw new ApiError(502, 'contract_mismatch', `Unexpected response shape from ${path}`, parsed.error.issues);
  }
  return parsed.data;
}

// Health ---------------------------------------------------------------------

/** GET /health with a short timeout. Returns null instead of throwing so layouts can render a status dot. */
export async function ping(): Promise<Health | null> {
  try {
    const response = await fetch(buildUrl('/health'), { cache: 'no-store', signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    const parsed = HealthSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Projects -------------------------------------------------------------------

export const listProjects = cache(async () => request('/api/projects', zod.array(ProjectSchema)));

/** Cached per request, so a layout and a page that both need the project make one call. */
export const getProjectBySlug = cache(async (slug: string) =>
  request(`/api/projects/by-slug/${encodeURIComponent(slug)}`, ProjectWithStatsSchema),
);

export async function listKeys(projectId: string) {
  return request(`/api/projects/${projectId}/keys`, zod.array(IngestionKeySchema));
}

export async function createKey(projectId: string, label: string) {
  return request(`/api/projects/${projectId}/keys`, IngestionKeySchema.extend({ key: zod.string() }), {
    method: 'POST',
    body: { label },
  });
}

export async function revokeKey(projectId: string, keyId: string) {
  return request(`/api/projects/${projectId}/keys/${keyId}`, OkSchema, { method: 'DELETE' });
}

// Sessions -------------------------------------------------------------------

export async function listSessions(projectId: string, filters: Partial<SessionFilters>) {
  return request(`/api/projects/${projectId}/sessions`, SessionListResponseSchema, {
    query: {
      status: filters.status,
      release: filters.release,
      route: filters.route,
      browser: filters.browser,
      hasErrors: filters.hasErrors ? 'true' : undefined,
      from: filters.from,
      to: filters.to,
      cursor: filters.cursor,
      limit: filters.limit,
    },
  });
}

export const getSession = cache(async (projectId: string, sessionId: string) =>
  request(`/api/projects/${projectId}/sessions/${sessionId}`, SessionDetailSchema),
);

export async function getSessionEvents(projectId: string, sessionId: string, types?: string[]) {
  return request(`/api/projects/${projectId}/sessions/${sessionId}/events`, SessionEventsSchema, {
    query: { types: types?.join(',') },
  });
}

export async function getTimeline(projectId: string, sessionId: string) {
  return request(`/api/projects/${projectId}/sessions/${sessionId}/timeline`, TimelineResponseSchema);
}

// Incidents ------------------------------------------------------------------

export async function listIncidents(projectId: string, options: { status?: 'open' | 'resolved'; limit?: number; kind?: IncidentKind } = {}) {
  const { items } = await request(`/api/projects/${projectId}/incidents`, IncidentListSchema, {
    query: { status: options.status, limit: options.limit },
  });
  return options.kind ? items.filter((incident) => incident.kind === options.kind) : items;
}

/** One row per fingerprint across sessions. `status` filters by the derived group status, see docs/API.md. */
export async function listIncidentGroups(projectId: string, options: { status?: 'open' | 'resolved'; limit?: number } = {}) {
  const { items } = await request(`/api/projects/${projectId}/incidents/groups`, IncidentGroupListSchema, {
    query: { status: options.status, limit: options.limit },
  });
  return items;
}

export async function getIncident(projectId: string, incidentId: string) {
  return request(`/api/projects/${projectId}/incidents/${incidentId}`, IncidentDetailSchema);
}

export async function patchIncident(projectId: string, incidentId: string, status: 'open' | 'resolved') {
  return request(`/api/projects/${projectId}/incidents/${incidentId}`, IncidentSchema, { method: 'PATCH', body: { status } });
}

// Generated tests ------------------------------------------------------------

export async function generateTest(projectId: string, sessionId: string, body: GenerateTestRequest) {
  return request(`/api/projects/${projectId}/sessions/${sessionId}/tests`, GeneratedTestSchema, { method: 'POST', body });
}

export async function listTests(projectId: string, sessionId: string) {
  return request(`/api/projects/${projectId}/sessions/${sessionId}/tests`, zod.array(GeneratedTestSchema));
}

export async function getTest(projectId: string, testId: string) {
  return request(`/api/projects/${projectId}/tests/${testId}`, GeneratedTestSchema);
}

/** Raw text/plain response so a route handler can stream it with its content-disposition. */
export async function fetchTestCode(projectId: string, testId: string): Promise<Response> {
  return rawRequest(`/api/projects/${projectId}/tests/${testId}/code`);
}

// Expectation suggestions ----------------------------------------------------

/** Passing sessions on the same route that can serve as the reference for suggestions. */
export async function listReferenceCandidates(projectId: string, sessionId: string) {
  return request(`/api/projects/${projectId}/sessions/${sessionId}/reference-candidates`, zod.array(ReferenceCandidateSchema));
}

/** What appeared only in the reference session. Without a reference, the (empty) heuristic list and a note. */
export async function getExpectationSuggestions(projectId: string, sessionId: string, reference?: string) {
  return request(`/api/projects/${projectId}/sessions/${sessionId}/expectation-suggestions`, ExpectationSuggestionsResponseSchema, {
    query: { reference },
  });
}

// Reproduction runs ----------------------------------------------------------

export async function createRun(projectId: string, testId: string, mode: RunTargetMode) {
  const body: CreateRunRequest = { mode };
  return request(`/api/projects/${projectId}/tests/${testId}/runs`, ReproductionRunSchema, { method: 'POST', body });
}

export async function listRuns(projectId: string, testId: string) {
  return request(`/api/projects/${projectId}/tests/${testId}/runs`, zod.array(ReproductionRunSchema));
}

export async function getRun(projectId: string, runId: string) {
  return request(`/api/projects/${projectId}/runs/${runId}`, ReproductionRunSchema);
}

/** Raw binary response (screenshot.png, trace.zip, report.json). */
export async function fetchArtifact(projectId: string, runId: string, name: string): Promise<Response> {
  return rawRequest(`/api/projects/${projectId}/runs/${runId}/artifacts/${encodeURIComponent(name)}`);
}

// Diagnostics ----------------------------------------------------------------

export async function investigate(projectId: string, sessionId: string) {
  return request(`/api/projects/${projectId}/sessions/${sessionId}/investigate`, DiagnosticFindingSchema, { method: 'POST' });
}

export async function listFindings(projectId: string, sessionId: string) {
  return request(`/api/projects/${projectId}/sessions/${sessionId}/findings`, zod.array(DiagnosticFindingSchema));
}
