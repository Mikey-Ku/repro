import type {
  ElementDescriptor,
  ErrorEvent,
  InputEvent,
  NavigationEvent,
  NetworkEvent,
  RecordedEvent,
} from './events.js';
import { sanitizePath } from './sanitize.js';

/**
 * Normalised user actions. This is the input to the deterministic test generator and
 * the "last meaningful user actions" section of the diagnostics summary.
 */
export type NormalizedAction =
  | { kind: 'navigate'; seq: number; ts: number; url: string; path: string }
  | { kind: 'expect-url'; seq: number; ts: number; url: string; path: string }
  | { kind: 'click'; seq: number; ts: number; target: ElementDescriptor }
  | {
      kind: 'fill';
      seq: number;
      ts: number;
      target: ElementDescriptor;
      value: string | null;
      masked: boolean;
    }
  | { kind: 'select'; seq: number; ts: number; target: ElementDescriptor; value: string | null }
  | { kind: 'check'; seq: number; ts: number; target: ElementDescriptor; checked: boolean }
  | { kind: 'press-enter'; seq: number; ts: number; target: ElementDescriptor }
  | { kind: 'submit'; seq: number; ts: number; target: ElementDescriptor };

export interface OmittedEvent {
  seq: number;
  type: RecordedEvent['type'];
  reason: string;
}

export interface NormalizedSession {
  actions: NormalizedAction[];
  omitted: OmittedEvent[];
  /** The first uncaught error, if any, in seq order. */
  firstError?: ErrorEvent;
  /** Network requests that happened after the last user action and before the first error. */
  trailingRequests: NetworkEvent[];
}

const sameTarget = (a: ElementDescriptor, b: ElementDescriptor): boolean => {
  if (a.testId && b.testId) return a.testId === b.testId;
  if (a.id && b.id) return a.id === b.id;
  if (a.name && b.name && a.tag === b.tag) return a.name === b.name && a.formId === b.formId;
  if (a.cssPath && b.cssPath) return a.cssPath === b.cssPath;
  return false;
};

const isFormControl = (target: ElementDescriptor): boolean =>
  ['input', 'textarea', 'select'].includes(target.tag) || target.role === 'textbox' || target.role === 'combobox';

const isSubmitControl = (target: ElementDescriptor): boolean =>
  (target.tag === 'button' && (target.type ?? 'submit') === 'submit') ||
  (target.tag === 'input' && (target.type === 'submit' || target.type === 'image'));

function actionFromInput(event: InputEvent): NormalizedAction {
  const { target, kind, value, masked, checked } = event.data;
  const { seq, ts } = event;
  if (kind === 'checkbox' || kind === 'radio') {
    return { kind: 'check', seq, ts, target, checked: checked ?? true };
  }
  if (kind === 'select') {
    return { kind: 'select', seq, ts, target, value };
  }
  return { kind: 'fill', seq, ts, target, value: masked ? null : value, masked };
}

/**
 * Turn raw recorded events into a compact list of actions.
 *
 * Rules (each one is deterministic and documented in docs/TEST_GENERATION.md):
 * 1. The first navigation becomes `navigate`; later navigations become `expect-url`.
 * 2. Consecutive inputs on the same control collapse to the last value.
 * 3. A click on a form control that is then filled is dropped (filling implies focus).
 * 4. A click on a submit control followed by a submit event keeps the click and drops the submit.
 * 5. A submit with no preceding submit click becomes `press-enter` on the last filled control.
 * 6. rrweb, console, network, error, annotation and identify events are not actions.
 */
