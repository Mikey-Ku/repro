import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type { EvidenceSummary } from '@repro/contracts';
import { PlayerControlsForTests, type PlayerControls } from '@/components/session/PlayerContext';
import type { TimelineEntry } from '@/lib/schemas';

/**
 * Shared fixtures. The strings below are shaped like attacks on purpose: the
 * dashboard must render recorded values as text, never as markup.
 */

export const XSS_IMG = '<img src=x onerror="window.__xss=1">';
export const XSS_SCRIPT = '<script>window.__xss=1</script>';

export function mockControls(): PlayerControls {
  return { seekTo: vi.fn(), register: vi.fn(() => () => {}), reportTime: vi.fn() };
}

export function withControls(controls: PlayerControls, children: ReactNode) {
  return <PlayerControlsForTests controls={controls}>{children}</PlayerControlsForTests>;
}

const T0 = 1_757_400_000_000;

export const timelineFixture: TimelineEntry[] = [
  {
    seq: 1,
    ts: T0 + 100,
    offsetMs: 100,
    kind: 'navigation',
    severity: 'info',
    title: 'Navigated (load)',
    detail: '/checkout',
    event: { seq: 1, ts: T0 + 100, type: 'navigation', data: { url: 'http://demo.local/checkout', kind: 'load' } },
  },
  {
    seq: 2,
    ts: T0 + 1500,
    offsetMs: 1500,
    kind: 'click',
    severity: 'info',
    title: `Clicked button "${XSS_IMG}"`,
    event: { seq: 2, ts: T0 + 1500, type: 'click', data: { target: { tag: 'button', text: XSS_IMG, sensitive: false } } },
  },
  {
    seq: 3,
    ts: T0 + 2000,
    offsetMs: 2000,
    kind: 'network',
    severity: 'error',
    title: `POST /api/orders?q=${XSS_SCRIPT} → 500`,
    detail: '2100 ms',
    event: {
      seq: 3,
      ts: T0 + 2000,
      type: 'network',
      data: { kind: 'fetch', method: 'POST', url: 'http://demo.local/api/orders', path: `/api/orders?q=${XSS_SCRIPT}`, status: 500, ok: false, durationMs: 2100, requestId: 'r1' },
    },
  },
  {
    seq: 4,
    ts: T0 + 2050,
    offsetMs: 2050,
    kind: 'console',
    severity: 'error',
    title: 'console.error',
    detail: `Order failed ${XSS_SCRIPT}`,
    event: { seq: 4, ts: T0 + 2050, type: 'console', data: { level: 'error', args: ['Order failed', XSS_SCRIPT] } },
  },
  {
    seq: 5,
    ts: T0 + 2100,
    offsetMs: 2100,
    kind: 'error',
    severity: 'error',
    title: `TypeError: Cannot read properties of undefined ${XSS_IMG}`,
    detail: `TypeError: boom ${XSS_IMG}\n    at submit (app.js:10:5)`,
    event: {
      seq: 5,
      ts: T0 + 2100,
      type: 'error',
      data: { kind: 'exception', name: 'TypeError', message: `Cannot read properties of undefined ${XSS_IMG}`, stack: `TypeError: boom ${XSS_IMG}\n    at submit (app.js:10:5)`, handled: false },
    },
  },
];

export const evidenceFixture: EvidenceSummary = {
  version: 1,
  route: '/checkout',
  release: '1.0.0',
  browser: 'Chrome 128',
  earliestError: {
    ref: { seq: 5, ts: T0 + 2100, offsetMs: 2100, label: 'TypeError' },
    name: 'TypeError',
    message: `Cannot read properties of undefined ${XSS_IMG}`,
    stack: `TypeError: boom\n    at submit (app.js:10:5) ${XSS_SCRIPT}`,
    kind: 'exception',
  },
  failedRequests: [{ ref: { seq: 3, ts: T0 + 2000, offsetMs: 2000, label: 'POST /api/orders' }, method: 'POST', path: `/api/orders?q=${XSS_SCRIPT}`, status: 500, durationMs: 2100 }],
  slowRequests: [{ ref: { seq: 3, ts: T0 + 2000, offsetMs: 2000, label: 'POST /api/orders' }, method: 'POST', path: '/api/orders', status: 500, durationMs: 2100 }],
  lastActions: [{ ref: { seq: 2, ts: T0 + 1500, offsetMs: 1500, label: 'click' }, description: `Clicked button "${XSS_IMG}"` }],
  consoleErrors: [{ ref: { seq: 4, ts: T0 + 2050, offsetMs: 2050, label: 'console.error' }, level: 'error', message: `Order failed ${XSS_SCRIPT}` }],
  requestsBeforeError: [{ ref: { seq: 3, ts: T0 + 2000, offsetMs: 2000, label: 'POST /api/orders' }, method: 'POST', path: '/api/orders', status: 500, ok: false }],
  gaps: ['Response bodies are never captured, so the server error message is unknown.', 'No identify call was made, so the user is anonymous.'],
  stats: { events: 42, errors: 1, requests: 3, actions: 4, durationMs: 2500 },
};
