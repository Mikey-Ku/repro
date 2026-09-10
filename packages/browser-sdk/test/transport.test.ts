/** Upload path: retry with backoff, dropping on client errors, the bounded queue, and beacons. */
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION, type IngestBatch } from '@repro/contracts';
import { backoffDelay, createTransport, hasCompressionStream, isRetryableStatus } from '../src/transport.js';
import { fakeFetch, INGEST_URL, PROJECT_KEY, ENDPOINT } from './helpers.js';

const SESSION = '11111111-2222-4333-8444-555555555555';

function batch(batchSeq: number): IngestBatch {
  return { v: SCHEMA_VERSION, sessionId: SESSION, batchSeq, sentAt: Date.now(), events: [] };
}

function transportWith(fetch: ReturnType<typeof fakeFetch>, extra: Parameters<typeof createTransport>[0] extends infer T ? Partial<T> : never = {}) {
  return createTransport({ endpoint: ENDPOINT, projectKey: PROJECT_KEY, fetch: fetch.fetch, sendBeacon: null, gzip: false, ...extra });
}

describe('backoff', () => {
  it('doubles from 500 ms to 8 s with at most 20 percent jitter', () => {
    expect([0, 1, 2, 3, 4].map((n) => backoffDelay(n, 500, () => 0))).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(backoffDelay(4, 500, () => 1)).toBe(9600);
    expect(backoffDelay(0, 500, () => 0.5)).toBe(550);
  });

  it('retries 429 and 5xx only', () => {
    expect([429, 500, 502, 503].every(isRetryableStatus)).toBe(true);
    expect([200, 400, 401, 403, 404, 413].some(isRetryableStatus)).toBe(false);
  });
});

describe('retry with fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // no jitter, so delays are exact
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries 5xx with backoff and stops after success', async () => {
    const fetch = fakeFetch((call) => (call < 2 ? 503 : 200));
    const transport = transportWith(fetch);
    transport.enqueue(batch(0));
    const flushed = transport.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetch.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch.calls).toBe(3);
    await flushed;
    expect(transport.pending()).toBe(0);
  });

  it('gives up after 5 attempts on persistent network errors', async () => {
    const fetch = fakeFetch(() => 'network-error');
    const transport = transportWith(fetch);
    transport.enqueue(batch(0));
    transport.enqueue(batch(1));
    const flushed = transport.flush();
    // 500 + 1000 + 2000 + 4000 ms of waiting between the five attempts for batch 0.
    await vi.advanceTimersByTimeAsync(7499);
    expect(fetch.calls).toBe(4);
    // At 7500 ms the fifth attempt fails, batch 0 is abandoned and batch 1 starts immediately.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch.calls).toBe(6);
    await vi.advanceTimersByTimeAsync(7500);
    expect(fetch.calls).toBe(10);
    await flushed;
    expect(transport.pending()).toBe(0);
  });

  it('drops the batch on a 4xx without retrying', async () => {
    const fetch = fakeFetch(() => 400);
    const transport = transportWith(fetch);
    transport.enqueue(batch(0));
    await transport.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch.calls).toBe(1);
  });
});

describe('queue bound', () => {
  it('keeps at most maxQueue pending batches, dropping the oldest', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = fakeFetch();
    const inner = fetch.fetch;
    let first = true;
    fetch.fetch = async (url, init) => {
      if (first) {
        first = false;
        await gate; // hold the first upload in flight so the rest queue up
      }
      return inner(url, init);
    };
    const transport = transportWith(fetch, { maxQueue: 3 });
    for (let i = 0; i < 7; i += 1) transport.enqueue(batch(i));
    expect(transport.pending()).toBe(3);
    release();
    await transport.flush();
    expect(fetch.uploads.map((u) => u.batch.batchSeq)).toEqual([0, 4, 5, 6]);
  });
});

describe('request shape', () => {
  it('posts JSON with the project key header and keepalive', async () => {
    const seen: RequestInit[] = [];
    const transport = createTransport({
      endpoint: `${ENDPOINT}/`,
      projectKey: PROJECT_KEY,
      gzip: false,
      sendBeacon: null,
      fetch: async (url, init) => {
        expect(url).toBe(INGEST_URL);
        seen.push(init);
        return { ok: true, status: 200 };
      },
    });
    transport.enqueue(batch(0));
    await transport.flush();
    expect(seen[0]).toMatchObject({
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', 'x-repro-key': PROJECT_KEY },
    });
    expect(JSON.parse(seen[0]?.body as string)).toMatchObject({ batchSeq: 0, sessionId: SESSION });
  });

  it.runIf(hasCompressionStream())('gzips bodies when CompressionStream exists', async () => {
    const seen: RequestInit[] = [];
    const transport = createTransport({
      endpoint: ENDPOINT,
      projectKey: PROJECT_KEY,
      sendBeacon: null,
      fetch: async (_url, init) => {
        seen.push(init);
        return { ok: true, status: 200 };
      },
    });
    transport.enqueue(batch(3));
    await transport.flush();
    expect((seen[0]?.headers as Record<string, string>)['content-encoding']).toBe('gzip');
    const body = seen[0]?.body as Uint8Array;
    expect(body).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(gunzipSync(Buffer.from(body)).toString('utf8'))).toMatchObject({ batchSeq: 3 });
  });
});

describe('beacon', () => {
  it('sends pending batches as text/plain blobs with the key in the query string', async () => {
    const sent: Array<{ url: string; blob: Blob }> = [];
    const transport = createTransport({
      endpoint: ENDPOINT,
      projectKey: PROJECT_KEY,
      gzip: false,
      fetch: async () => {
        throw new Error('fetch must not be used on the beacon path');
      },
      sendBeacon: (url, blob) => {
        sent.push({ url, blob });
        return true;
      },
    });
    transport.beacon(batch(0));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${INGEST_URL}?key=${encodeURIComponent(PROJECT_KEY)}`);
    expect(sent[0]?.blob.type).toBe('text/plain');
    expect(JSON.parse(await sent[0]!.blob.text())).toMatchObject({ batchSeq: 0 });
    expect(transport.pending()).toBe(0);
  });

  it('falls back to keepalive fetch when the beacon is refused', async () => {
    const fetch = fakeFetch();
    const transport = transportWith(fetch, { sendBeacon: () => false });
    transport.beacon(batch(7));
    await transport.flush();
    expect(fetch.uploads.map((u) => u.batch.batchSeq)).toEqual([7]);
  });
});
