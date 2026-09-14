/**
 * Record-on-incident mode. Events stay in a rolling in-memory buffer, cut only at rrweb
 * checkout boundaries, and nothing is uploaded until an incident. Synthetic rrweb events are
 * fed through the client's own emit path (the one rrweb capture uses) via a test-only module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventType, IncrementalSource } from '@rrweb/types';
import type { RecordedEvent } from '@repro/contracts';
import { isIncident, trimIndex } from '../src/client.js';
import { buildRecordOptions, CHECKOUT_EVERY_MS } from '../src/capture/rrweb.js';
import { SESSION_STORAGE_KEY } from '../src/storage.js';
import type { CaptureContext, Emit, EventBody, ReproOptions } from '../src/types.js';
import type { ClientDeps } from '../src/client.js';
import { ENDPOINT, installPageFetch, installPageXhr, makeClient, ofType, resetDom, tick, type Harness } from './helpers.js';

interface Tapped extends Harness {
  /** The client's emit, exactly what capture/rrweb.ts calls. Valid after start(). */
  emit: Emit;
  ctx(): CaptureContext | undefined;
}

/** An on-incident client with rrweb off and a module that hands the test the capture context. */
function tapped(options: Partial<ReproOptions> = {}, deps: ClientDeps = {}): Tapped {
  let ctx: CaptureContext | undefined;
  const harness = makeClient(
    { mode: 'on-incident', ...options },
    {
      rrweb: false,
      ...deps,
      modules: [
        (c) => {
          ctx = c;
          return () => {};
        },
        ...(deps.modules ?? []),
      ],
    },
  );
  return {
    ...harness,
    emit: (event) => {
      if (!ctx) throw new Error('client not started');
      ctx.emit(event);
    },
    ctx: () => ctx,
  };
}

const meta = (): EventBody => ({
  type: 'rrweb',
  data: { type: EventType.Meta, timestamp: Date.now(), data: { href: 'http://localhost:3000/', width: 800, height: 600 } },
});
const fullSnapshot = (): EventBody => ({
  type: 'rrweb',
  data: { type: EventType.FullSnapshot, timestamp: Date.now(), data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 } } },
});
const incremental = (n: number): EventBody => ({
  type: 'rrweb',
  data: {
    type: EventType.IncrementalSnapshot,
    timestamp: Date.now(),
    data: { source: IncrementalSource.MouseMove, positions: [{ x: n, y: n, id: 1, timeOffset: 0 }] },
  },
});

/** What rrweb emits at every checkout. */
function checkout(t: Tapped): void {
  t.emit(meta());
  t.emit(fullSnapshot());
}

const rrwebTypes = (events: RecordedEvent[]) => ofType(events, 'rrweb').map((e) => e.data.type);
const annotationNames = (events: RecordedEvent[]) => ofType(events, 'annotation').map((e) => e.data.name);

function expectMonotonicSeq(events: RecordedEvent[]): void {
  for (let i = 1; i < events.length; i += 1) expect(events[i]!.seq).toBeGreaterThan(events[i - 1]!.seq);
}

