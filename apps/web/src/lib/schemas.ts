import { z } from 'zod';
import {
  DiagnosticFindingSchema,
  EvidenceSummarySchema,
  GeneratedTestSchema,
  IncidentGroupSchema,
  IncidentSchema,
  ProjectSchema,
  ProjectStatsSchema,
  RecordedEventSchema,
  SessionMetaSchema,
  SessionSummarySchema,
} from '@repro/contracts';

/**
 * Response envelopes that docs/API.md describes but @repro/contracts does not
 * export as Zod schemas. Everything the dashboard renders is parsed through one
 * of these (or a contracts schema) before it reaches a component.
 */

export const ProjectWithStatsSchema = ProjectSchema.extend({ stats: ProjectStatsSchema });
export type ProjectWithStats = z.infer<typeof ProjectWithStatsSchema>;

export const SessionDetailSchema = z.object({
  session: SessionSummarySchema,
  incidents: z.array(IncidentSchema),
  tests: z.array(GeneratedTestSchema),
  findings: z.array(DiagnosticFindingSchema),
});
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

export const SessionEventsSchema = z.object({
  events: z.array(RecordedEventSchema),
  meta: SessionMetaSchema,
});
export type SessionEvents = z.infer<typeof SessionEventsSchema>;

/** Mirror of the TimelineEntry interface in @repro/contracts (which has no Zod schema). */
export const TimelineEntrySchema = z.object({
  seq: z.number().int(),
  ts: z.number(),
  offsetMs: z.number(),
  kind: z.enum(['click', 'input', 'submit', 'navigation', 'error', 'console', 'network', 'annotation', 'identify']),
  severity: z.enum(['info', 'warn', 'error']),
  title: z.string(),
  detail: z.string().optional(),
  event: RecordedEventSchema,
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TimelineResponseSchema = z.object({
  entries: z.array(TimelineEntrySchema),
  evidence: EvidenceSummarySchema,
});
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

export const IncidentListSchema = z.object({ items: z.array(IncidentSchema) });
export const IncidentGroupListSchema = z.object({ items: z.array(IncidentGroupSchema) });

export const IncidentDetailSchema = z.object({
  incident: IncidentSchema,
  session: SessionSummarySchema,
  tests: z.array(GeneratedTestSchema),
});
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

export const OkSchema = z.object({ ok: z.literal(true) });
