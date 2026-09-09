import type { ErrorEvent, EvidenceRef, NavigationEvent, NetworkEvent, RecordedEvent } from '@repro/contracts';
import { routeFromPath, sanitizePath } from '@repro/contracts';

/** What the diagnostics functions need to know about the session beyond its events. */
export interface SessionContext {
  /** Session start in epoch milliseconds. Offsets in every ref are relative to this. */
  startedAt: number;
  release?: string | null;
  browser?: string | null;
  /** When 'recording', the summary states that later events may be missing. */
  status?: 'recording' | 'completed' | 'expired' | null;
}

/** Stable seq order. Ties (which should not happen) fall back to timestamp. */
export function sortBySeq<T extends { seq: number; ts: number }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.seq - b.seq || a.ts - b.ts);
}

export function offsetFrom(startedAt: number, ts: number): number {
  return Math.max(0, ts - startedAt);
}

/** Build a replay pointer for an event. Every fact in a summary carries one of these. */
export function makeRef(event: { seq: number; ts: number }, startedAt: number, label: string): EvidenceRef {
  return { seq: event.seq, ts: event.ts, offsetMs: offsetFrom(startedAt, event.ts), label };
}

export function firstLine(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? '').trim();
}

/** The route template of a navigation event: sanitised path with ids replaced by `:id`. */
export function routeOf(event: NavigationEvent): string {
  return routeFromPath(sanitizePath(event.data.url));
}

/** Route template active at `seq`: the most recent navigation at or before it. */
export function routeAt(events: readonly RecordedEvent[], seq: number): string | null {
  let route: string | null = null;
  for (const event of events) {
    if (event.seq > seq) break;
    if (event.type === 'navigation') route = routeOf(event);
  }
  return route;
}

/**
 * The error a summary is about: the first uncaught error, or the first error of any kind
 * when nothing uncaught was recorded (a `captureException` call still deserves attention).
 */
export function findEarliestError(sorted: readonly RecordedEvent[]): ErrorEvent | undefined {
  const errors = sorted.filter((e): e is ErrorEvent => e.type === 'error');
  return errors.find((e) => !e.data.handled) ?? errors[0];
}

export function isFailedRequest(event: NetworkEvent): boolean {
  return !event.data.ok || (event.data.status !== null && event.data.status >= 400);
}

export const SLOW_REQUEST_MS = 2000;
export const REQUEST_WINDOW_BEFORE_ERROR_MS = 5000;

export function errorLabel(event: ErrorEvent): string {
  return `${event.data.name ?? 'Error'}: ${firstLine(event.data.message)}`;
}

export function requestLabel(event: NetworkEvent): string {
  return `${event.data.method} ${event.data.path} (${event.data.status ?? event.data.error ?? 'no response'})`;
}
