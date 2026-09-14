/** Batching, splitting, and session continuity across page loads. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, type RecordedEvent } from '@repro/contracts';
import { splitEvents } from '../src/client.js';
import { SESSION_STORAGE_KEY } from '../src/storage.js';
import { Repro, version } from '../src/index.js';
import { $, fire, html, makeClient, ofType, resetDom, tick } from './helpers.js';
import pkg from '../package.json' with { type: 'json' };

function annotation(seq: number, size: number): RecordedEvent {
  return { type: 'annotation', seq, ts: 1_700_000_000_000 + seq, data: { name: 'pad', data: { p: 'x'.repeat(size) } } };
}

const measure = (events: RecordedEvent[]) => JSON.stringify(events).length;

describe('splitEvents()', () => {
  it('returns one group when everything fits', () => {
    const events = [annotation(0, 10), annotation(1, 10)];
    expect(splitEvents(events, measure, 10_000, 100)).toEqual([events]);
  });

  it('halves groups until each is under the byte limit, keeping order', () => {
    const events = Array.from({ length: 8 }, (_, i) => annotation(i, 100));
    const groups = splitEvents(events, measure, measure(events.slice(0, 3)), 100);
    expect(groups.flat().map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(groups.length).toBeGreaterThan(2);
    for (const group of groups) expect(measure(group)).toBeLessThanOrEqual(measure(events.slice(0, 3)));
  });

  it('splits on the event count limit too', () => {
    const events = Array.from({ length: 10 }, (_, i) => annotation(i, 1));
    expect(splitEvents(events, measure, 1_000_000, 4).map((g) => g.length)).toEqual([3, 2, 3, 2]);
  });

  it('drops a single event that can never fit and reports it', () => {
    const dropped: RecordedEvent[] = [];
    const events = [annotation(0, 5), annotation(1, 5000), annotation(2, 5)];
    const groups = splitEvents(events, measure, 500, 100, (e) => dropped.push(e));
    expect(groups.flat().map((e) => e.seq)).toEqual([0, 2]);
    expect(dropped.map((e) => e.seq)).toEqual([1]);
  });
});

describe('client batching', () => {
  beforeEach(() => resetDom());
  afterEach(() => vi.restoreAllMocks());

  it('splits a flush that exceeds LIMITS.maxBatchBytes into several batches with increasing batchSeq', async () => {
    const harness = makeClient({ maxBatchEvents: LIMITS.maxEventsPerBatch }, { rrweb: false });
    harness.client.start();
    // 20 keys of 500 chars is about 10 kB per annotation; 250 of them is about 2.5 MB.
    const data = Object.fromEntries(Array.from({ length: LIMITS.maxAnnotationKeys }, (_, i) => [`k${i}`, 'y'.repeat(500)]));
    for (let i = 0; i < 250; i += 1) harness.client.annotate('pad', data);
    await harness.client.flush();
    expect(harness.fetch.errors).toEqual([]);
    const uploads = harness.fetch.uploads;
    expect(uploads.length).toBeGreaterThanOrEqual(2);
    expect(uploads.map((u) => u.batch.batchSeq)).toEqual(uploads.map((_, i) => i));
    for (const upload of uploads) expect(Buffer.byteLength(upload.json)).toBeLessThanOrEqual(LIMITS.maxBatchBytes);
    // Meta rides on the first batch only; every event is delivered exactly once, in order.
    expect(uploads[0]?.batch.meta).toBeDefined();
    expect(uploads.slice(1).every((u) => u.batch.meta === undefined)).toBe(true);
    const seqs = harness.fetch.events().map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i));
    expect(ofType(harness.fetch.events(), 'annotation')).toHaveLength(250);
  });

  it('uploads as soon as maxBatchEvents is reached', async () => {
    const harness = makeClient({ maxBatchEvents: 5 }, { rrweb: false, transport: { gzip: false } });
    harness.client.start(); // one navigation event
    for (let i = 0; i < 11; i += 1) harness.client.annotate(`a${i}`);
    await tick();
    expect(harness.fetch.uploads.map((u) => u.batch.events.length)).toEqual([5, 5]);
    await harness.client.flush();
    expect(harness.fetch.uploads.map((u) => u.batch.events.length)).toEqual([5, 5, 2]);
  });

  it('uploads on the flush interval', async () => {
    vi.useFakeTimers();
    // gzip is off here: Node compresses on its thread pool, which fake timers cannot advance.
    const harness = makeClient({ flushIntervalMs: 250 }, { rrweb: false, transport: { gzip: false } });
    harness.client.start();
    expect(harness.fetch.uploads).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(260);
    expect(harness.fetch.uploads).toHaveLength(1);
    vi.useRealTimers();
  });

  it('flushes when the tab is hidden and beacons on pagehide', async () => {
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await harness.client.flush();
    expect(harness.fetch.uploads).toHaveLength(1);
    delete (document as { visibilityState?: string }).visibilityState;

    harness.client.annotate('before-unload');
    window.dispatchEvent(new Event('pagehide'));
    // No sendBeacon in the harness, so the beacon path falls back to keepalive fetch.
    await harness.client.flush();
    expect(harness.fetch.uploads).toHaveLength(2);
    expect(ofType(harness.fetch.uploads[1]!.batch.events, 'annotation')[0]?.data.name).toBe('before-unload');
    // The seq counter was persisted so the next page load continues from it.
    const stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? '{}') as { seq: number; batchSeq: number };
    expect(stored.batchSeq).toBe(2);
    expect(stored.seq).toBe(2);
  });
});

describe('session continuity', () => {
  beforeEach(() => resetDom());

  it('keeps one session with monotonic seq and batchSeq across a simulated reload', async () => {
    html('<button id="go">Go</button>');
    const first = makeClient({}, { rrweb: false });
    first.client.start();
    const sessionId = first.client.getSessionId();
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    fire($('#go'), 'click');
    await first.client.flush();
    fire($('#go'), 'click');
    window.dispatchEvent(new Event('pagehide')); // the browser is leaving the page
    await first.client.flush();

    // A full page load: fresh SDK instance, same tab, same sessionStorage.
    const second = makeClient({}, { rrweb: false });
    second.client.start();
    expect(second.client.getSessionId()).toBe(sessionId);
    fire($('#go'), 'click');
    await second.client.flush();

    const uploads = [...first.fetch.uploads, ...second.fetch.uploads];
    expect(uploads.every((u) => u.batch.sessionId === sessionId)).toBe(true);
    expect(uploads.map((u) => u.batch.batchSeq)).toEqual([0, 1, 2]);
    const seqs = uploads.flatMap((u) => u.batch.events.map((e) => e.seq));
    expect(seqs).toEqual(seqs.map((_, i) => i));
    // Meta is sent once for the same url; the reload starts with a fresh navigation event.
    expect(uploads[0]?.batch.meta).toBeDefined();
    expect(uploads[2]?.batch.meta).toBeUndefined();
    expect(uploads[2]?.batch.events[0]?.type).toBe('navigation');
  });

  it('re-sends meta when the reload lands on a different url', async () => {
    const first = makeClient({}, { rrweb: false });
    first.client.start();
    await first.client.flush();
    window.dispatchEvent(new Event('pagehide'));
    history.replaceState({}, '', '/account');
    const second = makeClient({}, { rrweb: false });
    second.client.start();
    await second.client.flush();
    expect(second.fetch.uploads[0]?.batch.meta?.page.url).toBe('http://localhost:3000/account');
  });

  it('stop() sends final: true, clears the session, and the next start is a new session', async () => {
    const harness = makeClient({}, { rrweb: false });
    harness.client.start();
    const id = harness.client.getSessionId();
    expect(harness.client.isRecording()).toBe(true);
    harness.client.stop();
    await harness.client.flush();
    expect(harness.client.isRecording()).toBe(false);
    expect(harness.client.getSessionId()).toBeNull();
    expect(harness.fetch.uploads.at(-1)?.batch.final).toBe(true);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    harness.client.start();
    expect(harness.client.getSessionId()).not.toBe(id);
  });

  it('honours a sessionId override and sampleRate', async () => {
    const id = '99999999-8888-4777-8666-555555555555';
    const chosen = makeClient({ sessionId: id }, { rrweb: false });
    chosen.client.start();
    expect(chosen.client.getSessionId()).toBe(id);
    await chosen.client.flush();
    expect(chosen.fetch.uploads[0]?.batch.sessionId).toBe(id);

    resetDom();
    const skipped = makeClient({ sampleRate: 0.5 }, { rrweb: false, random: () => 0.9 });
    skipped.client.start();
    expect(skipped.client.isRecording()).toBe(false);
    await skipped.client.flush();
    expect(skipped.fetch.uploads).toHaveLength(0);
  });

  it('meta describes the browser, page and SDK without secrets', async () => {
    history.replaceState({}, '', '/?token=abc&tab=1');
    const harness = makeClient({ release: '1.2.3', environment: 'test' }, { rrweb: false });
    harness.client.start();
    await harness.client.flush();
    const meta = harness.fetch.uploads[0]?.batch.meta;
    expect(meta).toMatchObject({
      sdkVersion: version,
      release: '1.2.3',
      environment: 'test',
      page: { url: 'http://localhost:3000/?token=%5Bredacted%5D&tab=1' },
    });
    expect(meta?.browser.userAgent).toContain('HappyDOM');
    expect(meta?.viewport.width).toBeGreaterThan(0);
    expect(meta?.locale).toBeTruthy();
  });
});

describe('public API', () => {
  beforeEach(() => {
    resetDom();
    // Repro.init uses the real transport, which would hit the network on stop(); answer it locally.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
  });
  afterEach(async () => {
    Repro.stop();
    await Repro.flush(); // let the final upload reach the stubbed fetch before it is restored
    vi.unstubAllGlobals();
  });

  it('exposes the documented surface and the package version', () => {
    expect(version).toBe(pkg.version);
    expect(Repro.version).toBe(version);
    const client = Repro.init({ projectKey: 'rp_x', endpoint: 'http://localhost:4000', autoStart: false });
    for (const method of [
      'start',
      'stop',
      'captureException',
      'identify',
      'annotate',
      'flagIncident',
      'flush',
      'getSessionId',
      'isRecording',
      'getMode',
      'hasTriggered',
    ] as const) {
      expect(typeof client[method]).toBe('function');
      expect(typeof Repro[method]).toBe('function');
    }
    expect(client.isRecording()).toBe(false);
    client.start();
    expect(Repro.isRecording()).toBe(true);
    expect(Repro.getSessionId()).toBe(client.getSessionId());
    expect(Repro.getMode()).toBe('always');
    expect(Repro.hasTriggered()).toBe(false);
  });

  it('is a safe no-op outside a browser', async () => {
    vi.stubGlobal('document', undefined);
    const client = Repro.init({ projectKey: 'rp_x', endpoint: 'http://localhost:4000' });
    expect(client.isRecording()).toBe(false);
    expect(client.getSessionId()).toBeNull();
    expect(() => {
      client.captureException(new Error('x'));
      client.identify('u');
      client.annotate('a');
      client.stop();
    }).not.toThrow();
    await expect(client.flush()).resolves.toBeUndefined();
  });

  it('warns and disables recording when options are missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = Repro.init({} as never);
    expect(client.isRecording()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });
});