export function normalizeEvents(events: readonly RecordedEvent[]): NormalizedSession {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const actions: NormalizedAction[] = [];
  const omitted: OmittedEvent[] = [];
  let sawNavigation = false;
  let firstError: ErrorEvent | undefined;

  for (const event of sorted) {
    switch (event.type) {
      case 'navigation': {
        const nav = event as NavigationEvent;
        const path = sanitizePath(nav.data.url);
        if (!sawNavigation) {
          sawNavigation = true;
          actions.push({ kind: 'navigate', seq: nav.seq, ts: nav.ts, url: nav.data.url, path });
        } else {
          const last = actions[actions.length - 1];
          if (last && last.kind === 'expect-url' && last.path === path) {
            omitted.push({ seq: nav.seq, type: 'navigation', reason: 'Duplicate navigation to the same path.' });
          } else if (last && last.kind === 'navigate' && last.path === path) {
            omitted.push({ seq: nav.seq, type: 'navigation', reason: 'Reload of the current path.' });
          } else {
            actions.push({ kind: 'expect-url', seq: nav.seq, ts: nav.ts, url: nav.data.url, path });
          }
        }
        break;
      }
      case 'click': {
        const target = event.data.target;
        if (target.tag === 'label' || target.tag === 'option') {
          omitted.push({ seq: event.seq, type: 'click', reason: `Click on <${target.tag}> is implied by the input that follows.` });
          break;
        }
        actions.push({ kind: 'click', seq: event.seq, ts: event.ts, target });
        break;
      }
      case 'input': {
        const action = actionFromInput(event);
        const last = actions[actions.length - 1];
        if (last && last.kind === 'click' && isFormControl(last.target) && sameTarget(last.target, event.data.target)) {
          omitted.push({ seq: last.seq, type: 'click', reason: 'Click on a form control is implied by filling it.' });
          actions.pop();
        }
        const prev = actions[actions.length - 1];
        if (
          prev &&
          (prev.kind === 'fill' || prev.kind === 'select' || prev.kind === 'check') &&
          prev.kind === action.kind &&
          sameTarget(prev.target, event.data.target)
        ) {
          omitted.push({ seq: prev.seq, type: 'input', reason: 'Superseded by a later value on the same control.' });
          actions.pop();
        }
        actions.push(action);
        break;
      }
      case 'submit': {
        const last = actions[actions.length - 1];
        if (last && last.kind === 'click' && isSubmitControl(last.target)) {
          omitted.push({ seq: event.seq, type: 'submit', reason: 'Form submission is triggered by the preceding button click.' });
          break;
        }
        const lastFill = [...actions].reverse().find((a) => a.kind === 'fill' || a.kind === 'select');
        if (lastFill && 'target' in lastFill) {
          actions.push({ kind: 'press-enter', seq: event.seq, ts: event.ts, target: lastFill.target });
        } else {
          actions.push({ kind: 'submit', seq: event.seq, ts: event.ts, target: event.data.target });
        }
        break;
      }
      case 'error': {
        if (!firstError && !event.data.handled) firstError = event;
        break;
      }
      case 'rrweb':
      case 'console':
      case 'network':
      case 'annotation':
      case 'identify':
        break;
    }
  }

  const lastActionSeq = actions.length ? actions[actions.length - 1]!.seq : -1;
  const trailingRequests = sorted.filter(
    (e): e is NetworkEvent =>
      e.type === 'network' && e.seq > lastActionSeq && (!firstError || e.seq < firstError.seq + 50),
  );

  return { actions, omitted, firstError, trailingRequests };
}

/** A row in the unified dashboard timeline. */
export interface TimelineEntry {
  seq: number;
  ts: number;
  /** Milliseconds since the session started. */
  offsetMs: number;
  kind: 'click' | 'input' | 'submit' | 'navigation' | 'error' | 'console' | 'network' | 'annotation' | 'identify';
  severity: 'info' | 'warn' | 'error';
  title: string;
  detail?: string;
  event: Exclude<RecordedEvent, { type: 'rrweb' }>;
}

export function describeTarget(target: ElementDescriptor): string {
  const name = target.accessibleName ?? target.label ?? target.text ?? target.placeholder ?? target.name ?? target.id;
  const tagLabel = target.role ?? target.tag;
  return name ? `${tagLabel} "${name}"` : `<${target.tag}>`;
}

export function buildTimeline(events: readonly RecordedEvent[], startedAt: number): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type === 'rrweb') continue;
    const offsetMs = Math.max(0, event.ts - startedAt);
    const common = { seq: event.seq, ts: event.ts, offsetMs, event } as const;
    switch (event.type) {
      case 'click':
        entries.push({ ...common, kind: 'click', severity: 'info', title: `Clicked ${describeTarget(event.data.target)}` });
        break;
      case 'input': {
        const value = event.data.masked ? '[masked]' : event.data.kind === 'checkbox' || event.data.kind === 'radio' ? (event.data.checked ? 'checked' : 'unchecked') : (event.data.value ?? '');
        entries.push({ ...common, kind: 'input', severity: 'info', title: `Changed ${describeTarget(event.data.target)}`, detail: value });
        break;
      }
      case 'submit':
        entries.push({ ...common, kind: 'submit', severity: 'info', title: `Submitted ${describeTarget(event.data.target)}` });
        break;
      case 'navigation':
        entries.push({ ...common, kind: 'navigation', severity: 'info', title: `Navigated (${event.data.kind})`, detail: sanitizePath(event.data.url) });
        break;
      case 'error':
        entries.push({
          ...common,
          kind: 'error',
          severity: event.data.handled ? 'warn' : 'error',
          title: `${event.data.name ?? 'Error'}: ${event.data.message}`,
          detail: event.data.stack,
        });
        break;
      case 'console':
        entries.push({ ...common, kind: 'console', severity: event.data.level === 'error' ? 'error' : 'warn', title: `console.${event.data.level}`, detail: event.data.args.join(' ') });
        break;
      case 'network': {
        const failed = !event.data.ok;
        const slow = event.data.durationMs > 2000;
        entries.push({
          ...common,
          kind: 'network',
          severity: failed ? 'error' : slow ? 'warn' : 'info',
          title: `${event.data.method} ${event.data.path} → ${event.data.status ?? (event.data.error ? 'failed' : 'pending')}`,
          detail: `${Math.round(event.data.durationMs)} ms${event.data.error ? ` · ${event.data.error}` : ''}`,
        });
        break;
      }
      case 'annotation':
        entries.push({ ...common, kind: 'annotation', severity: 'info', title: `Annotation: ${event.data.name}`, detail: event.data.data ? JSON.stringify(event.data.data) : undefined });
        break;
      case 'identify':
        entries.push({ ...common, kind: 'identify', severity: 'info', title: 'Identified user', detail: event.data.userId });
        break;
    }
  }
  return entries;
}