describe('on-incident mode: buffering', () => {
  beforeEach(() => resetDom());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uploads nothing before a trigger while reporting that it is recording', async () => {
    vi.useFakeTimers();
    const t = tapped({ flushIntervalMs: 250, maxBatchEvents: 3 }, { transport: { gzip: false } });
    t.client.start();
    expect(t.client.isRecording()).toBe(true);
    expect(t.client.getMode()).toBe('on-incident');
    expect(t.client.hasTriggered()).toBe(false);
    const sessionId = t.client.getSessionId();
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    checkout(t);
    for (let i = 0; i < 10; i += 1) t.client.annotate(`step-${i}`); // well past maxBatchEvents
    await vi.advanceTimersByTimeAsync(5_000); // well past flushIntervalMs
    await t.client.flush();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as { visibilityState?: string }).visibilityState;
    window.dispatchEvent(new Event('pagehide'));
    await t.client.flush();

    expect(t.fetch.calls).toBe(0);
    expect(t.fetch.uploads).toHaveLength(0);
    // The session id is persisted for continuity, with the triggered flag still off.
    const stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? '{}') as { id: string; triggered: boolean; batchSeq: number };
    expect(stored).toMatchObject({ id: sessionId, triggered: false, batchSeq: 0 });
  });

  it('configures rrweb checkouts at half the buffer window, only in on-incident mode', () => {
    const t = tapped({ bufferSeconds: 30 });
    t.client.start();
    expect(t.ctx()?.checkoutEveryMs).toBe(15_000);
    const always = tapped({ mode: 'always' });
    always.client.start();
    expect(always.ctx()?.checkoutEveryMs).toBeUndefined();

    const base = { emit() {}, redaction: { strict: false }, endpoint: ENDPOINT, debug() {} };
    expect(buildRecordOptions({ ...base, checkoutEveryMs: 15_000 }).checkoutEveryNms).toBe(15_000);
    expect(buildRecordOptions(base).checkoutEveryNms).toBe(CHECKOUT_EVERY_MS);
  });

  it.each([
    // trigger time, expected first retained checkout, in seconds. Checkouts happen at 0, 15, 30, 45.
    [50, 15], // checkouts older than 30 s: 0 and 15; the most recent wins, so 35 s are kept
    [59, 15], // still 15: the 30 s checkout is only 29 s old, so 44 s are kept (just under 1.5x)
    [60, 30], // the 30 s checkout is now exactly 30 s old, so the window shrinks back to 30 s
  ])('trims by time at checkout boundaries only (trigger at %ss keeps from %ss)', async (triggerAt, keptFrom) => {
    vi.useFakeTimers();
    const t0 = 1_800_000_000_000;
    vi.setSystemTime(t0);
    const t = tapped({ bufferSeconds: 30 }, { transport: { gzip: false } });
    t.client.start();
    for (let second = 0; second <= triggerAt; second += 1) {
      vi.setSystemTime(t0 + second * 1000);
      if (second % 15 === 0) checkout(t);
      t.emit(incremental(second));
      if (second === 10) t.client.annotate('early'); // before the cut
      if (second === 20) t.client.annotate('late'); // after it
    }
    t.client.flagIncident('manual');
    await t.client.flush();

    const events = t.fetch.events();
    expect(t.fetch.errors).toEqual([]);
    expect(events[0]?.ts).toBe(t0 + keptFrom * 1000);
    expect(rrwebTypes(events).slice(0, 2)).toEqual([EventType.Meta, EventType.FullSnapshot]);
    expect(events[0]?.type).toBe('rrweb');
    const kept = [...(keptFrom <= 10 ? ['early'] : []), ...(keptFrom <= 20 ? ['late'] : []), 'incident:manual'];
    expect(annotationNames(events)).toEqual(kept);
    const windowMs = events.at(-1)!.ts - events[0]!.ts;
    expect(windowMs).toBeGreaterThanOrEqual(30_000);
    expect(windowMs).toBeLessThan(45_000);
    expectMonotonicSeq(events);
  });

  it('trims by count at checkout boundaries only', async () => {
    const t = tapped({ bufferEvents: 11 }, { transport: { gzip: false } });
    t.client.start(); // 1 navigation event
    // Three segments of five: Meta, FullSnapshot, three incrementals.
    for (let segment = 0; segment < 3; segment += 1) {
      checkout(t);
      for (let i = 0; i < 3; i += 1) t.emit(incremental(segment * 10 + i));
    }
    t.client.captureException(new Error('boom'));
    await t.client.flush();

    const events = t.fetch.events();
    expect(t.fetch.errors).toEqual([]);
    // The navigation event and the first segment were dropped as whole units; nothing was cut mid-segment.
    expect(events).toHaveLength(11);
    expect(events.map((e) => e.type)).toEqual([...Array<string>(10).fill('rrweb'), 'error']);
    expect(rrwebTypes(events)).toEqual([4, 2, 3, 3, 3, 4, 2, 3, 3, 3]);
    expect(ofType(events, 'rrweb')[2]?.data.data).toMatchObject({ positions: [{ x: 10 }] });
    expectMonotonicSeq(events);
  });

  it('never cuts a buffer that has no checkout to cut at', async () => {
    const t = tapped({ bufferEvents: 10 }, { transport: { gzip: false } });
    t.client.start();
    for (let i = 0; i < 30; i += 1) t.emit(incremental(i));
    t.client.flagIncident('manual');
    await t.client.flush();
    // navigation + 30 incrementals + the incident annotation, all present
    expect(t.fetch.events()).toHaveLength(32);
  });

  it('asks rrweb for a fresh checkout when a single segment outgrows bufferEvents', async () => {
    let ctx: CaptureContext | undefined;
    const harness = makeClient(
      { mode: 'on-incident', bufferEvents: 20 },
      {
        modules: [
          (c) => {
            ctx = c;
            return () => {};
          },
        ],
      },
    );
    harness.client.start();
    await tick(20); // the initial Meta + FullSnapshot
    for (let i = 0; i < 25; i += 1) ctx!.emit(incremental(i));
    harness.client.flagIncident('manual');
    await harness.client.flush();

    const events = harness.fetch.events();
    expect(harness.fetch.errors).toEqual([]);
    expect(events.length).toBeLessThanOrEqual(20);
    const types = rrwebTypes(events);
    expect(types.slice(0, 2)).toEqual([EventType.Meta, EventType.FullSnapshot]);
    // Exactly one checkout survives: the forced one, followed by the incrementals that came after it.
    expect(types.filter((type) => type === EventType.Meta)).toHaveLength(1);
    expect(types.filter((type) => type === EventType.FullSnapshot)).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('annotation');
  });

  it('trimIndex() and isIncident() are pure', () => {
    const at = (ts: number, type: number): RecordedEvent => ({ type: 'rrweb', seq: 0, ts, data: { type, timestamp: ts, data: null } });
    const buffer = [at(0, 4), at(0, 2), at(5, 3), at(10, 4), at(10, 2), at(15, 3), at(20, 4), at(20, 2)];
    expect(trimIndex(buffer, [0, 3, 6], 25, 100, 100)).toBe(0); // nothing old enough, nothing over count
    expect(trimIndex(buffer, [0, 3, 6], 25, 10, 100)).toBe(3); // 10 is 15 old, 20 is only 5 old
    expect(trimIndex(buffer, [0, 3, 6], 25, 100, 5)).toBe(3); // earliest checkout that fits in 5
    expect(trimIndex(buffer, [0, 3, 6], 25, 100, 1)).toBe(6); // nothing fits, latest checkout
    expect(trimIndex(buffer, [], 25, 1, 1)).toBe(0); // no checkout, no cut

    const network = (ok: boolean, status: number | null, error?: string): RecordedEvent => ({
      type: 'network',
      seq: 0,
      ts: 1,
      data: { kind: 'fetch', method: 'GET', url: 'http://x/', path: '/', status, ok, durationMs: 1, requestId: 'abcdef012345', ...(error ? { error } : {}) },
    });
    expect(isIncident(network(true, 200))).toBe(false);
    expect(isIncident(network(false, 404))).toBe(false);
    expect(isIncident(network(false, 500))).toBe(true);
    expect(isIncident(network(false, 503))).toBe(true);
    expect(isIncident(network(false, null, 'Failed to fetch'))).toBe(true);
    expect(isIncident(network(false, null, 'The operation was aborted.'))).toBe(false);
    expect(isIncident({ type: 'console', seq: 0, ts: 1, data: { level: 'error', args: ['x'] } })).toBe(false);
  });
});

