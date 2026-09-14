/**
 * Session lifecycle and batching. One client owns one session: it stamps seq numbers, buffers
 * events, packs them into IngestBatch uploads, and starts or stops the capture modules.
 *
 * Two modes share this file. In 'always' mode the buffer is drained on a timer. In 'on-incident'
 * mode the buffer is a rolling window trimmed at rrweb checkout boundaries, nothing leaves the
 * page until an incident, and the first upload is the whole window; the client then behaves as
 * 'always' for the rest of the session.
 */
import { LIMITS, SCHEMA_VERSION, sanitizeUrl, truncate } from '@repro/contracts/runtime';
import type { IngestBatch, RecordedEvent, SessionMeta } from '@repro/contracts';
import { EventType } from '@rrweb/types';
import { startConsole } from './capture/console.js';
import { errorFields } from './capture/errors.js';
import { startErrors } from './capture/errors.js';
import { startInteractions } from './capture/interactions.js';
import { startNavigation } from './capture/navigation.js';
import { startNetwork } from './capture/network.js';
import { startRrweb, takeCheckout } from './capture/rrweb.js';
import { buildMeta } from './meta.js';
import { isEmailShaped, sanitizeRecord, type RedactionOptions } from './redact.js';
import { clearSession, loadSession, saveSession, type PersistedSession } from './storage.js';
import { createTransport, type Transport, type TransportOptions } from './transport.js';
import type { CaptureContext, DebugLog, EventBody, ReproClient, ReproMode, ReproOptions, Stop } from './types.js';
import { version as sdkVersion } from './version.js';

export const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
export const DEFAULT_MAX_BATCH_EVENTS = 200;
export const DEFAULT_BUFFER_SECONDS = 30;
export const DEFAULT_BUFFER_EVENTS = 2_000;
/** Below these the checkout cadence would cost more than the recording it protects. */
const MIN_BUFFER_SECONDS = 1;
const MIN_BUFFER_EVENTS = 10;
/** A forced checkout that produced nothing is not retried for this long. */
const FORCED_CHECKOUT_COOLDOWN_MS = 1_000;

type Primitive = string | number | boolean;

/** Test hooks. Production code never passes these. */
export interface ClientDeps {
  transport?: Partial<TransportOptions>;
  random?: () => number;
  /** Skip rrweb (tests that only care about the other modules). */
  rrweb?: boolean;
  /** Extra capture modules. Tests use one to feed synthetic events through the real emit path. */
  modules?: Array<(ctx: CaptureContext) => Stop>;
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

/**
 * An rrweb Meta event opens a checkout (Meta, then FullSnapshot). It is the only place a rolling
 * buffer may begin, because a replay needs both before any incremental event makes sense.
 */
export function isCheckoutStart(event: RecordedEvent): boolean {
  return event.type === 'rrweb' && event.data.type === EventType.Meta;
}

/**
 * Events that turn a buffered session into an incident: every error event (uncaught exception,
 * unhandled rejection, captureException) and a request that failed server-side or never got a
 * response. 4xx answers are the page's business, and a request the page cancelled is not a failure.
 */
export function isIncident(event: RecordedEvent): boolean {
  if (event.type === 'error') return true;
  if (event.type !== 'network' || event.data.ok) return false;
  const { status, error } = event.data;
  if (status !== null && status < 500) return false;
  return !/abort/i.test(error ?? '');
}

/**
 * The first index a rolling buffer should keep. Cuts land on checkout starts only: the most
 * recent checkout that is at least `windowMs` old (so the window stays between one and one and a
 * half times `windowMs` with checkouts every `windowMs / 2`), and, when the buffer still holds more
 * than `maxEvents`, the earliest checkout that brings it under the limit. When no checkout does,
 * the latest one is the best available cut; the caller may then ask rrweb for a fresh checkout.
 */
export function trimIndex(buffer: RecordedEvent[], checkouts: number[], now: number, windowMs: number, maxEvents: number): number {
  let cut = 0;
  for (let i = checkouts.length - 1; i >= 0; i -= 1) {
    const at = checkouts[i]!;
    if (buffer[at]!.ts <= now - windowMs) {
      cut = at;
      break;
    }
  }
  if (buffer.length - cut > maxEvents) {
    const fits = checkouts.find((at) => buffer.length - at <= maxEvents);
    cut = Math.max(cut, fits ?? checkouts[checkouts.length - 1] ?? 0);
  }
  return cut;
}

export function createClient(options: ReproOptions, deps: ClientDeps = {}): ReproClient {
  const debug: DebugLog = options.debug ? (...args) => console.debug('[repro]', ...args) : () => {};
  const random = deps.random ?? Math.random;
  const flushIntervalMs = Math.max(250, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
  const maxBatchEvents = Math.max(1, Math.min(LIMITS.maxEventsPerBatch, options.maxBatchEvents ?? DEFAULT_MAX_BATCH_EVENTS));
  const sampleRate = Math.min(1, Math.max(0, options.sampleRate ?? 1));
  const configuredMode: ReproMode = options.mode === 'on-incident' ? 'on-incident' : 'always';
  const bufferMs = Math.max(MIN_BUFFER_SECONDS, options.bufferSeconds ?? DEFAULT_BUFFER_SECONDS) * 1000;
  const bufferEvents = Math.max(MIN_BUFFER_EVENTS, Math.floor(options.bufferEvents ?? DEFAULT_BUFFER_EVENTS));
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
  let mode: ReproMode = configuredMode;
  let triggered = false;
  let buffer: RecordedEvent[] = [];
  /** Indices into `buffer` of rrweb Meta events, ascending. Only meaningful while buffering. */
  let checkouts: number[] = [];
  let forcingCheckout = false;
  let lastForcedCheckoutAt = 0;
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
      triggered: false,
    };
    saveSession(created);
    return created;
  }

