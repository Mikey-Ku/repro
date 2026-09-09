import { z } from 'zod';

/** A pointer into the replay: clicking it seeks the player. */
export const EvidenceRefSchema = z.object({
  seq: z.number().int(),
  ts: z.number().int(),
  offsetMs: z.number().int(),
  label: z.string(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/**
 * Deterministic evidence summary produced by @repro/diagnostics.
 * Every field is derived from captured events and carries a reference to them.
 */
export const EvidenceSummarySchema = z.object({
  version: z.literal(1),
  route: z.string().nullable(),
  release: z.string().nullable(),
  browser: z.string().nullable(),
  earliestError: z
    .object({
      ref: EvidenceRefSchema,
      name: z.string().optional(),
      message: z.string(),
      stack: z.string().optional(),
      kind: z.string(),
    })
    .nullable(),
  failedRequests: z.array(
    z.object({
      ref: EvidenceRefSchema,
      method: z.string(),
      path: z.string(),
      status: z.number().nullable(),
      durationMs: z.number(),
      error: z.string().optional(),
    }),
  ),
  slowRequests: z.array(
    z.object({
      ref: EvidenceRefSchema,
      method: z.string(),
      path: z.string(),
      status: z.number().nullable(),
      durationMs: z.number(),
    }),
  ),
  lastActions: z.array(
    z.object({
      ref: EvidenceRefSchema,
      description: z.string(),
    }),
  ),
  consoleErrors: z.array(
    z.object({
      ref: EvidenceRefSchema,
      level: z.string(),
      message: z.string(),
    }),
  ),
  /** Requests that completed right before the earliest error. */
  requestsBeforeError: z.array(
    z.object({
      ref: EvidenceRefSchema,
      method: z.string(),
      path: z.string(),
      status: z.number().nullable(),
      ok: z.boolean(),
    }),
  ),
  /** What the summary could not establish, in plain language. */
  gaps: z.array(z.string()),
  stats: z.object({
    events: z.number().int(),
    errors: z.number().int(),
    requests: z.number().int(),
    actions: z.number().int(),
    durationMs: z.number().int(),
  }),
});
export type EvidenceSummary = z.infer<typeof EvidenceSummarySchema>;

/** Output of an investigator (fake or AI). Evidence and inference are separate by design. */
export const InvestigationSchema = z.object({
  provider: z.string(),
  model: z.string(),
  /** Null when the investigator abstained. */
  hypothesis: z.string().nullable(),
  confidence: z.enum(['none', 'low', 'medium', 'high']),
  abstained: z.boolean(),
  abstainReason: z.string().optional(),
  /** Facts, each pointing at a captured event. */
  evidence: z.array(
    z.object({
      claim: z.string(),
      ref: EvidenceRefSchema,
    }),
  ),
  /** Reasoning steps that go beyond the evidence. Marked as inference in the UI. */
  inferences: z.array(z.string()),
  suggestedChecks: z.array(z.string()),
});
export type Investigation = z.infer<typeof InvestigationSchema>;
