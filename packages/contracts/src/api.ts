import { z } from 'zod';
import { LIMITS } from './limits.js';
import { EvidenceSummarySchema, InvestigationSchema } from './evidence.js';

export const SessionStatus = z.enum(['recording', 'completed', 'expired']);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** How many external reproduction targets one project may configure. */
export const MAX_RUN_TARGETS = 10;

/**
 * The origin of a reproduction target, or null when the URL is not acceptable. A target is an
 * origin and nothing more: http or https, a host, an optional port. Credentials, a path other
 * than "/", a query string or a fragment are refused rather than silently dropped, so what the
 * owner typed is what the worker will point Playwright at. Loopback and private hosts are allowed
 * because Repro is a local tool and the application under test usually runs next to it.
 */
export function runTargetOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.search || url.hash) return null;
  if (!url.hostname) return null;
  return url.origin;
}

const RunTargetUrl = z
  .string()
  .max(2000)
  .refine((value) => runTargetOrigin(value) !== null, 'must be an http(s) origin such as https://staging.example.com, without path, query or credentials');

/** A project-configured reproduction target. `url` is always an origin. */
export const RunTargetSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  url: RunTargetUrl,
  kind: z.literal('external'),
});
export type RunTarget = z.infer<typeof RunTargetSchema>;

/** What the owner submits to add a target. The id is assigned by the server and the url is normalised to its origin. */
export const RunTargetInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: RunTargetUrl,
});
export type RunTargetInput = z.infer<typeof RunTargetInputSchema>;

/** The implicit target every project has: the bundled demo application, read from DEMO_URL. */
export const DemoRunTargetSchema = z.object({
  id: z.literal('demo'),
  name: z.string(),
  url: z.string(),
  kind: z.literal('demo'),
});
export type DemoRunTarget = z.infer<typeof DemoRunTargetSchema>;

export const RunTargetsResponseSchema = z.object({
  demo: DemoRunTargetSchema,
  targets: z.array(RunTargetSchema),
});
export type RunTargetsResponse = z.infer<typeof RunTargetsResponseSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  retentionDays: z.number().int(),
  runTargets: z.array(RunTargetSchema),
  createdAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectStatsSchema = z.object({
  sessions: z.number().int(),
  sessionsWithErrors: z.number().int(),
  openIncidents: z.number().int(),
  /** Distinct fingerprints with at least one open incident: what the dashboard shows as open groups. */
  openIncidentGroups: z.number().int(),
  generatedTests: z.number().int(),
  runs: z.number().int(),
  lastSessionAt: z.string().nullable(),
});
export type ProjectStats = z.infer<typeof ProjectStatsSchema>;

export const IngestionKeySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  label: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export type IngestionKey = z.infer<typeof IngestionKeySchema>;

export const SessionSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: SessionStatus,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  lastSeenAt: z.string(),
  durationMs: z.number().int().nullable(),
  release: z.string().nullable(),
  environment: z.string().nullable(),
  browserName: z.string().nullable(),
  browserVersion: z.string().nullable(),
  os: z.string().nullable(),
  initialUrl: z.string(),
  initialRoute: z.string(),
  routes: z.array(z.string()),
  errorCount: z.number().int(),
  networkFailureCount: z.number().int(),
  eventCount: z.number().int(),
  chunkCount: z.number().int(),
  externalUserId: z.string().nullable(),
  sdkVersion: z.string().nullable(),
  viewportWidth: z.number().int().nullable(),
  viewportHeight: z.number().int().nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionFiltersSchema = z.object({
  status: SessionStatus.optional(),
  release: z.string().max(100).optional(),
  route: z.string().max(500).optional(),
  browser: z.string().max(50).optional(),
  hasErrors: z.coerce.boolean().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(25),
});
export type SessionFilters = z.infer<typeof SessionFiltersSchema>;

export const SessionListResponseSchema = z.object({
  items: z.array(SessionSummarySchema),
  nextCursor: z.string().nullable(),
  facets: z.object({
    releases: z.array(z.string()),
    routes: z.array(z.string()),
    browsers: z.array(z.string()),
  }),
});
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const IncidentKind = z.enum(['exception', 'unhandledrejection', 'network', 'console']);
export type IncidentKind = z.infer<typeof IncidentKind>;

export const IncidentSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  kind: IncidentKind,
  title: z.string(),
  message: z.string(),
  fingerprint: z.string(),
  firstSeq: z.number().int(),
  firstTs: z.string(),
  offsetMs: z.number().int(),
  route: z.string().nullable(),
  release: z.string().nullable(),
  status: z.enum(['open', 'resolved']),
  createdAt: z.string(),
});
export type Incident = z.infer<typeof IncidentSchema>;

/**
 * One row per fingerprint across every session in a project. The same bug seen in ten sessions
 * is one group with sessionCount 10. kind, title and message come from the latest incident.
 */
