import { describe, expect, it } from 'vitest';
import { EvidenceSummarySchema } from '@repro/contracts';
import { summarizeEvidence } from '../src/index.js';
import { STARTED_AT, serverErrorNoException, typeErrorAfterPost } from './fixtures/sessions.js';

const ctx = { startedAt: STARTED_AT, release: '1.2.3', browser: 'Chrome' };

describe('summarizeEvidence', () => {
  it('summarises a TypeError after a successful POST', () => {
    const summary = summarizeEvidence(typeErrorAfterPost(), ctx);
    expect(EvidenceSummarySchema.parse(summary)).toEqual(summary);

    expect(summary.route).toBe('/login');
    expect(summary.release).toBe('1.2.3');
    expect(summary.browser).toBe('Chrome');

    expect(summary.earliestError).toMatchObject({
      name: 'TypeError',
      kind: 'exception',
      ref: { seq: 12, ts: STARTED_AT + 8300, offsetMs: 8300 },
    });
    expect(summary.earliestError?.ref.label).toContain('TypeError');

    // Actions stop at the error: the "Retry" click after it is not listed.
    expect(summary.lastActions.map((a) => a.description)).toEqual([
      'Navigated to /login',
      'Filled textbox "Email" ("ada@example.com")',
      'Clicked button "Sign in"',
      'Navigated to /checkout?token=%5Bredacted%5D',
      'Filled textbox "Card number" ([masked])',
      'Clicked button "Place order"',
    ]);
    expect(summary.lastActions.every((a) => a.ref.seq < 12)).toBe(true);

    // Only the order POST falls in the 5 s window before the error.
    expect(summary.requestsBeforeError).toEqual([
      expect.objectContaining({ method: 'POST', path: '/api/orders', status: 200, ok: true }),
    ]);
    expect(summary.failedRequests).toEqual([]);
    expect(summary.slowRequests).toEqual([expect.objectContaining({ path: '/api/cart/12345', durationMs: 2600 })]);
    expect(summary.consoleErrors).toHaveLength(1);
    expect(summary.gaps).toEqual([]);
    expect(summary.stats).toEqual({ events: 15, errors: 1, requests: 3, actions: 7, durationMs: 11000 });
  });

  it('describes the gap when a 500 happened but nothing threw', () => {
    const summary = summarizeEvidence(serverErrorNoException(), { startedAt: STARTED_AT, status: 'recording' });
    expect(summary.earliestError).toBeNull();
    expect(summary.route).toBe('/orders/:id');
    expect(summary.failedRequests).toEqual([expect.objectContaining({ method: 'GET', path: '/api/orders/42', status: 500 })]);
    expect(summary.requestsBeforeError).toEqual([]);
    expect(summary.consoleErrors.map((c) => c.level)).toEqual(['error', 'warn']);
    expect(summary.gaps).toEqual([
      'No uncaught error was recorded; the failure may be visual only.',
      'The session was still recording when captured; later events may be missing.',
    ]);
  });

  it('returns nulls and gaps for an empty session', () => {
    const summary = summarizeEvidence([], { startedAt: STARTED_AT });
    expect(summary).toMatchObject({
      route: null,
      release: null,
      browser: null,
      earliestError: null,
      failedRequests: [],
      slowRequests: [],
      lastActions: [],
      consoleErrors: [],
      requestsBeforeError: [],
      stats: { events: 0, errors: 0, requests: 0, actions: 0, durationMs: 0 },
    });
    expect(summary.gaps).toContain('No events were recorded for this session.');
    expect(summary.gaps).toContain('No uncaught error was recorded; the failure may be visual only.');
  });

  it('flags a missing stack trace and missing actions before the error', () => {
    const summary = summarizeEvidence(
      [{ seq: 0, ts: STARTED_AT + 100, type: 'error', data: { kind: 'exception', message: 'boom', handled: false } }],
      { startedAt: STARTED_AT },
    );
    expect(summary.gaps).toEqual([
      'No navigation was recorded, so the route is unknown.',
      'No network request completed within 5 s before the error.',
      'No user actions were recorded before the error.',
      'The recorded stack trace is missing, so the failing source location is unknown.',
    ]);
  });

  it('is deterministic and order independent', () => {
    const a = summarizeEvidence(typeErrorAfterPost(), ctx);
    const b = summarizeEvidence([...typeErrorAfterPost()].reverse(), ctx);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(summarizeEvidence(typeErrorAfterPost(), ctx)));
  });
});
