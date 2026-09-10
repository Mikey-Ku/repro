import { describe, expect, it } from 'vitest';
import { routeForUrl, sanitizeBatch, sanitizeEvent } from '../../src/services/sanitize.js';
import { batch, ev, meta } from '../fixtures.js';

describe('server-side sanitisation', () => {
  it('strips secrets from urls, error text, console args and network errors', () => {
    const nav = sanitizeEvent(ev.nav(0, 'http://localhost:4100/account?token=CANARY_X&tab=1'));
    expect(JSON.stringify(nav)).not.toContain('CANARY_X');
    expect(nav.type === 'navigation' && nav.data.url).toBe('http://localhost:4100/account?token=%5Bredacted%5D&tab=1');

    const err = sanitizeEvent(ev.error(1, 'Request failed: Bearer CANARY_BEARER_Y', { stack: 'at x (http://h/app.js?apikey=CANARY_Z)' }));
    expect(JSON.stringify(err)).not.toContain('CANARY_BEARER_Y');
    expect(JSON.stringify(err)).not.toContain('CANARY_Z');

    const log = sanitizeEvent(ev.consoleError(2, 'password=CANARY_P', 'fine'));
    expect(JSON.stringify(log)).not.toContain('CANARY_P');
    expect(log.type === 'console' && log.data.args[1]).toBe('fine');

    const net = sanitizeEvent(ev.network(3, '/api/x?api_key=CANARY_K', 500, { url: 'http://localhost:4100/api/x?api_key=CANARY_K', error: 'Basic CANARY_B' }));
    expect(JSON.stringify(net)).not.toContain('CANARY_K');
    expect(JSON.stringify(net)).not.toContain('CANARY_B');
  });

  it('leaves events without secrets untouched', () => {
    for (const event of [ev.click(0, 'Pay'), ev.fill(1, 'email', 'a@b.c'), ev.rrweb(2), ev.identify(3, 'u_1')]) {
      expect(sanitizeEvent(event)).toEqual(event);
    }
  });

  it('sanitises the page url in meta and derives route templates', () => {
    const b = sanitizeBatch(batch('22222222-2222-4222-8222-222222222222', 0, [], { meta: meta({ page: { url: 'http://h/orders/42?session=CANARY_S', referrer: 'http://r/?sid=CANARY_R' } }) }));
    expect(JSON.stringify(b)).not.toContain('CANARY_S');
    expect(JSON.stringify(b)).not.toContain('CANARY_R');
    expect(routeForUrl('http://h/orders/42?x=1')).toBe('/orders/:id');
    expect(routeForUrl('http://h/users/5a3c1f2e-1111-4222-8333-444455556666/edit')).toBe('/users/:id/edit');
  });
});
