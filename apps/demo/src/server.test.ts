import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { parseDotEnv } from './env.js';
import { demoRoot } from './paths.js';

const canaries = JSON.parse(readFileSync(path.join(demoRoot, 'canaries.json'), 'utf8')) as Record<string, string>;

const validOrder = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  address: '12 Analytical Engine Way',
  city: 'London',
  postalCode: 'W1 1AA',
  shipping: 'express',
  cardNumber: canaries.cardNumber,
  cvc: canaries.cvc,
  expiry: canaries.expiry,
  saveCard: true,
  promoCode: '',
  apiKey: canaries.apiKey,
};

function makeApp(mode: 'broken' | 'fixed' = 'broken') {
  return createApp({
    mode,
    projectKey: 'rp_test_0123456789abcdefghijklmn',
    ingestUrl: 'http://localhost:4000',
    release: 'demo@test',
    latencyMs: [0, 0],
  });
}

describe('demo server', () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('login sets the canary cookie and returns the canary token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { email: 'ada@example.com', password: canaries.password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toContain(`demo_session=${canaries.cookie}`);
    expect(res.headers['set-cookie']).not.toMatch(/httponly/i);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, token: canaries.token, user: { id: 'usr_1042', name: 'Ada Lovelace' } });
    expect(res.body).not.toContain(canaries.password);
  });

  it('login rejects short passwords', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'a@b.co', password: 'short' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it('cart requires the bearer token', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/cart' });
    expect(denied.statusCode).toBe(401);
    const wrong = await app.inject({ method: 'GET', url: '/api/cart', headers: { authorization: 'Bearer nope' } });
    expect(wrong.statusCode).toBe(401);

    const res = await app.inject({ method: 'GET', url: '/api/cart', headers: { authorization: canaries.bearerHeader } });
    expect(res.statusCode).toBe(200);
    const cart = res.json();
    expect(cart.items).toHaveLength(2);
    expect(cart.items[0]).toMatchObject({ name: 'Field notebook, dotted', quantity: 3, unitPrice: 1200 });
    expect(cart.items[1]).toMatchObject({ name: 'Brass mechanical pencil', quantity: 1, unitPrice: 3800 });
    expect(cart.subtotal).toBe(7400);
    expect(cart.shippingOptions.map((o: { id: string; price: number }) => [o.id, o.price])).toEqual([
      ['standard', 0],
      ['express', 900],
    ]);
  });

  it('orders require the bearer token and validate the body', async () => {
    const denied = await app.inject({ method: 'POST', url: '/api/orders', payload: validOrder });
    expect(denied.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: canaries.bearerHeader },
      payload: { ...validOrder, address: '', cardNumber: '1234', cvc: '12' },
    });
    expect(missing.statusCode).toBe(400);
    const issues = missing.json().issues.map((i: { path: string }) => i.path);
    expect(issues).toEqual(expect.arrayContaining(['address', 'cardNumber', 'cvc']));
  });

  it('orders accept redacted placeholders and return the nested order id plus the response canary', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: canaries.bearerHeader },
      payload: { ...validOrder, cardNumber: '[REDACTED_CARD]', cvc: '[RE]' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.order.id).toMatch(/^ord_[a-z0-9]{6}$/);
    expect(body.order).toMatchObject({ total: 8300, totalFormatted: '$83.00', currency: 'USD', eta: 'Thu 12 Sep' });
    expect(body.meta.apiKey).toBe(canaries.responseSecret);
    // The bug is a shape mismatch in the frontend: a flat orderId must never exist on the API.
    expect(body.orderId).toBeUndefined();
  });

  it('applies the WELCOME10 promo code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: canaries.bearerHeader },
      payload: { ...validOrder, shipping: 'standard', promoCode: 'welcome10' },
    });
    expect(res.json().order.total).toBe(6660);
  });

  it('switches mode and rejects bad values', async () => {
    expect((await app.inject({ method: 'GET', url: '/__demo/mode' })).json()).toEqual({ mode: 'broken' });
    expect((await app.inject({ method: 'GET', url: '/__demo/health' })).json()).toEqual({ ok: true, mode: 'broken' });

    const bad = await app.inject({ method: 'POST', url: '/__demo/mode', payload: { mode: 'sideways' } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/__demo/mode' })).json()).toEqual({ mode: 'broken' });

    const ok = await app.inject({ method: 'POST', url: '/__demo/mode', payload: { mode: 'fixed' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ mode: 'fixed' });
    expect((await app.inject({ method: 'GET', url: '/__demo/health' })).json()).toEqual({ ok: true, mode: 'fixed' });
    expect((await app.inject({ method: 'GET', url: '/checkout' })).body).toContain('data-testid="demo-mode">fixed<');
  });

  it('redirects / to /login and renders the login page', async () => {
    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(302);
    expect(root.headers.location).toBe('/login');

    const res = await app.inject({ method: 'GET', url: '/login' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('data-testid="login-form"');
    expect(res.body).toContain('data-testid="sign-in"');
    expect(res.body).toContain('<label for="email">Email</label>');
    expect(res.body).toContain('<label for="password">Password</label>');
    expect(res.body).toContain('autocomplete="current-password"');
    expect(res.body).toContain('src="/vendor/repro.iife.js"');
    expect(res.body).toContain('src="/app.js"');
  });

  it('renders the checkout page with the SDK config and the planted canaries', async () => {
    const res = await app.inject({ method: 'GET', url: `/checkout?ref=email&token=${canaries.queryToken}` });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    for (const testid of ['checkout-form', 'order-summary', 'place-order', 'support-chat', 'account-label']) {
      expect(html).toContain(`data-testid="${testid}"`);
    }
    expect(html).toContain('<h1>Checkout</h1>');
    expect(html).toContain(`window.__DEMO__ = {"projectKey":"rp_test_0123456789abcdefghijklmn","endpoint":"http://localhost:4000","mode":"broken","release":"demo@test"}`);
    // Hidden API key input
    expect(html).toContain(`<input type="hidden" name="apiKey" id="api-key" value="${canaries.apiKey}">`);
    // Masked account label and blocked support widget
    expect(html).toMatch(new RegExp(`<span[^>]*data-repro-mask[^>]*>Account ${canaries.maskedText}</span>`));
    expect(html).toMatch(new RegExp(`<aside[^>]*data-repro-block[^>]*>[\\s\\S]*${canaries.blockedText}[\\s\\S]*</aside>`));
    // Every form control has a label
    for (const id of ['full-name', 'email', 'address', 'city', 'postal-code', 'shipping', 'card-number', 'expiry', 'cvc', 'promo-code', 'save-card']) {
      expect(html).toContain(`<label for="${id}">`);
      expect(html).toMatch(new RegExp(`id="${id}"`));
    }
    expect(html).toContain('placeholder="MM/YY"');
    expect(html).toContain('Standard (free)');
    expect(html).toContain('Express ($9.00)');
    // Secrets that should only ever exist in requests or responses are not baked into the page.
    expect(html).not.toContain(canaries.token);
    expect(html).not.toContain(canaries.responseSecret);
    expect(html).not.toContain(canaries.queryToken);
  });

  it('escapes values interpolated into pages', async () => {
    const hostile = createApp({
      mode: 'broken',
      projectKey: 'rp_x</script><script>alert(1)</script>',
      ingestUrl: 'http://localhost:4000',
      release: '"><img src=x>',
      latencyMs: [0, 0],
    });
    const res = await hostile.inject({ method: 'GET', url: '/login' });
    expect(res.body).not.toContain('</script><script>alert(1)');
    expect(res.body).not.toContain('"><img src=x>');
    await hostile.close();
  });

  it('serves the SDK bundle route as JavaScript (stub when the bundle is missing)', async () => {
    const stubbed = createApp({
      mode: 'broken',
      projectKey: 'rp_test',
      ingestUrl: 'http://localhost:4000',
      release: 'demo@test',
      latencyMs: [0, 0],
      sdkBundle: '/definitely/not/here/repro.iife.js',
    });
    const res = await stubbed.inject({ method: 'GET', url: '/vendor/repro.iife.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toContain('window.Repro');
    await stubbed.close();
  });

  it('only serves /orders/:id in fixed mode for an order that exists', async () => {
    const placed = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { authorization: canaries.bearerHeader },
      payload: validOrder,
    });
    const id = placed.json().order.id as string;

    const broken = await app.inject({ method: 'GET', url: `/orders/${id}` });
    expect(broken.statusCode).toBe(302);
    expect(broken.headers.location).toBe('/checkout');

    await app.inject({ method: 'POST', url: '/__demo/mode', payload: { mode: 'fixed' } });
    const fixed = await app.inject({ method: 'GET', url: `/orders/${id}` });
    expect(fixed.statusCode).toBe(200);
    expect(fixed.body).toContain('data-testid="order-confirmation"');
    expect(fixed.body).toContain('role="status"');
    expect(fixed.body).toContain('Order confirmed');
    expect(fixed.body).toContain(`data-testid="order-id">${id}<`);
    expect(fixed.body).toContain('$83.00');

    const unknown = await app.inject({ method: 'GET', url: '/orders/ord_nope00' });
    expect(unknown.statusCode).toBe(404);
  });

  it('returns JSON 404s for unknown API routes and HTML for unknown pages', async () => {
    const api = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ ok: false, error: 'Not found' });
    const page = await app.inject({ method: 'GET', url: '/nope' });
    expect(page.statusCode).toBe(404);
    expect(page.headers['content-type']).toContain('text/html');
  });
});

describe('dotenv parser', () => {
  it('parses keys, quotes and comments', () => {
    const parsed = parseDotEnv(`# comment\nA=1\nB="two words"\nC='x' \nD=raw # trailing\nexport E=5\n\nBROKEN\n`);
    expect(parsed).toEqual({ A: '1', B: 'two words', C: 'x', D: 'raw', E: '5' });
  });
});
