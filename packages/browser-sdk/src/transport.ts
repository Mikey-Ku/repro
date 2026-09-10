/**
 * Upload path. Batches go out one at a time, in order, with bounded retries. The queue is
 * capped so a long outage cannot grow memory without limit: the oldest batches are dropped.
 */
import type { IngestBatch } from '@repro/contracts';
import type { DebugLog } from './types.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;
export type BeaconLike = (url: string, data: Blob) => boolean;

export interface TransportOptions {
  endpoint: string;
  projectKey: string;
  debug?: DebugLog;
  /** Injection points for tests. Defaults to the browser globals. */
  fetch?: FetchLike;
  sendBeacon?: BeaconLike | null;
  /** First retry delay; doubles each attempt. Default 500 ms. */
  baseDelayMs?: number;
  /** Total attempts per batch including the first. Default 5. */
  maxAttempts?: number;
  /** Pending batches kept when uploads fail. Default 50. */
  maxQueue?: number;
  /** Gzip request bodies when CompressionStream exists. Default true. */
  gzip?: boolean;
}

export interface Transport {
  /** Absolute ingest url, also used by network capture to skip our own requests. */
  readonly ingestUrl: string;
  /** Queue a batch and start uploading in the background. */
  enqueue(batch: IngestBatch): void;
  /** Resolve once the queue is empty and nothing is in flight. */
  flush(): Promise<void>;
  /** Unload path: hand every pending batch plus `extra` to sendBeacon. */
  beacon(extra?: IngestBatch): void;
  /** Number of batches waiting (tests). */
  pending(): number;
}

export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_MAX_QUEUE = 50;

/** 500 ms, 1 s, 2 s, 4 s, 8 s plus up to 20 percent jitter so retries from many tabs spread out. */
export function backoffDelay(attempt: number, baseMs = DEFAULT_BASE_DELAY_MS, random = Math.random): number {
  const delay = baseMs * 2 ** attempt;
  return Math.round(delay + delay * 0.2 * random());
}

/** Network errors, server errors and rate limits are retried; other 4xx are our fault, so we drop. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function hasCompressionStream(): boolean {
  return typeof CompressionStream === 'function' && typeof ReadableStream === 'function';
}

/** Gzip via the streams API, reading the compressed chunks back into one Uint8Array. */
export async function gzipString(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(new CompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export interface EncodedBody {
  body: string | Uint8Array;
  headers: Record<string, string>;
}

/** JSON, gzipped when the browser can do it. Falls back to plain JSON on any compression error. */
export async function encodeBody(json: string, gzip: boolean): Promise<EncodedBody> {
  if (gzip && hasCompressionStream()) {
    try {
      const compressed = await gzipString(json);
      return { body: compressed, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } };
    } catch {
      // fall through to plain JSON
    }
  }
  return { body: json, headers: { 'content-type': 'application/json' } };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createTransport(options: TransportOptions): Transport {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const ingestUrl = `${endpoint}/v1/ingest`;
  const debug: DebugLog = options.debug ?? (() => {});
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
  const gzip = options.gzip ?? true;
  const doFetch: FetchLike | null =
    options.fetch ?? (typeof fetch === 'function' ? (input, init) => fetch(input, init) : null);
  const doBeacon: BeaconLike | null =
    options.sendBeacon === undefined
      ? typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
        ? (url, data) => navigator.sendBeacon(url, data)
        : null
      : options.sendBeacon;

  const queue: IngestBatch[] = [];
  let draining: Promise<void> | null = null;
  let loggedClientError = false;

  async function upload(batch: IngestBatch): Promise<'ok' | 'retry' | 'drop'> {
    if (!doFetch) return 'drop';
    const encoded = await encodeBody(JSON.stringify(batch), gzip);
    try {
      const response = await doFetch(ingestUrl, {
        method: 'POST',
        headers: { ...encoded.headers, 'x-repro-key': options.projectKey },
        body: encoded.body as BodyInit,
        keepalive: true,
      });
      if (response.ok) return 'ok';
      if (isRetryableStatus(response.status)) return 'retry';
      if (!loggedClientError) {
        loggedClientError = true;
        debug(`ingest rejected batch ${batch.batchSeq} with status ${response.status}; dropping`);
      }
      return 'drop';
    } catch (err) {
      debug('upload failed', err);
      return 'retry';
    }
  }

  async function sendWithRetry(batch: IngestBatch): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const outcome = await upload(batch);
      if (outcome !== 'retry') return;
      if (attempt < maxAttempts - 1) await sleep(backoffDelay(attempt, baseDelayMs));
    }
    debug(`gave up on batch ${batch.batchSeq} after ${maxAttempts} attempts`);
  }

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.shift();
      if (batch) await sendWithRetry(batch);
    }
  }

  function kick(): void {
    if (draining) return;
    draining = drain().finally(() => {
      draining = null;
      if (queue.length > 0) kick();
    });
  }

  return {
    ingestUrl,
    enqueue(batch) {
      queue.push(batch);
      while (queue.length > maxQueue) {
        const dropped = queue.shift();
        debug(`pending queue full, dropped batch ${dropped?.batchSeq}`);
      }
      kick();
    },
    async flush() {
      kick();
      while (draining) await draining;
    },
    beacon(extra) {
      const batches = queue.splice(0);
      if (extra) batches.push(extra);
      for (const batch of batches) {
        let sent = false;
        if (doBeacon) {
          try {
            // text/plain keeps the request "simple" so the browser skips the CORS preflight during unload.
            const key = encodeURIComponent(options.projectKey);
            sent = doBeacon(`${ingestUrl}?key=${key}`, new Blob([JSON.stringify(batch)], { type: 'text/plain' }));
          } catch (err) {
            debug('sendBeacon threw', err);
          }
        }
        // Beacon can refuse (payload too large, unsupported); keepalive fetch is the next best thing.
        if (!sent) this.enqueue(batch);
      }
    },
    pending() {
      return queue.length;
    },
  };
}
