import type { EvidenceSummary, TimelineEntry } from '@repro/contracts';
import { scrubText } from '@repro/contracts';
import type { InvestigatorInput } from './types.js';

const DETAIL_MAX = 300;

/** A timeline row with the raw event payload removed. This is all a model ever sees of the timeline. */
export type RedactedTimelineEntry = Omit<TimelineEntry, 'event'>;

/** Exactly what is sent to a model. Structurally a subset of InvestigatorInput. */
export interface ModelInput {
  summary: EvidenceSummary;
  timeline: RedactedTimelineEntry[];
}

/** Walk any JSON-like value and scrub every string in it. Arrays and objects keep their shape. */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrubText(value) as T;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = scrubDeep(item);
    return out as T;
  }
  return value;
}

/**
 * Reduce an investigator input to the model-facing shape:
 * rrweb never reaches the timeline, raw event payloads are dropped, details are truncated,
 * and every remaining string goes through the shared secret scrubber.
 */
export function redactForModel(input: InvestigatorInput): ModelInput {
  const timeline: RedactedTimelineEntry[] = input.timeline.map((entry) => {
    const { seq, ts, offsetMs, kind, severity, title, detail } = entry;
    const row: RedactedTimelineEntry = { seq, ts, offsetMs, kind, severity, title };
    if (detail !== undefined) row.detail = detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX)}…` : detail;
    return row;
  });
  return scrubDeep({ summary: input.summary, timeline });
}
