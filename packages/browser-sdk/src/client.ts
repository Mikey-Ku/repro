/**
 * Session lifecycle and batching. One client owns one session: it stamps seq numbers, buffers
 * events, packs them into IngestBatch uploads, and starts or stops the capture modules.
 */
import { LIMITS, SCHEMA_VERSION, sanitizeUrl, truncate } from '@repro/contracts/runtime';
import type { IngestBatch, RecordedEvent, SessionMeta } from '@repro/contracts';
import { startConsole } from './capture/console.js';
import { errorFields } from './capture/errors.js';
import { startErrors } from './capture/errors.js';
import { startInteractions } from './capture/interactions.js';
import { startNavigation } from './capture/navigation.js';
import { startNetwork } from './capture/network.js';
import { startRrweb } from './capture/rrweb.js';
import { buildMeta } from './meta.js';
import { isEmailShaped, sanitizeRecord, type RedactionOptions } from './redact.js';
import { clearSession, loadSession, saveSession, type PersistedSession } from './storage.js';
import { createTransport, type Transport, type TransportOptions } from './transport.js';
import type { CaptureContext, DebugLog, EventBody, ReproClient, ReproOptions, Stop } from './types.js';
import { version as sdkVersion } from './version.js';

export const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
export const DEFAULT_MAX_BATCH_EVENTS = 200;

/** Test hooks. Production code never passes these. */
export interface ClientDeps {
  transport?: Partial<TransportOptions>;
  random?: () => number;
  /** Skip rrweb (tests that only care about the other modules). */
  rrweb?: boolean;
}

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 layout from Math.random, for very old browsers.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function byteLength(text: string): number {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
}

/**
 * Split events into groups whose serialised batch stays under LIMITS.maxBatchBytes and
 * LIMITS.maxEventsPerBatch. Oversize groups are halved by event count until they fit; a single
 * event that is still too large is dropped, since the server would reject it anyway.
 */
export function splitEvents(
  events: RecordedEvent[],
  measure: (events: RecordedEvent[]) => number,
  maxBytes: number = LIMITS.maxBatchBytes,
  maxEvents: number = LIMITS.maxEventsPerBatch,
  onDrop: (event: RecordedEvent) => void = () => {},
): RecordedEvent[][] {
  const out: RecordedEvent[][] = [];
  const visit = (group: RecordedEvent[]) => {
    if (group.length === 0) return;
    if (group.length <= maxEvents && measure(group) <= maxBytes) {
      out.push(group);
      return;
    }
    if (group.length === 1) {
      onDrop(group[0]!);
      return;
    }
    const middle = Math.ceil(group.length / 2);
    visit(group.slice(0, middle));
    visit(group.slice(middle));
  };
  visit(events);
  return out;
}