export const IncidentGroupSchema = z.object({
  fingerprint: z.string(),
  kind: IncidentKind,
  title: z.string(),
  message: z.string(),
  sessionCount: z.number().int(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  releases: z.array(z.string()),
  routes: z.array(z.string()),
  openCount: z.number().int(),
  latestIncidentId: z.string(),
  latestSessionId: z.string(),
});
export type IncidentGroup = z.infer<typeof IncidentGroupSchema>;

export const ExpectationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('no-errors') }),
  z.object({ kind: z.literal('visible'), testId: z.string().max(200).optional(), role: z.string().max(64).optional(), name: z.string().max(200).optional(), text: z.string().max(200).optional() }),
  z.object({ kind: z.literal('url'), pathPrefix: z.string().max(500) }),
]);
export type Expectation = z.infer<typeof ExpectationSchema>;

/**
 * A proposed success expectation. `reference-session` suggestions come from comparing the failing
 * session's DOM markers with a passing session's on the same route; `heuristic` ones need no
 * reference. The reason is shown next to the suggestion so the engineer can judge it.
 */
export const ExpectationSuggestionSchema = z.object({
  expectation: ExpectationSchema,
  source: z.enum(['reference-session', 'heuristic']),
  reason: z.string(),
});
export type ExpectationSuggestion = z.infer<typeof ExpectationSuggestionSchema>;

export const ExpectationSuggestionsResponseSchema = z.object({
  suggestions: z.array(ExpectationSuggestionSchema),
  /** The reference session the suggestions were derived from, or null for the heuristic list. */
  reference: z.string().nullable(),
  /** Present when there is nothing data-driven to say, telling the caller how to get more. */
  note: z.string().optional(),
});
export type ExpectationSuggestionsResponse = z.infer<typeof ExpectationSuggestionsResponseSchema>;

/** A passing session that can serve as the reference for expectation suggestions. */
export const ReferenceCandidateSchema = SessionSummarySchema.pick({
  id: true,
  startedAt: true,
  release: true,
  browserName: true,
  durationMs: true,
  errorCount: true,
});
export type ReferenceCandidate = z.infer<typeof ReferenceCandidateSchema>;

export const GenerateTestRequestSchema = z.object({
  incidentId: z.string().optional(),
  /** Extra expectations for the success state. `no-errors` is always included. */
  expectations: z.array(ExpectationSchema).max(5).default([]),
  testName: z.string().max(200).optional(),
});
export type GenerateTestRequest = z.infer<typeof GenerateTestRequestSchema>;

export const SelectorReportEntrySchema = z.object({
  seq: z.number().int(),
  action: z.string(),
  strategy: z.enum(['testid', 'role', 'label', 'placeholder', 'attribute', 'css', 'none']),
  selector: z.string(),
  note: z.string().optional(),
});

export const GeneratedTestSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  incidentId: z.string().nullable(),
  version: z.number().int(),
  name: z.string(),
  code: z.string(),
  language: z.literal('typescript'),
  framework: z.literal('playwright'),
  sourceHash: z.string(),
  generatorVersion: z.string(),
  selectors: z.array(SelectorReportEntrySchema),
  omitted: z.array(z.object({ seq: z.number().int(), type: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
  expectations: z.array(ExpectationSchema),
  createdAt: z.string(),
});
export type GeneratedTest = z.infer<typeof GeneratedTestSchema>;

export const RunStatus = z.enum(['queued', 'running', 'passed', 'failed', 'error', 'timeout']);
export type RunStatus = z.infer<typeof RunStatus>;

/** The demo application's two modes. Only the demo target has modes. */
export const RunTargetMode = z.enum(['broken', 'fixed']);
export type RunTargetMode = z.infer<typeof RunTargetMode>;

/** What a run row records: a demo mode, or 'none' for an external target where nothing is switched. */
export const RunMode = z.enum(['broken', 'fixed', 'none']);
export type RunMode = z.infer<typeof RunMode>;

export const ReproductionRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  generatedTestId: z.string(),
  status: RunStatus,
  /** 'demo' or the id of the project target the run was queued against. */
  target: z.string(),
  targetMode: RunMode,
  /** Null for the demo target; the external target's name and origin as they were when the run was queued. */
  targetName: z.string().nullable(),
  targetUrl: z.string().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  failureMessage: z.string().nullable(),
  logs: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  artifacts: z.array(z.object({ name: z.string(), contentType: z.string(), bytes: z.number().int() })),
});
export type ReproductionRun = z.infer<typeof ReproductionRunSchema>;

export const CreateRunRequestSchema = z.object({
  /** 'demo' (the default) or the id of one of the project's run targets. */
  targetId: z.string().min(1).max(64).default('demo'),
  /** Only meaningful for the demo target, where it defaults to 'broken'. Ignored for external targets. */
  mode: RunTargetMode.optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const DiagnosticFindingSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  incidentId: z.string().nullable(),
  kind: z.enum(['evidence', 'investigation']),
  provider: z.string(),
  model: z.string().nullable(),
  evidence: EvidenceSummarySchema.nullable(),
  investigation: InvestigationSchema.nullable(),
  createdAt: z.string(),
});
export type DiagnosticFinding = z.infer<typeof DiagnosticFindingSchema>;

export const HealthSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number(),
  checks: z.record(z.string(), z.enum(['ok', 'fail'])).optional(),
});
export type Health = z.infer<typeof HealthSchema>;

export const JobKind = z.enum(['process_session', 'run_reproduction']);
export type JobKind = z.infer<typeof JobKind>;
