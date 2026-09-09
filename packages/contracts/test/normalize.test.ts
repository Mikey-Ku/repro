import { describe, expect, it } from 'vitest';
import { buildTimeline, normalizeEvents, type RecordedEvent } from '../src/index.js';

const t = (overrides: Partial<RecordedEvent['type'] extends never ? never : { tag: string; name?: string; type?: string; text?: string; label?: string; id?: string; testId?: string; sensitive?: boolean; formId?: string }>) => ({
  tag: 'input',
  sensitive: false,
  ...overrides,
});

let seq = 0;
const ev = (type: RecordedEvent['type'], data: unknown, ts = 1000 + seq * 100): RecordedEvent =>
  ({ seq: seq++, ts, type, data }) as RecordedEvent;

describe('normalizeEvents', () => {
  it('collapses a realistic login and checkout flow into readable actions', () => {
    seq = 0;
    const email = t({ tag: 'input', name: 'email', label: 'Email', type: 'email' });
    const password = t({ tag: 'input', name: 'password', label: 'Password', type: 'password', sensitive: true });
    const signIn = t({ tag: 'button', type: 'submit', text: 'Sign in' });
    const form = t({ tag: 'form', id: 'login' });
    const events: RecordedEvent[] = [
      ev('navigation', { url: 'http://demo/login', kind: 'load' }),
      ev('rrweb', { type: 4, timestamp: 1, data: {} }),
      ev('click', { target: email }),
      ev('input', { target: email, kind: 'text', value: 'ada@example.com', masked: false }),
      ev('input', { target: email, kind: 'text', value: 'ada@example.org', masked: false }),
      ev('click', { target: password }),
      ev('input', { target: password, kind: 'text', value: null, masked: true }),
      ev('click', { target: signIn }),
      ev('submit', { target: form }),
      ev('network', { kind: 'fetch', method: 'POST', url: 'http://demo/api/login', path: '/api/login', status: 200, ok: true, durationMs: 40, requestId: 'r1' }),
      ev('navigation', { url: 'http://demo/checkout?token=[redacted]', kind: 'push' }),
      ev('input', { target: t({ tag: 'select', name: 'shipping', label: 'Shipping' }), kind: 'select', value: 'express', masked: false }),
      ev('input', { target: t({ tag: 'input', type: 'checkbox', name: 'save', label: 'Save card' }), kind: 'checkbox', value: 'on', masked: false, checked: true }),
      ev('error', { kind: 'exception', message: 'Cannot read properties of undefined', name: 'TypeError', handled: false }),
    ];

    const result = normalizeEvents(events);
    expect(result.actions.map((a) => a.kind)).toEqual([
      'navigate',
      'fill',
      'fill',
      'click',
      'expect-url',
      'select',
      'check',
    ]);
    const fills = result.actions.filter((a) => a.kind === 'fill');
    expect(fills[0]).toMatchObject({ value: 'ada@example.org', masked: false });
    expect(fills[1]).toMatchObject({ value: null, masked: true });
    expect(result.omitted.map((o) => o.type)).toEqual(['click', 'input', 'click', 'submit']);
    expect(result.firstError?.data.message).toContain('undefined');
  });

  it('turns an Enter-key submit into press-enter on the last filled control', () => {
    seq = 0;
    const search = t({ tag: 'input', name: 'q', label: 'Search' });
    const result = normalizeEvents([
      ev('navigation', { url: 'http://demo/', kind: 'load' }),
      ev('input', { target: search, kind: 'text', value: 'boots', masked: false }),
      ev('submit', { target: t({ tag: 'form', id: 'search' }) }),
    ]);
    expect(result.actions.map((a) => a.kind)).toEqual(['navigate', 'fill', 'press-enter']);
  });

  it('is order-independent for the same seq numbers', () => {
    seq = 0;
    const a = ev('navigation', { url: 'http://demo/', kind: 'load' });
    const b = ev('click', { target: t({ tag: 'button', text: 'Go' }) });
    expect(normalizeEvents([b, a])).toEqual(normalizeEvents([a, b]));
  });
});

describe('buildTimeline', () => {
  it('produces severity and offsets and skips rrweb events', () => {
    seq = 0;
    const entries = buildTimeline(
      [
        ev('rrweb', { type: 2, timestamp: 1, data: {} }, 1000),
        ev('network', { kind: 'xhr', method: 'GET', url: 'http://demo/api/x', path: '/api/x', status: 500, ok: false, durationMs: 12, requestId: 'r' }, 1500),
        ev('console', { level: 'warn', args: ['careful'] }, 1600),
        ev('error', { kind: 'exception', message: 'boom', handled: false }, 1700),
      ],
      1000,
    );
    expect(entries.map((e) => [e.kind, e.severity, e.offsetMs])).toEqual([
      ['network', 'error', 500],
      ['console', 'warn', 600],
      ['error', 'error', 700],
    ]);
  });
});
