/**
 * fetch and XMLHttpRequest capture. We record the shape of a request (method, sanitised url,
 * status, duration) and nothing that could carry a credential: no headers, no bodies, no cookies.
 * The Response and Request objects are only read for `url`, `method`, `status` and `ok`.
 */
import { sanitizePath, sanitizeUrl, truncate, LIMITS, type NetworkEvent } from '@repro/contracts';
import { scrubAndTruncate } from '../redact.js';
import type { CaptureContext, Stop } from '../types.js';

type NetworkData = NetworkEvent['data'];

export function shortId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function absoluteUrl(raw: string): string {
  try {
    return new URL(raw, location.href).href;
  } catch {
    return raw;
  }
}

/** Uploads to our own ingest endpoint are skipped so the recording does not record itself. */
export function isOwnRequest(url: string, endpoint: string): boolean {
  const base = endpoint.replace(/\/+$/, '');
  return base.length > 0 && url.startsWith(base);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && typeof (input as Request).url === 'string') return (input as Request).url;
  return String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const fromInit = init?.method;
  if (typeof fromInit === 'string' && fromInit) return fromInit.toUpperCase();
  if (input && typeof input === 'object' && typeof (input as Request).method === 'string') {
    return (input as Request).method.toUpperCase();
  }
  return 'GET';
}

interface RequestRecord {
  kind: 'fetch' | 'xhr';
  method: string;
  url: string;
  startedAt: number;
  requestId: string;
}

function buildEvent(
  record: RequestRecord,
  result: { status: number | null; ok: boolean; error?: string },
): NetworkData {
  const absolute = absoluteUrl(record.url);
  const data: NetworkData = {
    kind: record.kind,
    method: truncate(record.method, 16),
    url: truncate(sanitizeUrl(absolute), LIMITS.maxUrlLength),
    path: truncate(sanitizePath(absolute), LIMITS.maxUrlLength),
    status: result.status,
    ok: result.ok,
    durationMs: Math.max(0, Math.round(now() - record.startedAt)),
    requestId: record.requestId,
  };
  if (result.error) data.error = scrubAndTruncate(result.error, LIMITS.maxMessageLength);
  return data;
}

function patchFetch(ctx: CaptureContext): Stop {
  if (typeof window.fetch !== 'function') return () => {};
  const original = window.fetch;
  const wrapped: typeof window.fetch = function reproFetch(this: unknown, input, init) {
    const url = requestUrl(input);
    if (isOwnRequest(absoluteUrl(url), ctx.endpoint)) return original.call(this ?? window, input, init);
    const record: RequestRecord = {
      kind: 'fetch',
      method: requestMethod(input, init),
      url,
      startedAt: now(),
      requestId: shortId(),
    };
    return original.call(this ?? window, input, init).then(
      (response) => {
        ctx.emit({ type: 'network', data: buildEvent(record, { status: response.status, ok: response.ok }) });
        return response;
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        ctx.emit({ type: 'network', data: buildEvent(record, { status: null, ok: false, error: message || 'network error' }) });
        throw err;
      },
    );
  };
  window.fetch = wrapped;
  return () => {
    if (window.fetch === wrapped) window.fetch = original;
  };
}

function patchXhr(ctx: CaptureContext): Stop {
  if (typeof XMLHttpRequest === 'undefined') return () => {};
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const records = new WeakMap<XMLHttpRequest, RequestRecord>();

  const wrappedOpen: typeof proto.open = function reproOpen(this: XMLHttpRequest, ...args: unknown[]) {
    const [method, url] = args as [string, string | URL];
    records.set(this, {
      kind: 'xhr',
      method: String(method ?? 'GET').toUpperCase(),
      url: url instanceof URL ? url.href : String(url ?? ''),
      startedAt: 0,
      requestId: shortId(),
    });
    return (originalOpen as (...a: unknown[]) => void).apply(this, args);
  };

  const wrappedSend: typeof proto.send = function reproSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const record = records.get(this);
    if (record && !isOwnRequest(absoluteUrl(record.url), ctx.endpoint)) {
      record.startedAt = now();
      let failure: string | undefined;
      const onFail = (label: string) => () => {
        failure = label;
      };
      this.addEventListener('error', onFail('network error'));
      this.addEventListener('abort', onFail('aborted'));
      this.addEventListener('timeout', onFail('timeout'));
      this.addEventListener('loadend', () => {
        const status = this.status > 0 ? this.status : null;
        const result = status === null
          ? { status: null, ok: false, error: failure ?? 'network error' }
          : { status, ok: status >= 200 && status < 300, ...(failure ? { error: failure } : {}) };
        ctx.emit({ type: 'network', data: buildEvent(record, result) });
      });
    }
    return originalSend.call(this, body);
  };

  proto.open = wrappedOpen;
  proto.send = wrappedSend;
  return () => {
    if (proto.open === wrappedOpen) proto.open = originalOpen;
    if (proto.send === wrappedSend) proto.send = originalSend;
  };
}

export function startNetwork(ctx: CaptureContext): Stop {
  const stops = [patchFetch(ctx), patchXhr(ctx)];
  return () => stops.forEach((stop) => stop());
}