describe('on-incident mode: triggers', () => {
  beforeEach(() => resetDom());
  afterEach(() => vi.restoreAllMocks());

  interface Trigger {
    name: string;
    /** Runs before start(), for page-level fetch stubs the SDK must wrap. */
    prepare?: () => void;
    fire: (t: Tapped) => Promise<void> | void;
    saw: (events: RecordedEvent[]) => boolean;
  }

  const triggers: Trigger[] = [
    {
      name: 'an uncaught exception',
      fire: () => window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') })),
      saw: (events) => ofType(events, 'error').some((e) => e.data.kind === 'exception'),
    },
    {
      name: 'an unhandled rejection',
      fire: () => window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { reason: new Error('nope'), promise: Promise.resolve() })),
      saw: (events) => ofType(events, 'error').some((e) => e.data.kind === 'unhandledrejection'),
    },
    {
      name: 'captureException()',
      fire: (t) => t.client.captureException(new Error('handled')),
      saw: (events) => ofType(events, 'error').some((e) => e.data.kind === 'captured'),
    },
    {
      name: 'a 5xx response',
      prepare: () => installPageFetch('{}', 503),
      fire: async () => {
        await window.fetch('/api/pay');
      },
      saw: (events) => ofType(events, 'network').some((e) => e.data.status === 503),
    },
    {
      name: 'a network-level fetch error',
      prepare: () => {
        window.fetch = (async () => {
          throw new TypeError('Failed to fetch');
        }) as typeof fetch;
      },
      fire: async () => {
        await expect(window.fetch('/api/down')).rejects.toThrow();
      },
      saw: (events) => ofType(events, 'network').some((e) => e.data.status === null),
    },
    {
      name: 'flagIncident()',
      fire: (t) => t.client.flagIncident('checkout-stuck', { step: 3 }),
      saw: (events) => ofType(events, 'annotation').some((e) => e.data.name === 'incident:checkout-stuck' && e.data.data?.step === 3),
    },
  ];

  it.each(triggers)('$name uploads the buffer with meta on batchSeq 0 and switches to always', async ({ prepare, fire, saw }) => {
    prepare?.();
    const t = tapped({}, { transport: { gzip: false } });
    t.client.start();
    checkout(t);
    t.emit(incremental(1));
    t.client.annotate('before');
    expect(t.fetch.uploads).toHaveLength(0);

    await fire(t);
    await t.client.flush();

    expect(t.fetch.errors).toEqual([]);
    expect(t.fetch.uploads.length).toBeGreaterThanOrEqual(1);
    expect(t.fetch.uploads[0]?.batch.batchSeq).toBe(0);
    expect(t.fetch.uploads[0]?.batch.meta).toBeDefined();
    const events = t.fetch.events();
    expect(events[0]?.type).toBe('navigation');
    expect(rrwebTypes(events)).toEqual([EventType.Meta, EventType.FullSnapshot, EventType.IncrementalSnapshot]);
    expect(annotationNames(events)).toContain('before');
    expect(saw(events)).toBe(true);
    expectMonotonicSeq(events);
    expect(t.client.getMode()).toBe('always');
    expect(t.client.hasTriggered()).toBe(true);
  });

  it('does not trigger on 4xx responses, aborted requests or console errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installPageFetch('{}', 404);
    installPageXhr(0);
    const t = tapped({}, { transport: { gzip: false } });
    t.client.start();
    await window.fetch('/api/missing');
    const xhr = new XMLHttpRequest();
    const done = new Promise<void>((resolve) => xhr.addEventListener('loadend', () => resolve()));
    xhr.open('GET', '/api/slow');
    xhr.send();
    xhr.dispatchEvent(new Event('abort'));
    await done;
    console.error('not an incident');
    await tick();
    await t.client.flush();
    expect(t.fetch.uploads).toHaveLength(0);
    expect(t.client.getMode()).toBe('on-incident');
  });

  it('continues like always mode after the trigger, with monotonic seq and batchSeq', async () => {
    vi.useFakeTimers();
    const t = tapped({ flushIntervalMs: 250 }, { transport: { gzip: false } });
    t.client.start();
    checkout(t);
    t.client.annotate('before');
    t.client.flagIncident('manual');
    await t.client.flush();
    expect(t.fetch.uploads).toHaveLength(1);

    t.client.annotate('after');
    await vi.advanceTimersByTimeAsync(260); // the flush interval is running now
    expect(t.fetch.uploads).toHaveLength(2);
    expect(t.fetch.uploads.map((u) => u.batch.batchSeq)).toEqual([0, 1]);
    expect(t.fetch.uploads[1]?.batch.meta).toBeUndefined();
    expect(annotationNames(t.fetch.events())).toEqual(['before', 'incident:manual', 'after']);
    const seqs = t.fetch.events().map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i));

    t.client.stop();
    await t.client.flush();
    expect(t.fetch.uploads.at(-1)?.batch.final).toBe(true);
    vi.useRealTimers();
  });

  it('flagIncident() in always mode only annotates', async () => {
    const t = tapped({ mode: 'always' }, { transport: { gzip: false } });
    t.client.start();
    t.client.flagIncident('  slow-page  ', { ms: 4200 });
    t.client.flagIncident('');
    await t.client.flush();
    const annotations = ofType(t.fetch.events(), 'annotation');
    expect(annotations.map((e) => e.data)).toEqual([{ name: 'incident:slow-page', data: { ms: 4200 } }, { name: 'incident:unspecified' }]);
    expect(t.client.getMode()).toBe('always');
    expect(t.client.hasTriggered()).toBe(false);
  });
});

