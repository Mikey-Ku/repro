import { z } from 'zod';
import { LIMITS } from './limits.js';
import { EvidenceSummarySchema, InvestigationSchema } from './evidence.js';

export const SessionStatus = z.enum(['recording', 'completed', 'expired']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const ProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  retentionDays: z.number().int(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectStatsSchema = z.object({
  sessions: z.number().int(),
  sessionsWithErrors: z.number().int(),
  openIncidents: z.number().int(),
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

export const ExpectationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: 'no-errors' }),
  z.object({ kind: 'visible', testId: z.string().max(200).optional(), role: z.string().max(64).optional(), name: z.string().max(200).optional(), text: z.string().max(200).optional() }),
  z.object({ kind: 'url', pathPrefix: z.string().max(500) }),
]);
export type Expectation = z.infer<typeof ExpectationSchema>;

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

export const RunTargetMode = z.enum(['broken', 'fixed']);
export type RunTargetMode = z.infer<typeof RunTargetMode>;

export const ReproductionRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  generatedTestId: z.string(),
  status: RunStatus,
  target: z.string(),
  targetMode: RunTargetMode,
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
  mode: RunTargetMode.default('broken'),
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
