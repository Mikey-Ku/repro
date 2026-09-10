/**
 * Shared test harness. The SDK is driven exactly as a page would drive it, but the upload path
 * is a fake fetch that decodes and validates every outbound body so tests can grep them.
 */
import { gunzipSync } from 'node:zlib';
import { IngestBatchSchema, type IngestBatch, type RecordedEvent } from '@repro/contracts';
import { createClient, type ClientDeps } from '../src/client.js';
import type { ReproClient, ReproOptions } from '../src/types.js';

export const PROJECT_KEY = 'rp_test_0123456789abcdefghijklmn';
export const ENDPOINT = 'http://ingest.test:4000';
export const INGEST_URL = `${ENDPOINT}/v1/ingest`;

export interface Upload {
  url: string;
  headers: Record<string, string>;
  /** Whether the body arrived as bytes (gzip) or as a JSON string. */
  bodyType: 'bytes' | 'string';
  /** Decoded JSON text of the body (gunzipped when the request said gzip). */
  json: string;
  batch: IngestBatch;
}

export interface FakeFetch {
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;
  uploads: Upload[];
  /** Status to answer with; a function lets a test script a sequence. */
  respond: (call: number) => number | 'network-error';
  /** Bodies that failed IngestBatchSchema. Tests assert this stays empty. */
  errors: string[];
  calls: number;
  /** Every serialised body joined, for canary grepping. */
  text(): string;
  events(): RecordedEvent[];
}

function decodeBody(body: unknown, headers: Record<string, string>): { json: string; bodyType: Upload['bodyType'] } {
  if (typeof body === 'string') return { json: body, bodyType: 'string' };
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
  if (headers['content-encoding'] === 'gzip') {
    return { json: gunzipSync(Buffer.from(bytes)).toString('utf8'), bodyType: 'bytes' };
  }
  return { json: new TextDecoder().decode(bytes), bodyType: 'bytes' };
}

export function fakeFetch(respond: FakeFetch['respond'] = () => 200): FakeFetch {
  const uploads: Upload[] = [];
  const api: FakeFetch = {
    uploads,
    respond,
    errors: [],
    calls: 0,
    async fetch(url, init) {
      const call = api.calls++;
      const headers = Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
      );
      const { json, bodyType } = decodeBody(init.body, headers);
      const parsed = IngestBatchSchema.safeParse(JSON.parse(json));
      if (!parsed.success) {
        api.errors.push(JSON.stringify(parsed.error.issues));
        return { ok: false, status: 400 };
      }
      uploads.push({ url, headers, bodyType, json, batch: parsed.data });
      const status = api.respond(call);
      if (status === 'network-error') throw new TypeError('Failed to fetch');
      return { ok: status >= 200 && status < 300, status };
    },
    text: () => uploads.map((u) => u.json).join('\n'),
    events: () => uploads.flatMap((u) => u.batch.events),
  };
  return api;
}

export interface Harness {
  client: ReproClient;
  fetch: FakeFetch;
}

/**
 * Clients created by makeClient. rrweb keeps its emit function in module state, so a recorder
 * that is never stopped would keep feeding the next test's recorder; resetDom stops them all.
 */
const liveClients: ReproClient[] = [];

/** A client wired to the fake fetch with instant retries. rrweb is on unless a test turns it off. */
export function makeClient(options: Partial<ReproOptions> = {}, deps: ClientDeps = {}): Harness {
  const fetch = fakeFetch();
  const client = createClient(
    { projectKey: PROJECT_KEY, endpoint: ENDPOINT, autoStart: false, flushIntervalMs: 60_000, ...options },
    {
      ...deps,
      transport: { fetch: fetch.fetch, sendBeacon: null, baseDelayMs: 1, ...deps.transport },
    },
  );
  liveClients.push(client);
  return { client, fetch };
}

const originalFetch = window.fetch;
const originalXhrSend = XMLHttpRequest.prototype.send;

export function resetDom(): void {
  for (const client of liveClients.splice(0)) client.stop();
  document.body.innerHTML = '';
  document.title = '';
  window.fetch = originalFetch;
  XMLHttpRequest.prototype.send = originalXhrSend;
  history.replaceState({}, '', '/');
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
}

export function html(markup: string): void {
  document.body.innerHTML = markup;
}

export function $<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  return el;
}

/** Fire a DOM event the way a user would: bubbling and cancelable. */
export function fire(el: Element, type: string, init: Record<string, unknown> = {}): void {
  const Ctor = type === 'click' ? MouseEvent : Event;
  el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }));
}

export function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  el.value = value;
  fire(el, 'input');
  fire(el, 'change');
}

export function setChecked(el: HTMLInputElement, checked: boolean): void {
  el.checked = checked;
  fire(el, 'input');
  fire(el, 'change');
}

export const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function ofType<T extends RecordedEvent['type']>(events: RecordedEvent[], type: T): Extract<RecordedEvent, { type: T }>[] {
  return events.filter((e): e is Extract<RecordedEvent, { type: T }> => e.type === type);
}

/**
 * A page-level fetch that never touches the network. It records what the page sent so tests
 * can prove the SDK saw headers and bodies go past without capturing them.
 */
export interface PageFetchCall {
  url: string;
  init: RequestInit | undefined;
}

export function installPageFetch(responseBody: string, status = 200): PageFetchCall[] {
  const calls: PageFetchCall[] = [];
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json', 'x-secret-header': responseBody }),
      text: async () => responseBody,
      json: async () => JSON.parse(responseBody) as unknown,
    } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

/** Replace XMLHttpRequest.send with a stub that completes with the given status and no network. */
export function installPageXhr(status = 200): void {
  XMLHttpRequest.prototype.send = function fakeSend(this: XMLHttpRequest) {
    Object.defineProperty(this, 'status', { value: status, configurable: true });
    setTimeout(() => {
      this.dispatchEvent(new Event('load'));
      this.dispatchEvent(new Event('loadend'));
    }, 0);
  };
}
