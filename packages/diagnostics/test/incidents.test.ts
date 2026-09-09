import { describe, expect, it } from 'vitest';
import { extractIncidents, normalizeMessage, topFrameFile } from '../src/index.js';
import { STARTED_AT, builder, serverErrorNoException, typeErrorAfterPost } from './fixtures/sessions.js';

const ctx = { startedAt: STARTED_AT };

describe('extractIncidents', () => {
  it('creates one exception incident and ignores the duplicate console error', () => {
    const incidents = extractIncidents(typeErrorAfterPost(), ctx);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      kind: 'exception',
      title: "TypeError: Cannot read properties of undefined (reading 'total')",
      firstSeq: 12,
      offsetMs: 8300,
      route: '/checkout',
    });
    expect(incidents[0]?.fingerprint).toMatch(/^[0-9a-f]{40}$/);
  });

  it('creates a network incident for a 500 and a console incident when nothing threw', () => {
    const incidents = extractIncidents(serverErrorNoException(), ctx);
    expect(incidents.map((i) => i.kind)).toEqual(['network', 'console']);
    expect(incidents[0]).toMatchObject({ title: 'GET /api/orders/:id failed (500)', route: '/orders/:id', firstSeq: 2 });
    expect(incidents[1]?.title).toBe('console.error: Failed to load order');
  });

  it('groups repeated errors with different ids into one fingerprint', () => {
    const ev = builder();
    const stack = (line: number) => `Error: x\n    at load (http://localhost:4100/assets/app.js:${line}:1)`;
    const events = [
      ev('error', { kind: 'exception', name: 'Error', message: 'Order 123 not found', stack: stack(10), handled: false }),
      ev('error', { kind: 'exception', name: 'Error', message: 'Order 456 not found', stack: stack(11), handled: false }),
      ev('error', { kind: 'exception', name: 'Error', message: 'Order 456 not found', stack: 'Error: x\n    at other (http://localhost:4100/assets/vendor.js:1:1)', handled: false }),
      ev('error', { kind: 'unhandledrejection', name: 'Error', message: 'Order 456 not found', stack: stack(10), handled: false }),
      ev('error', { kind: 'captured', name: 'Error', message: 'handled one', handled: true }),
    ];
    const incidents = extractIncidents(events, ctx);
    expect(incidents.map((i) => [i.kind, i.firstSeq])).toEqual([
      ['exception', 0],
      ['exception', 2],
      ['unhandledrejection', 3],
    ]);
  });

  it('fingerprints network failures by method, route template and status', () => {
    const ev = builder();
    const net = (path: string, status: number | null, error?: string) =>
      ev('network', { kind: 'fetch', method: 'GET', url: `http://x${path}`, path, status, ok: false, durationMs: 1, requestId: path, error });
    const incidents = extractIncidents([net('/api/items/1', 500), net('/api/items/2', 500), net('/api/items/3', 404), net('/api/ping', null, 'Failed to fetch')], ctx);
    expect(incidents.map((i) => i.title)).toEqual(['GET /api/items/:id failed (500)', 'GET /api/ping failed (Failed to fetch)']);
  });

  it('is deterministic', () => {
    expect(extractIncidents(typeErrorAfterPost(), ctx)).toEqual(extractIncidents(typeErrorAfterPost(), ctx));
  });
});

describe('helpers', () => {
  it('normalises digits and quoted strings', () => {
    expect(normalizeMessage("Cannot read 'total' of item 42\nsecond line")).toBe("Cannot read '?' of item #");
  });

  it('extracts the top frame file without line numbers', () => {
    expect(topFrameFile('TypeError: x\n    at fn (http://localhost:4100/assets/app.js:88:21)')).toBe('/assets/app.js');
    expect(topFrameFile('fn@http://localhost:4100/assets/app.js:88:21')).toBe('/assets/app.js');
    expect(topFrameFile('Error: x\n    at http://localhost:4100/assets/app.js:88:21')).toBe('/assets/app.js');
    expect(topFrameFile(undefined)).toBe('');
  });
});
