/**
 * Payload-level privacy test. A page is seeded with every canary from canaries.ts, the SDK
 * records it end to end (rrweb, interactions, navigation, network, errors, console, the public
 * API), and every byte that would leave the browser is decoded and grepped for the canaries.
 * Runs once per body encoding: gzip when CompressionStream exists, and plain JSON with it stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasCompressionStream } from '../src/transport.js';
import { CANARIES, CANARY_VALUES } from './canaries.js';
import { $, fire, html, installPageFetch, makeClient, ofType, resetDom, setValue, tick, type Harness } from './helpers.js';

const C = CANARIES;

/** Every canary is rendered somewhere the naive approach would capture it. */
const PAGE = `
  <h1>Checkout</h1>
  <form id="checkout" data-testid="checkout-form">
    <input type="hidden" name="api_key" value="${C.CANARY_APIKEY_}">
    <input type="hidden" name="state" value="${C.CANARY_HIDDEN_}">
    <label for="nickname">Nickname</label>
    <input id="nickname" name="nickname" value="">
    <label for="password">Password</label>
    <input id="password" type="password" name="password">
    <label for="card">Card number</label>
    <input id="card" name="cardNumber" autocomplete="cc-number">
    <label for="cvc">CVC</label>
    <input id="cvc" name="cvc">
    <label for="expiry">Expiry</label>
    <input id="expiry" name="expiry" autocomplete="cc-exp">
    <label for="token">Token</label>
    <input id="token" name="token">
    <p>Balance: <span id="masked" data-repro-mask>${C.CANARY_MASKED_TEXT_}</span></p>
    <button id="masked-button" type="button" data-repro-mask>${C.CANARY_MASKED_TEXT_}</button>
    <div id="widget" data-repro-block>
      <p>${C.CANARY_BLOCKED_}</p>
      <input id="blocked-note" name="note">
    </div>
    <input id="ignored" name="scratch" data-repro-ignore value="${C.CANARY_IGNORED_}">
    <button id="pay" type="submit" data-testid="pay">Pay now</button>
  </form>
`;

async function runScenario(harness: Harness): Promise<void> {
  const { client } = harness;
  html(PAGE);
  document.title = 'Checkout';
  document.cookie = `session=${C.CANARY_COOKIE_}`;
  const responseBody = JSON.stringify({ secret: C.CANARY_RESPONSE_SECRET_ });
  const pageFetch = installPageFetch(responseBody);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  // Clicking the submit button really submits the form in happy-dom; keep the page put.
  $('#checkout').addEventListener('submit', (event) => event.preventDefault());

  client.start();
  await tick(20); // rrweb takes its full snapshot

  // Form interactions.
  setValue($('#nickname'), 'octopus');
  setValue($('#password'), C.CANARY_PASSWORD_);
  setValue($('#card'), C.CANARY_CARD_);
  setValue($('#cvc'), C.CANARY_CVC_);
  setValue($('#expiry'), C.CANARY_EXPIRY_);
  setValue($('#token'), C.CANARY_TOKEN_);
  setValue($('#blocked-note'), C.CANARY_BLOCKED_);
  setValue($('#ignored'), C.CANARY_IGNORED_);
  fire($('#masked-button'), 'click');
  fire($('#pay'), 'click'); // submits the form

  // Navigation carrying secrets in the query string and the fragment.
  history.pushState({}, '', `/checkout?token=${C.CANARY_QS_}&step=2#access_token=${C.CANARY_SESSION_}`);

  // Network: an Authorization header, an api key header, a secret request body, a secret response body.
  await window.fetch('/api/profile', {
    method: 'POST',
    headers: { Authorization: `Bearer ${C.CANARY_BEARER_}`, 'x-api-key': C.CANARY_APIKEY_ },
    body: JSON.stringify({ card: C.CANARY_REQUEST_BODY_ }),
  });
  await window.fetch(`/api/cart?sessionid=${C.CANARY_SESSION_}&qty=3`);
  expect(pageFetch).toHaveLength(2);

  // Errors, rejections and console output that mention secrets in free text.
  window.dispatchEvent(
    new ErrorEvent('error', {
      message: `Request failed: Bearer ${C.CANARY_BEARER_}`,
      error: new Error(`Request failed: Bearer ${C.CANARY_BEARER_}`),
    }),
  );
  window.dispatchEvent(
    new PromiseRejectionEvent('unhandledrejection', {
      reason: new Error(`token=${C.CANARY_TOKEN_}`),
      promise: Promise.resolve(),
    }),
  );
  console.error(`login failed password=${C.CANARY_PASSWORD_}`);
  console.error('auth state', { apiKey: C.CANARY_APIKEY_, cookie: C.CANARY_COOKIE_, plan: 'pro' });
  console.warn(`cookie=${C.CANARY_COOKIE_}`);

  // Public API misuse: secrets passed as context, traits and annotation data.
  client.captureException(new Error(`secret=${C.CANARY_TOKEN_}`), { password: C.CANARY_PASSWORD_, step: 'pay' });
  client.identify('user_42', { apiKey: C.CANARY_APIKEY_, plan: 'pro' });
  client.annotate('checkout', { token: C.CANARY_TOKEN_, note: 'declined card 4111 1111 1111 1111' });

  await tick(20);
  await client.flush();
  client.stop();
  await client.flush();
}