describe('on-incident mode: lifecycle', () => {
  beforeEach(() => resetDom());

  it('stop() before any trigger uploads nothing and clears the persisted session', async () => {
    const t = tapped({}, { transport: { gzip: false } });
    t.client.start();
    checkout(t);
    t.client.annotate('healthy');
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
    t.client.stop();
    await t.client.flush();
    expect(t.fetch.calls).toBe(0);
    expect(t.client.isRecording()).toBe(false);
    expect(t.client.getSessionId()).toBeNull();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('a page load after a trigger keeps uploading the same session', async () => {
    const first = tapped({}, { transport: { gzip: false } });
    first.client.start();
    const sessionId = first.client.getSessionId();
    checkout(first);
    first.client.flagIncident('manual');
    await first.client.flush();
    first.client.annotate('leaving');
    window.dispatchEvent(new Event('pagehide')); // no sendBeacon in the harness, so this is a keepalive fetch
    await first.client.flush();
    expect(first.fetch.uploads.map((u) => u.batch.batchSeq)).toEqual([0, 1]);
    expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? '{}')).toMatchObject({ id: sessionId, triggered: true });

    // Fresh SDK instance in the same tab, still configured for on-incident.
    const second = tapped({}, { transport: { gzip: false } });
    second.client.start();
    expect(second.client.getSessionId()).toBe(sessionId);
    expect(second.client.getMode()).toBe('always');
    expect(second.client.hasTriggered()).toBe(true);
    second.client.annotate('back');
    await second.client.flush();
    expect(second.fetch.uploads).toHaveLength(1);
    expect(second.fetch.uploads[0]?.batch).toMatchObject({ sessionId, batchSeq: 2 });
    expect(second.fetch.uploads[0]?.batch.meta).toBeUndefined();
    expect(second.fetch.uploads[0]?.batch.events[0]?.type).toBe('navigation');
    expectMonotonicSeq([...first.fetch.events(), ...second.fetch.events()]);
  });

  it('a page load before a trigger keeps buffering the same session', async () => {
    const first = tapped({}, { transport: { gzip: false } });
    first.client.start();
    const sessionId = first.client.getSessionId();
    first.client.annotate('quiet');
    window.dispatchEvent(new Event('pagehide'));
    await first.client.flush();
    expect(first.fetch.calls).toBe(0);

    const second = tapped({}, { transport: { gzip: false } });
    second.client.start();
    expect(second.client.getSessionId()).toBe(sessionId);
    expect(second.client.getMode()).toBe('on-incident');
    expect(second.client.hasTriggered()).toBe(false);
    checkout(second);
    await second.client.flush();
    expect(second.fetch.calls).toBe(0);
    // The eventual first upload still opens the session properly: meta on batchSeq 0.
    second.client.flagIncident('manual');
    await second.client.flush();
    expect(second.fetch.uploads[0]?.batch).toMatchObject({ sessionId, batchSeq: 0 });
    expect(second.fetch.uploads[0]?.batch.meta).toBeDefined();
  });
});
