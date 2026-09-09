import type { ElementDescriptor, RecordedEvent } from '@repro/contracts';

export const STARTED_AT = 1_700_000_000_000;

export const el = (overrides: Partial<ElementDescriptor> & { tag: string }): ElementDescriptor => ({ sensitive: false, ...overrides });

/** Build events with increasing seq and ts. `at` is the offset from STARTED_AT in ms. */
export function builder() {
  let seq = 0;
  return (type: RecordedEvent['type'], data: unknown, at?: number): RecordedEvent => {
    const event = { seq, ts: STARTED_AT + (at ?? seq * 250), type, data } as RecordedEvent;
    seq += 1;
    return event;
  };
}

export const CANARY_TOKEN = 'ak_prod_CANARY1234567890abcdef';

/** Checkout flow: login, fill card, place order, POST succeeds with 200, then a TypeError. */
export function typeErrorAfterPost(): RecordedEvent[] {
  const ev = builder();
  const email = el({ tag: 'input', name: 'email', role: 'textbox', label: 'Email', type: 'email' });
  const card = el({ tag: 'input', name: 'cardNumber', role: 'textbox', label: 'Card number', sensitive: true });
  const placeOrder = el({ tag: 'button', role: 'button', type: 'submit', accessibleName: 'Place order' });
  return [
    ev('navigation', { url: 'http://localhost:4100/login', kind: 'load' }, 0),
    ev('rrweb', { type: 4, timestamp: STARTED_AT, data: {} }, 10),
    ev('rrweb', { type: 2, timestamp: STARTED_AT + 20, data: {} }, 20),
    ev('input', { target: email, kind: 'text', value: 'ada@example.com', masked: false }, 800),
    ev('click', { target: el({ tag: 'button', role: 'button', type: 'submit', text: 'Sign in' }) }, 1200),
    ev('network', { kind: 'fetch', method: 'POST', url: 'http://localhost:4100/api/login', path: '/api/login', status: 200, ok: true, durationMs: 60, requestId: 'r1' }, 1300),
    ev('navigation', { url: 'http://localhost:4100/checkout?token=abc', kind: 'push' }, 1400),
    ev('network', { kind: 'fetch', method: 'GET', url: 'http://localhost:4100/api/cart/12345', path: '/api/cart/12345', status: 200, ok: true, durationMs: 2600, requestId: 'r2' }, 1500),
    ev('input', { target: card, kind: 'text', value: null, masked: true }, 4000),
    ev('click', { target: placeOrder }, 8000),
    ev('submit', { target: el({ tag: 'form', id: 'checkout' }) }, 8010),
    ev('network', { kind: 'fetch', method: 'POST', url: 'http://localhost:4100/api/orders', path: '/api/orders', status: 200, ok: true, durationMs: 120, requestId: 'r3' }, 8200),
    ev(
      'error',
      {
        kind: 'exception',
        name: 'TypeError',
        message: "Cannot read properties of undefined (reading 'total')",
        stack: `TypeError: Cannot read properties of undefined (reading 'total')\n    at renderConfirmation (http://localhost:4100/assets/app.js:88:21)\n    at async placeOrder (http://localhost:4100/assets/app.js:120:5) token=${CANARY_TOKEN}`,
        handled: false,
        source: 'http://localhost:4100/assets/app.js',
        line: 88,
        column: 21,
      },
      8300,
    ),
    ev('console', { level: 'error', args: ["Uncaught TypeError: Cannot read properties of undefined (reading 'total')"] }, 8301),
    ev('click', { target: el({ tag: 'button', role: 'button', text: 'Retry' }) }, 11000),
  ];
}

/** A 500 from the API but the page swallowed it: no error event at all. */
export function serverErrorNoException(): RecordedEvent[] {
  const ev = builder();
  return [
    ev('navigation', { url: 'http://localhost:4100/orders/42', kind: 'load' }, 0),
    ev('click', { target: el({ tag: 'button', role: 'button', accessibleName: 'Refresh' }) }, 500),
    ev('network', { kind: 'xhr', method: 'GET', url: 'http://localhost:4100/api/orders/42', path: '/api/orders/42', status: 500, ok: false, durationMs: 30, requestId: 'r1' }, 600),
    ev('console', { level: 'error', args: ['Failed to load order', '500'] }, 610),
    ev('console', { level: 'warn', args: ['Retrying'] }, 620),
  ];
}