  function dropBefore(index: number): void {
    if (index <= 0) return;
    buffer.splice(0, index);
    checkouts = checkouts.filter((at) => at >= index).map((at) => at - index);
  }

  /**
   * Keep the rolling window within bufferSeconds and bufferEvents, cutting at checkouts only.
   * When one checkout segment alone is over the count, ask rrweb for a new checkout so the next
   * push has somewhere to cut; the nested emits land back here and trim at that checkout.
   */
  function trimBuffer(allowForcedCheckout: boolean): void {
    dropBefore(trimIndex(buffer, checkouts, Date.now(), bufferMs, bufferEvents));
    if (!allowForcedCheckout || buffer.length <= bufferEvents) return;
    if (forcingCheckout || deps.rrweb === false || Date.now() - lastForcedCheckoutAt < FORCED_CHECKOUT_COOLDOWN_MS) return;
    forcingCheckout = true;
    lastForcedCheckoutAt = Date.now();
    try {
      takeCheckout(ctx);
    } finally {
      forcingCheckout = false;
    }
  }

  function push(event: EventBody): void {
    if (!recording || !session) return;
    const stamped = { ...event, seq: session.seq, ts: Date.now() } as RecordedEvent;
    session.seq += 1;
    buffer.push(stamped);
    if (mode === 'on-incident') {
      if (isCheckoutStart(stamped)) checkouts.push(buffer.length - 1);
      if (isIncident(stamped)) trigger(describeIncident(stamped));
      else trimBuffer(true);
      return;
    }
    if (buffer.length >= maxBatchEvents) void flush(false);
  }

  const ctx: CaptureContext = { emit: push, redaction, endpoint: options.endpoint, debug };

  function describeIncident(event: RecordedEvent): string {
    if (event.type === 'error') return `error:${event.data.kind}`;
    if (event.type === 'network') return `network:${event.data.status ?? event.data.error ?? 'failed'}`;
    return event.type;
  }

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
    // While buffering nothing leaves the page, so a healthy session never gets a server row.
    if (!session || mode === 'on-incident') return transport.flush();
    const batches = buildBatches(buffer, final);
    buffer = [];
    for (const batch of batches) transport.enqueue(batch);
    return transport.flush();
  }

  /** Unload path: everything pending goes through sendBeacon, and the seq state is persisted. */
  function flushViaBeacon(): void {
    if (!session) return;
    if (mode === 'on-incident') {
      saveSession(session);
      return;
    }
    const batches = buildBatches(buffer, false);
    buffer = [];
    if (batches.length === 0) {
      transport.beacon();
      return;
    }
    for (const batch of batches.slice(0, -1)) transport.enqueue(batch);
    transport.beacon(batches[batches.length - 1]);
  }

  /**
   * Leave buffering for good: the retained window becomes the session's first batches (batchSeq
   * from 0, meta on the first), then the ordinary upload cadence takes over until stop().
   */
  function trigger(reason: string): void {
    if (mode !== 'on-incident' || !session || !recording) return;
    trimBuffer(false);
    mode = 'always';
    triggered = true;
    session.triggered = true;
    checkouts = [];
    startTimer();
    debug(`incident (${reason}): uploading ${buffer.length} buffered events`);
    void flush(false);
  }

  function startTimer(): void {
    if (timer) return;
    timer = setInterval(() => void flush(false), flushIntervalMs);
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
    // A session that already had its incident keeps uploading across page loads.
    triggered = session.triggered;
    mode = triggered ? 'always' : configuredMode;
    buffer = [];
    checkouts = [];
    metaPending = session.batchSeq === 0 || session.url !== currentPageUrl();
    // Checkouts twice per window keep the retained prefix between 1x and 1.5x bufferSeconds.
    ctx.checkoutEveryMs = mode === 'on-incident' ? bufferMs / 2 : undefined;

    stops = [startNavigation(ctx), startErrors(ctx), startInteractions(ctx)];
    if (options.captureConsole !== false) stops.push(startConsole(ctx));
    if (options.captureNetwork !== false) stops.push(startNetwork(ctx));
    if (deps.rrweb !== false) stops.push(startRrweb(ctx));
    for (const module of deps.modules ?? []) stops.push(module(ctx));

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    if (mode === 'always') startTimer();
    debug(`recording session ${session.id} (${mode})`);
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
    if (mode === 'on-incident') {
      // No incident, so nothing was ever uploaded and nothing will be.
      debug(`discarding ${buffer.length} buffered events, no incident`);
      buffer = [];
      checkouts = [];
    } else {
      void flush(true);
    }
    clearSession();
    ended = true;
    session = null;
    mode = configuredMode;
    triggered = false;
  }

  function annotate(name: string, data?: Record<string, Primitive>): void {
    const label = typeof name === 'string' ? name.trim() : '';
    if (!label) return;
    const payload: Extract<EventBody, { type: 'annotation' }>['data'] = { name: truncate(label, 100) };
    const cleaned = sanitizeRecord(data, { maxKeys: LIMITS.maxAnnotationKeys, maxValueLength: 500, dropSensitiveKeys: true });
    if (cleaned) payload.data = cleaned;
    push({ type: 'annotation', data: payload });
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
    annotate,
    flagIncident(reason, data) {
      const label = typeof reason === 'string' && reason.trim() ? reason.trim() : 'unspecified';
      annotate(`incident:${label}`, data);
      trigger(`flagIncident:${label}`);
    },
    flush: () => flush(false),
    getSessionId: () => session?.id ?? null,
    isRecording: () => recording,
    getMode: () => mode,
    hasTriggered: () => triggered,
  };
}