export function createClient(options: ReproOptions, deps: ClientDeps = {}): ReproClient {
  const debug: DebugLog = options.debug ? (...args) => console.debug('[repro]', ...args) : () => {};
  const random = deps.random ?? Math.random;
  const flushIntervalMs = Math.max(250, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
  const maxBatchEvents = Math.max(1, Math.min(LIMITS.maxEventsPerBatch, options.maxBatchEvents ?? DEFAULT_MAX_BATCH_EVENTS));
  const sampleRate = Math.min(1, Math.max(0, options.sampleRate ?? 1));
  const redaction: RedactionOptions = {
    strict: options.strict === true,
    maskSelector: options.maskSelector,
    blockSelector: options.blockSelector,
    ignoreSelector: options.ignoreSelector,
  };

  const transport: Transport = createTransport({
    endpoint: options.endpoint,
    projectKey: options.projectKey,
    debug,
    ...deps.transport,
  });

  let session: PersistedSession | null = null;
  let recording = false;
  let ended = false;
  let metaPending = false;
  let buffer: RecordedEvent[] = [];
  let stops: Stop[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const currentPageUrl = () => truncate(sanitizeUrl(location.href), LIMITS.maxUrlLength);

  /** Resume the tab's session if there is one, otherwise create it. */
  function openSession(): PersistedSession {
    const stored = ended ? null : loadSession();
    if (stored && (!options.sessionId || stored.id === options.sessionId)) return stored;
    const created: PersistedSession = {
      id: options.sessionId ?? newSessionId(),
      startedAt: Date.now(),
      seq: 0,
      batchSeq: 0,
      sampled: random() < sampleRate,
      url: '',
    };
    saveSession(created);
    return created;
  }

  function push(event: EventBody): void {
    if (!recording || !session) return;
    const stamped = { ...event, seq: session.seq, ts: Date.now() } as RecordedEvent;
    session.seq += 1;
    buffer.push(stamped);
    if (buffer.length >= maxBatchEvents) void flush(false);
  }

  const ctx: CaptureContext = { emit: push, redaction, endpoint: options.endpoint, debug };

  function buildBatches(events: RecordedEvent[], final: boolean): IngestBatch[] {
    if (!session) return [];
    const active = session;
    const meta: SessionMeta | undefined = metaPending
      ? buildMeta({ sdkVersion, startedAt: active.startedAt, release: options.release, environment: options.environment })
      : undefined;
    const skeleton = (batchEvents: RecordedEvent[]): IngestBatch => ({
      v: SCHEMA_VERSION,
      sessionId: active.id,
      batchSeq: 0,
      sentAt: Date.now(),
      events: batchEvents,
    });
    const measure = (group: RecordedEvent[]) => byteLength(JSON.stringify({ ...skeleton(group), meta }));
    const groups = splitEvents(events, measure, LIMITS.maxBatchBytes, LIMITS.maxEventsPerBatch, (dropped) =>
      debug(`dropped oversize ${dropped.type} event seq ${dropped.seq}`),
    );
    // An empty session still needs its first (meta) batch and its final batch.
    if (groups.length === 0 && (meta || final)) groups.push([]);
    const batches = groups.map((group) => ({ ...skeleton(group), batchSeq: active.batchSeq++ }));
    if (batches.length > 0) {
      const first = batches[0]!;
      if (meta) {
        first.meta = meta;
        metaPending = false;
        active.url = currentPageUrl();
      }
      if (final) batches[batches.length - 1]!.final = true;
      saveSession(active);
    }
    return batches;
  }

  function flush(final: boolean): Promise<void> {
    if (!session) return transport.flush();
    const batches = buildBatches(buffer, final);
    buffer = [];
    for (const batch of batches) transport.enqueue(batch);
    return transport.flush();
  }

  /** Unload path: everything pending goes through sendBeacon, and the seq state is persisted. */
  function flushViaBeacon(): void {
    if (!session) return;
    const batches = buildBatches(buffer, false);
    buffer = [];
    if (batches.length === 0) {
      transport.beacon();
      return;
    }
    for (const batch of batches.slice(0, -1)) transport.enqueue(batch);
    transport.beacon(batches[batches.length - 1]);
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void flush(false);
  };
  const onPageHide = () => flushViaBeacon();

  function start(): void {
    if (recording) return;
    session = openSession();
    if (!session.sampled) {
      debug('session not sampled, recording disabled');
      return;
    }
    ended = false;
    recording = true;
    metaPending = session.batchSeq === 0 || session.url !== currentPageUrl();

    stops = [startNavigation(ctx), startErrors(ctx), startInteractions(ctx)];
    if (options.captureConsole !== false) stops.push(startConsole(ctx));
    if (options.captureNetwork !== false) stops.push(startNetwork(ctx));
    if (deps.rrweb !== false) stops.push(startRrweb(ctx));

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    timer = setInterval(() => void flush(false), flushIntervalMs);
    debug(`recording session ${session.id}`);
  }

  function stop(): void {
    if (!recording) return;
    recording = false;
    for (const stopModule of stops.splice(0)) {
      try {
        stopModule();
      } catch (err) {
        debug('capture module failed to stop', err);
      }
    }
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    void flush(true);
    clearSession();
    ended = true;
    session = null;
  }

  return {
    start,
    stop,
    captureException(error, context) {
      const fields = errorFields(error);
      const data: Extract<EventBody, { type: 'error' }>['data'] = {
        kind: 'captured',
        handled: true,
        message: fields.message || 'Captured exception',
      };
      if (fields.name) data.name = fields.name;
      if (fields.stack) data.stack = fields.stack;
      const cleaned = sanitizeRecord(context, { maxKeys: LIMITS.maxAnnotationKeys, maxValueLength: 500, dropSensitiveKeys: true });
      if (cleaned) data.context = cleaned;
      push({ type: 'error', data });
    },
    identify(userId, traits) {
      const id = typeof userId === 'string' ? userId.trim() : '';
      if (!id || isEmailShaped(id)) {
        debug('identify() ignored: userId must be an opaque id, not an email address');
        return;
      }
      const data: Extract<EventBody, { type: 'identify' }>['data'] = { userId: truncate(id, 200) };
      const cleaned = sanitizeRecord(traits, { maxKeys: LIMITS.maxAnnotationKeys, maxValueLength: 200, dropSensitiveKeys: true });
      if (cleaned) data.traits = cleaned;
      push({ type: 'identify', data });
    },
    annotate(name, data) {
      const label = typeof name === 'string' ? name.trim() : '';
      if (!label) return;
      const payload: Extract<EventBody, { type: 'annotation' }>['data'] = { name: truncate(label, 100) };
      const cleaned = sanitizeRecord(data, { maxKeys: LIMITS.maxAnnotationKeys, maxValueLength: 500, dropSensitiveKeys: true });
      if (cleaned) payload.data = cleaned;
      push({ type: 'annotation', data: payload });
    },
    flush: () => flush(false),
    getSessionId: () => session?.id ?? null,
    isRecording: () => recording,
  };
}