function expectRecordingHappened(harness: Harness): void {
  const events = harness.fetch.events();
  const text = harness.fetch.text();
  expect(harness.fetch.errors).toEqual([]);
  expect(harness.fetch.uploads.length).toBeGreaterThan(0);
  // rrweb produced a full snapshot (type 2) of the seeded page.
  expect(ofType(events, 'rrweb').some((e) => e.data.type === 2)).toBe(true);
  // Non-secret content is present, so the canary check is not passing on an empty payload.
  expect(text).toContain('Pay now');
  expect(text).toContain('octopus');
  expect(text).toContain('step=2');
  expect(text).toContain('qty=3');
  expect(ofType(events, 'click').length).toBe(2);
  expect(ofType(events, 'input').length).toBeGreaterThanOrEqual(7);
  expect(ofType(events, 'submit').length).toBe(1);
  expect(ofType(events, 'navigation').length).toBeGreaterThanOrEqual(2);
  expect(ofType(events, 'network').length).toBe(2);
  expect(ofType(events, 'error').length).toBe(3);
  expect(ofType(events, 'console').length).toBe(3);
  expect(ofType(events, 'identify').length).toBe(1);
  expect(ofType(events, 'annotation').length).toBe(1);
  expect(harness.fetch.uploads.at(-1)?.batch.final).toBe(true);
}

function expectNoCanary(harness: Harness): void {
  const text = harness.fetch.text();
  const leaked = CANARY_VALUES.filter((value) => text.includes(value));
  expect(leaked, `canaries found in outbound payload: ${leaked.join(', ')}`).toEqual([]);
  // Belt and braces: no header names or header-shaped keys appear anywhere in the payload.
  expect(text).not.toMatch(/"(headers|authorization|x-api-key|cookie|set-cookie)"/i);
}

describe('payload privacy with the canary corpus', () => {
  beforeEach(() => resetDom());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe.runIf(hasCompressionStream())('gzip bodies', () => {
    it('sends gzip and no canary survives in any batch', async () => {
      const harness = makeClient();
      await runScenario(harness);
      expectRecordingHappened(harness);
      expect(harness.fetch.uploads.every((u) => u.headers['content-encoding'] === 'gzip' && u.bodyType === 'bytes')).toBe(true);
      expectNoCanary(harness);
    });
  });

  describe('plain JSON bodies (CompressionStream unavailable)', () => {
    it('falls back to JSON and no canary survives in any batch', async () => {
      vi.stubGlobal('CompressionStream', undefined);
      expect(hasCompressionStream()).toBe(false);
      const harness = makeClient();
      await runScenario(harness);
      expectRecordingHappened(harness);
      expect(harness.fetch.uploads.every((u) => u.headers['content-encoding'] === undefined && u.bodyType === 'string')).toBe(true);
      expect(harness.fetch.uploads.every((u) => u.headers['content-type'] === 'application/json')).toBe(true);
      expectNoCanary(harness);
    });
  });

  it('keeps the shape of what it redacts, so replays stay useful', async () => {
    const harness = makeClient();
    await runScenario(harness);
    const events = harness.fetch.events();
    const inputs = ofType(events, 'input');
    const byName = (name: string) => inputs.find((e) => e.data.target.name === name);
    expect(byName('nickname')?.data).toMatchObject({ value: 'octopus', masked: false });
    for (const name of ['password', 'cardNumber', 'cvc', 'expiry', 'token', 'note']) {
      expect(byName(name)?.data, name).toMatchObject({ value: null, masked: true });
      expect(byName(name)?.data.target.sensitive, name).toBe(true);
    }
    // data-repro-ignore produces no input event at all.
    expect(byName('scratch')).toBeUndefined();
    // Clicks inside a masked region keep the element but not its text.
    const maskedClick = ofType(events, 'click').find((e) => e.data.target.id === 'masked-button');
    expect(maskedClick?.data.target.text).toBe('[redacted]');
    // The scrubbed error keeps the auth scheme so the shape of the failure is still readable.
    const errors = ofType(events, 'error');
    expect(errors.find((e) => e.data.kind === 'exception')?.data.message).toBe('Request failed: Bearer [redacted]');
    expect(errors.find((e) => e.data.kind === 'unhandledrejection')?.data.message).toBe('token=[redacted]');
    const captured = errors.find((e) => e.data.kind === 'captured');
    expect(captured?.data.message).toBe('secret=[redacted]');
    expect(captured?.data.context).toEqual({ step: 'pay' });
    // Network events carry a sanitised url and nothing else about the request.
    const network = ofType(events, 'network');
    expect(network.map((e) => e.data.path)).toEqual(['/api/profile', '/api/cart?sessionid=%5Bredacted%5D&qty=3']);
    expect(Object.keys(network[0]!.data).sort()).toEqual(
      ['durationMs', 'kind', 'method', 'ok', 'path', 'requestId', 'status', 'url'].sort(),
    );
    // Trait and annotation keys that hint at secrets are dropped, not masked.
    expect(ofType(events, 'identify')[0]?.data).toEqual({ userId: 'user_42', traits: { plan: 'pro' } });
    expect(ofType(events, 'annotation')[0]?.data.data).toEqual({ note: 'declined card [redacted]' });
  });
});
