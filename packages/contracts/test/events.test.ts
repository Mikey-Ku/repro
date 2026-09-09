import { describe, expect, it } from 'vitest';
import { IngestBatchSchema, LIMITS, RecordedEventSchema } from '../src/index.js';

const meta = {
  startedAt: 1_700_000_000_000,
  sdkVersion: '0.1.0',
  browser: { name: 'Chrome', version: '130', userAgent: 'UA' },
  viewport: { width: 1280, height: 720 },
  page: { url: 'http://localhost:4100/login' },
};

describe('RecordedEventSchema', () => {
  it('accepts every event type', () => {
    const target = { tag: 'button', text: 'Place order', role: 'button', accessibleName: 'Place order', sensitive: false };
    const events = [
      { seq: 0, ts: 1, type: 'rrweb', data: { type: 4, timestamp: 1, data: {} } },
      { seq: 1, ts: 1, type: 'navigation', data: { url: 'http://x/', kind: 'load' } },
      { seq: 2, ts: 1, type: 'click', data: { target } },
      { seq: 3, ts: 1, type: 'input', data: { target, kind: 'text', value: 'a', masked: false } },
      { seq: 4, ts: 1, type: 'submit', data: { target } },
      { seq: 5, ts: 1, type: 'error', data: { kind: 'exception', message: 'boom', handled: false } },
      { seq: 6, ts: 1, type: 'console', data: { level: 'error', args: ['x'] } },
      { seq: 7, ts: 1, type: 'network', data: { kind: 'fetch', method: 'GET', url: 'http://x/a', path: '/a', status: 200, ok: true, durationMs: 3, requestId: 'r1' } },
      { seq: 8, ts: 1, type: 'annotation', data: { name: 'step', data: { n: 1 } } },
      { seq: 9, ts: 1, type: 'identify', data: { userId: 'u_1' } },
    ];
    for (const event of events) {
      const parsed = RecordedEventSchema.safeParse(event);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    }
  });

  it('rejects unknown types, negative seq and oversize strings', () => {
    expect(RecordedEventSchema.safeParse({ seq: 0, ts: 1, type: 'evil', data: {} }).success).toBe(false);
    expect(RecordedEventSchema.safeParse({ seq: -1, ts: 1, type: 'console', data: { level: 'error', args: [] } }).success).toBe(false);
    expect(
      RecordedEventSchema.safeParse({
        seq: 0,
        ts: 1,
        type: 'error',
        data: { kind: 'exception', message: 'x'.repeat(LIMITS.maxMessageLength + 1), handled: false },
      }).success,
    ).toBe(false);
  });
});

describe('IngestBatchSchema', () => {
  it('accepts a well-formed batch', () => {
    const batch = {
      v: 1,
      sessionId: '3f1c2a7e-1b2c-4d5e-8f90-abcdef123456',
      batchSeq: 0,
      sentAt: 1_700_000_000_500,
      meta,
      events: [{ seq: 0, ts: 1_700_000_000_100, type: 'navigation', data: { url: 'http://x/', kind: 'load' } }],
    };
    expect(IngestBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('rejects a batch with too many events or a bad session id', () => {
    const events = Array.from({ length: LIMITS.maxEventsPerBatch + 1 }, (_, i) => ({
      seq: i,
      ts: 1,
      type: 'console',
      data: { level: 'error', args: [] },
    }));
    expect(IngestBatchSchema.safeParse({ v: 1, sessionId: '3f1c2a7e-1b2c-4d5e-8f90-abcdef123456', batchSeq: 0, sentAt: 1, events }).success).toBe(false);
    expect(IngestBatchSchema.safeParse({ v: 1, sessionId: 'not-a-uuid', batchSeq: 0, sentAt: 1, events: [] }).success).toBe(false);
  });
});
