import type { ConsoleEvent, EvidenceSummary, NetworkEvent, NormalizedAction, RecordedEvent } from '@repro/contracts';
import { buildTimeline, describeTarget, normalizeEvents } from '@repro/contracts';
import {
  REQUEST_WINDOW_BEFORE_ERROR_MS,
  SLOW_REQUEST_MS,
  errorLabel,
  findEarliestError,
  isFailedRequest,
  makeRef,
  offsetFrom,
  requestLabel,
  routeOf,
  sortBySeq,
  type SessionContext,
} from './shared.js';

const MAX_LIST = 20;
const MAX_LAST_ACTIONS = 8;

/** Plain-language description of a normalised action, for the "what happened before" list. */
export function describeAction(action: NormalizedAction): string {
  switch (action.kind) {
    case 'navigate':
    case 'expect-url':
      return `Navigated to ${action.path}`;
    case 'click':
      return `Clicked ${describeTarget(action.target)}`;
    case 'fill':
      return `Filled ${describeTarget(action.target)} (${action.masked ? '[masked]' : JSON.stringify(action.value ?? '')})`;
    case 'select':
      return `Selected ${JSON.stringify(action.value ?? '')} in ${describeTarget(action.target)}`;
    case 'check':
      return `${action.checked ? 'Checked' : 'Unchecked'} ${describeTarget(action.target)}`;
    case 'press-enter':
      return `Pressed Enter in ${describeTarget(action.target)}`;
    case 'submit':
      return `Submitted ${describeTarget(action.target)}`;
  }
}

/**
 * Build the deterministic evidence summary for a session.
 * Everything here is derived from the events and `ctx`; the same input always yields the same output.
 */
export function summarizeEvidence(events: RecordedEvent[], ctx: SessionContext): EvidenceSummary {
  const sorted = sortBySeq(events);
  const { startedAt } = ctx;
  // The timeline is the dashboard's view of the session. Ref labels reuse its titles so that a
  // ref in the evidence panel reads the same as the row it jumps to.
  const titles = new Map(buildTimeline(sorted, startedAt).map((entry) => [entry.seq, entry.title]));
  const label = (event: { seq: number }, fallback: string): string => titles.get(event.seq) ?? fallback;
  const normalized = normalizeEvents(sorted);

  const firstNavigation = sorted.find((e) => e.type === 'navigation');
  const route = firstNavigation ? routeOf(firstNavigation) : null;

  const error = findEarliestError(sorted);
  const earliestError: EvidenceSummary['earliestError'] = error
    ? {
        ref: makeRef(error, startedAt, label(error, errorLabel(error))),
        name: error.data.name,
        message: error.data.message,
        stack: error.data.stack,
        kind: error.data.kind,
      }
    : null;

  const requests = sorted.filter((e): e is NetworkEvent => e.type === 'network');
  const failed = requests.filter(isFailedRequest);
  const failedRequests = failed.slice(0, MAX_LIST).map((e) => ({
    ref: makeRef(e, startedAt, label(e, requestLabel(e))),
    method: e.data.method,
    path: e.data.path,
    status: e.data.status,
    durationMs: e.data.durationMs,
    error: e.data.error,
  }));
  const slowRequests = requests
    .filter((e) => e.data.durationMs > SLOW_REQUEST_MS && !isFailedRequest(e))
    .slice(0, MAX_LIST)
    .map((e) => ({
      ref: makeRef(e, startedAt, label(e, requestLabel(e))),
      method: e.data.method,
      path: e.data.path,
      status: e.data.status,
      durationMs: e.data.durationMs,
    }));

  // Actions are cut at the earliest error: what came after it cannot have caused it.
  const actionsBefore = error ? normalized.actions.filter((a) => a.seq < error.seq) : normalized.actions;
  const lastActions = actionsBefore.slice(-MAX_LAST_ACTIONS).map((action) => {
    const description = describeAction(action);
    return { ref: makeRef(action, startedAt, description), description };
  });

  const consoleEvents = sorted.filter((e): e is ConsoleEvent => e.type === 'console');
  const consoleErrors = [...consoleEvents.filter((e) => e.data.level === 'error'), ...consoleEvents.filter((e) => e.data.level !== 'error')]
    .slice(0, MAX_LIST)
    .map((e) => {
      const message = e.data.args.join(' ');
      return { ref: makeRef(e, startedAt, label(e, `console.${e.data.level}`)), level: e.data.level, message };
    });

  const requestsBeforeError = error
    ? requests
        .filter((e) => e.ts <= error.ts && e.ts >= error.ts - REQUEST_WINDOW_BEFORE_ERROR_MS)
        .map((e) => ({
          ref: makeRef(e, startedAt, label(e, requestLabel(e))),
          method: e.data.method,
          path: e.data.path,
          status: e.data.status,
          ok: e.data.ok,
        }))
    : [];

  const gaps: string[] = [];
  if (sorted.length === 0) gaps.push('No events were recorded for this session.');
  if (!firstNavigation && sorted.length > 0) gaps.push('No navigation was recorded, so the route is unknown.');
  if (!error || error.data.handled) gaps.push('No uncaught error was recorded; the failure may be visual only.');
  if (error && requestsBeforeError.length === 0) gaps.push('No network request completed within 5 s before the error.');
  if (error && lastActions.length === 0) gaps.push('No user actions were recorded before the error.');
  if (error && !error.data.stack) gaps.push('The recorded stack trace is missing, so the failing source location is unknown.');
  if (ctx.status === 'recording') gaps.push('The session was still recording when captured; later events may be missing.');

  const lastTs = sorted.length ? Math.max(...sorted.map((e) => e.ts)) : startedAt;

  return {
    version: 1,
    route,
    release: ctx.release ?? null,
    browser: ctx.browser ?? null,
    earliestError,
    failedRequests,
    slowRequests,
    lastActions,
    consoleErrors,
    requestsBeforeError,
    gaps,
    stats: {
      events: sorted.length,
      errors: sorted.filter((e) => e.type === 'error').length,
      requests: requests.length,
      actions: normalized.actions.length,
      durationMs: offsetFrom(startedAt, lastTs),
    },
  };
}
