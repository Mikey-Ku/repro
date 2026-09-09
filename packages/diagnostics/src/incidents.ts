import { createHash } from 'node:crypto';
import type { ConsoleEvent, ErrorEvent, NetworkEvent, RecordedEvent } from '@repro/contracts';
import { routeFromPath, truncate } from '@repro/contracts';
import { firstLine, offsetFrom, routeAt, sortBySeq, type SessionContext } from './shared.js';

export interface IncidentCandidate {
  kind: 'exception' | 'unhandledrejection' | 'network' | 'console';
  title: string;
  message: string;
  /** Stable hash used to group the same failure across sessions. */
  fingerprint: string;
  firstSeq: number;
  firstTs: number;
  offsetMs: number;
  route: string | null;
}

const TITLE_MAX = 120;

function sha1(parts: string[]): string {
  return createHash('sha1').update(parts.join('\n'), 'utf8').digest('hex');
}

/**
 * Make a message comparable across occurrences: keep only its first line, then replace quoted
 * strings and digit runs, which usually carry ids, counts or user data rather than the failure type.
 */
export function normalizeMessage(message: string): string {
  return firstLine(message)
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '$1?$1')
    .replace(/\d+/g, '#')
    .trim();
}

/**
 * File path of the top stack frame, without line and column numbers.
 * Handles V8 (`at fn (url:line:col)`) and Firefox/Safari (`fn@url:line:col`) frame shapes.
 */
export function topFrameFile(stack: string | undefined): string {
  if (!stack) return '';
  for (const raw of stack.split(/\r?\n/)) {
    const line = raw.trim();
    const v8 = /^at\s+(?:.*?\s+\()?(.+?)(?::\d+)?(?::\d+)?\)?$/.exec(line);
    const gecko = /^(?:.*?@)(.+?)(?::\d+)?(?::\d+)?$/.exec(line);
    const location = (line.startsWith('at ') ? v8?.[1] : gecko?.[1]) ?? '';
    if (!location || location === '<anonymous>') continue;
    try {
      return new URL(location).pathname;
    } catch {
      return location;
    }
  }
  return '';
}

function fromError(event: ErrorEvent, events: readonly RecordedEvent[], startedAt: number): IncidentCandidate {
  const kind = event.data.kind === 'unhandledrejection' ? 'unhandledrejection' : 'exception';
  const name = event.data.name ?? (kind === 'unhandledrejection' ? 'UnhandledRejection' : 'Error');
  return {
    kind,
    title: `${name}: ${truncate(firstLine(event.data.message), TITLE_MAX)}`,
    message: event.data.message,
    fingerprint: sha1([kind, name, normalizeMessage(event.data.message), topFrameFile(event.data.stack)]),
    firstSeq: event.seq,
    firstTs: event.ts,
    offsetMs: offsetFrom(startedAt, event.ts),
    route: routeAt(events, event.seq),
  };
}

function isServerOrNetworkFailure(event: NetworkEvent): boolean {
  const { status, ok, error } = event.data;
  if (status !== null && status >= 500) return true;
  // No status at all means the request never completed (CORS, offline, abort).
  return status === null && (!ok || Boolean(error));
}

function fromNetwork(event: NetworkEvent, events: readonly RecordedEvent[], startedAt: number): IncidentCandidate {
  const template = routeFromPath(event.data.path);
  const outcome = event.data.status ?? event.data.error ?? 'network error';
  return {
    kind: 'network',
    title: `${event.data.method} ${template} failed (${outcome})`,
    message: `${event.data.method} ${event.data.path} responded with ${outcome} after ${Math.round(event.data.durationMs)} ms`,
    fingerprint: sha1(['network', event.data.method, template, String(event.data.status ?? 'error')]),
    firstSeq: event.seq,
    firstTs: event.ts,
    offsetMs: offsetFrom(startedAt, event.ts),
    route: routeAt(events, event.seq),
  };
}

function fromConsole(event: ConsoleEvent, events: readonly RecordedEvent[], startedAt: number): IncidentCandidate {
  const first = event.data.args[0] ?? '';
  return {
    kind: 'console',
    title: `console.error: ${truncate(firstLine(first) || '(empty)', TITLE_MAX)}`,
    message: event.data.args.join(' '),
    fingerprint: sha1(['console', normalizeMessage(first)]),
    firstSeq: event.seq,
    firstTs: event.ts,
    offsetMs: offsetFrom(startedAt, event.ts),
    route: routeAt(events, event.seq),
  };
}

/**
 * One incident candidate per distinct fingerprint, in seq order.
 * Console errors only count when the session has no uncaught error, because browsers log
 * uncaught errors to the console as well and the two would duplicate each other.
 */
export function extractIncidents(events: RecordedEvent[], ctx: SessionContext): IncidentCandidate[] {
  const sorted = sortBySeq(events);
  const candidates: IncidentCandidate[] = [];

  for (const event of sorted) {
    if (event.type === 'error' && !event.data.handled) candidates.push(fromError(event, sorted, ctx.startedAt));
    if (event.type === 'network' && isServerOrNetworkFailure(event)) candidates.push(fromNetwork(event, sorted, ctx.startedAt));
  }

  const hasUncaught = candidates.some((c) => c.kind === 'exception' || c.kind === 'unhandledrejection');
  if (!hasUncaught) {
    for (const event of sorted) {
      if (event.type === 'console' && event.data.level === 'error') candidates.push(fromConsole(event, sorted, ctx.startedAt));
    }
  }

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => a.firstSeq - b.firstSeq)
    .filter((c) => {
      if (seen.has(c.fingerprint)) return false;
      seen.add(c.fingerprint);
      return true;
    });
}
