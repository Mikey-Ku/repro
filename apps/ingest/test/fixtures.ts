import type { IngestBatch, RecordedEvent, SessionMeta } from '@repro/contracts';

/** A fixed session start so timestamps in tests are readable and deterministic. */
export const T0 = 1_700_000_000_000;

const ts = (seq: number): number => T0 + seq * 100;

export function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    startedAt: T0,
    sdkVersion: '0.1.0',
    release: 'v1.0.0',
    browser: { name: 'Chrome', version: '130', userAgent: 'Mozilla/5.0 test' },
    os: 'macOS',
    viewport: { width: 1280, height: 720 },
    page: { url: 'http://localhost:4100/login' },
    ...overrides,
  };
}

const button = (text: string) => ({ tag: 'button', type: 'submit', role: 'button', accessibleName: text, text, sensitive: false });

export const ev = {
  nav(seq: number, url: string, kind: 'load' | 'push' | 'replace' | 'pop' | 'hash' = 'load'): RecordedEvent {
    return { seq, ts: ts(seq), type: 'navigation', data: { url, kind } };
  },
  click(seq: number, text: string): RecordedEvent {
    return { seq, ts: ts(seq), type: 'click', data: { target: button(text) } };
  },
  fill(seq: number, name: string, value: string, label = name): RecordedEvent {
    return {
      seq,
      ts: ts(seq),
      type: 'input',
      data: { target: { tag: 'input', type: 'text', name, label, sensitive: false }, kind: 'text', value, masked: false },
    };
  },
  error(seq: number, message: string, options: { handled?: boolean; name?: string; stack?: string } = {}): RecordedEvent {
    return {
      seq,
      ts: ts(seq),
      type: 'error',
      data: { kind: 'exception', name: options.name ?? 'TypeError', message, handled: options.handled ?? false, stack: options.stack },
    };
  },
  network(seq: number, path: string, status: number | null, options: { ok?: boolean; url?: string; error?: string; durationMs?: number } = {}): RecordedEvent {
    return {
      seq,
      ts: ts(seq),
      type: 'network',
      data: {
        kind: 'fetch',
        method: 'GET',
        url: options.url ?? `http://localhost:4100${path}`,
        path,
        status,
        ok: options.ok ?? (status !== null && status < 400),
        durationMs: options.durationMs ?? 20,
        error: options.error,
        requestId: `r${seq}`,
      },
    };
  },
  consoleError(seq: number, ...args: string[]): RecordedEvent {
    return { seq, ts: ts(seq), type: 'console', data: { level: 'error', args } };
  },
  rrweb(seq: number): RecordedEvent {
    return { seq, ts: ts(seq), type: 'rrweb', data: { type: 3, timestamp: ts(seq), data: { source: 0 } } };
  },
  identify(seq: number, userId: string): RecordedEvent {
    return { seq, ts: ts(seq), type: 'identify', data: { userId } };
  },
};

export function batch(
  sessionId: string,
  batchSeq: number,
  events: RecordedEvent[],
  extra: { meta?: SessionMeta; final?: boolean } = {},
): IngestBatch {
  return {
    v: 1,
    sessionId,
    batchSeq,
    sentAt: T0 + 10_000 + batchSeq,
    events,
    ...(extra.meta ? { meta: extra.meta } : {}),
    ...(extra.final !== undefined ? { final: extra.final } : {}),
  };
}
