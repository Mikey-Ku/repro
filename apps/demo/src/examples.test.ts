import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canaries } from './canaries.js';
import { createApp } from './app.js';
import { INBOX_PATHS } from './examples/inbox.js';
import { ORDERS, PAGE_SIZE, UNPRICED_ORDER_IDS } from './examples/orders.js';
import { EXAMPLES } from './examples/registry.js';

type Mode = 'broken' | 'fixed';

function makeApp(mode: Mode = 'broken') {
  return createApp({
    mode,
    projectKey: 'rp_test_0123456789abcdefghijklmn',
    ingestUrl: 'http://localhost:4000',
    release: 'demo@test',
    latencyMs: [0, 0],
  });
}

const validSettings = {
  displayName: 'Ada King',
  bio: 'Countess of Lovelace.',
  theme: 'dark',
  emailNotifications: false,
  weeklyDigest: true,
  timezone: 'Asia/Tokyo',
  currentPassword: 'TEST_SETTINGS_CURRENT_pw',
  newPassword: 'TEST_SETTINGS_NEW_pw_2fa9',
};

const validSignup = {
  email: 'ada@example.com',
  password: 'TEST_SIGNUP_PASSWORD_1',
  fullName: 'Ada Lovelace',
  role: 'engineer',
  terms: true,
  code: '482913',
};

describe('examples gallery', () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('GET /__demo/examples lists the four examples with their success test ids', async () => {
    const res = await app.inject({ method: 'GET', url: '/__demo/examples' });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Record<string, string>[];
    expect(list.map((e) => e.slug)).toEqual(['settings', 'inbox', 'orders', 'signup']);
    for (const entry of list) {
      expect(Object.keys(entry).sort()).toEqual(['bugClass', 'element', 'path', 'slug', 'successTestId', 'title']);
      expect(entry.path).toBe(`/examples/${entry.slug}`);
      // Every advertised page really exists.
      const page = await app.inject({ method: 'GET', url: entry.path! });
      expect(page.statusCode, entry.path).toBe(200);
    }
    expect(list.map((e) => e.successTestId)).toEqual(['settings-saved', 'message-sent', 'orders-table', 'welcome']);
  });

  it('renders the gallery index with a card per example and links to it from the Northwind footer', async () => {
    const res = await app.inject({ method: 'GET', url: '/examples' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    for (const example of EXAMPLES) {
      expect(res.body).toContain(`data-testid="example-card-${example.slug}"`);
      expect(res.body).toContain(`href="${example.path}"`);
      expect(res.body).toContain(example.bugClass);
    }
    // The gallery page has no bundle of its own, so it must not load a missing script.
    expect(res.body).toContain('src="/app.js"');

    const checkout = await app.inject({ method: 'GET', url: '/checkout' });
    expect(checkout.body).toContain('href="/examples" data-testid="examples-link"');
  });

  it.each<Mode>(['broken', 'fixed'])('every example page carries the SDK config for %s mode and its own bundle', async (mode) => {
    const modeApp = makeApp(mode);
    await modeApp.ready();
    try {
      for (const example of EXAMPLES) {
        const res = await modeApp.inject({ method: 'GET', url: example.path });
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain(`<body data-page="${example.slug}" data-mode="${mode}">`);
        expect(res.body).toContain(`"mode":"${mode}"`);
        expect(res.body).toContain('src="/vendor/repro.iife.js"');
        expect(res.body).toContain(`src="/examples/${example.slug}.js"`);
        expect(res.body).not.toContain('src="/app.js"');
      }
    } finally {
      await modeApp.close();
    }
  });

  describe('settings', () => {
    it('renders every control with a label, the current values and the save button', async () => {
      const res = await app.inject({ method: 'GET', url: '/examples/settings' });
      const html = res.body;
      for (const id of [
        'display-name',
        'bio',
        'theme-light',
        'theme-dark',
        'theme-system',
        'email-notifications',
        'weekly-digest',
        'timezone',
        'current-password',
        'new-password',
      ]) {
        expect(html).toContain(`<label for="${id}">`);
        expect(html).toMatch(new RegExp(`id="${id}"`));
      }
      expect(html).toContain('data-testid="save-settings"');
      expect(html).toContain('type="password" name="currentPassword"');
      expect(html).toContain('type="password" name="newPassword"');
      expect(html).toContain('value="Ada Lovelace"');
      expect(html).toContain('id="theme-system" value="system" checked');
      expect(html).toContain('id="email-notifications" checked');
      expect(html).toContain('<option value="Europe/London" selected>');
      expect(html.match(/<option value="[^"]+"( selected)?>[^<]+<\/option>/g)).toHaveLength(5);
      expect(html).not.toContain('data-testid="settings-saved"');
    });

    it('answers 415 with a JSON body when the request is not JSON', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/examples/settings',
        headers: { 'content-type': 'text/plain' },
        payload: JSON.stringify(validSettings),
      });
      expect(res.statusCode).toBe(415);
      expect(res.json()).toEqual({ ok: false, error: 'expected application/json' });
      // The catch-all parser is scoped to the settings route; the checkout API keeps Fastify's default.
      const order = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { 'content-type': 'text/plain', authorization: `Bearer ${canaries.token}` },
        payload: 'x',
      });
      // Fastify's default text parser hands the route a string, which fails validation (400) or,
      // for encodings it does not know, is refused (415). Either way it is not the settings message.
      expect([400, 415]).toContain(order.statusCode);
      expect(order.json().error).not.toBe('expected application/json');
    });

    it('saves JSON, never echoes the passwords, and re-renders the saved values', async () => {
      const res = await app.inject({ method: 'PUT', url: '/api/examples/settings', payload: validSettings });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(new Date(body.savedAt).getTime()).toBeGreaterThan(0);
      expect(Object.keys(body).sort()).toEqual(['ok', 'savedAt']);
      expect(res.body).not.toContain(validSettings.currentPassword);
      expect(res.body).not.toContain(validSettings.newPassword);

      const page = await app.inject({ method: 'GET', url: '/examples/settings' });
      expect(page.body).toContain('value="Ada King"');
      expect(page.body).toContain('id="theme-dark" value="dark" checked');
      expect(page.body).toContain('id="weekly-digest" checked');
      expect(page.body).not.toContain('id="email-notifications" checked');
      expect(page.body).toContain('<option value="Asia/Tokyo" selected>');
      expect(page.body).toContain('Last saved');
      expect(page.body).not.toContain(validSettings.currentPassword);
    });

    it('rejects invalid settings with 400 and the first issue', async () => {
      const short = await app.inject({ method: 'PUT', url: '/api/examples/settings', payload: { ...validSettings, newPassword: 'short' } });
      expect(short.statusCode).toBe(400);
      expect(short.json()).toEqual({ ok: false, error: 'New password must be at least 8 characters' });
      const zone = await app.inject({ method: 'PUT', url: '/api/examples/settings', payload: { ...validSettings, timezone: 'Mars/Olympus' } });
      expect(zone.statusCode).toBe(400);
      const empty = await app.inject({ method: 'PUT', url: '/api/examples/settings', payload: { ...validSettings, displayName: '  ' } });
      expect(empty.json().error).toBe('Display name is required');
    });
  });

  describe('inbox', () => {
    it('serves the same page for all three folder paths with the folder marked current', async () => {
      for (const [folder, path] of Object.entries(INBOX_PATHS)) {
        const res = await app.inject({ method: 'GET', url: path });
        expect(res.statusCode, path).toBe(200);
        const html = res.body;
        expect(html).toContain(`data-folder="${folder}" aria-current="page"`);
        // Anchors only: the shared stylesheet also mentions the attribute in a selector.
        expect(html.match(/<a [^>]*aria-current="page"/g)).toHaveLength(1);
        for (const testid of ['compose', 'compose-dialog', 'compose-form', 'message-list', 'send', 'cancel']) {
          expect(html).toContain(`data-testid="${testid}"`);
        }
        for (const id of ['compose-to', 'compose-subject', 'compose-body']) {
          expect(html).toContain(`<label for="${id}">`);
          expect(html).toMatch(new RegExp(`id="${id}"`));
        }
        expect(html).toContain('<dialog data-testid="compose-dialog" id="compose-dialog"');
        expect(html).not.toContain('method="dialog"');
      }
    });

    it('lists seeded messages per folder and rejects unknown folders', async () => {
      const inbox = await app.inject({ method: 'GET', url: '/api/examples/inbox/messages' });
      expect(inbox.statusCode).toBe(200);
      expect(inbox.json().folder).toBe('inbox');
      expect(inbox.json().messages).toHaveLength(4);
      expect(inbox.json().messages[0]).toMatchObject({ id: 'msg_1007', subject: 'Your order NW-1021 is on its way' });
      expect((await app.inject({ method: 'GET', url: '/api/examples/inbox/messages?folder=archive' })).json().messages).toHaveLength(2);
      expect((await app.inject({ method: 'GET', url: '/api/examples/inbox/messages?folder=sent' })).json().messages).toHaveLength(1);
      const bad = await app.inject({ method: 'GET', url: '/api/examples/inbox/messages?folder=spam' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().ok).toBe(false);
    });

    it('sends a message into the sent folder and validates the body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/examples/inbox/messages',
        payload: { to: 'grace@example.com', subject: 'Hello', body: 'Testing the inbox.' },
      });
      expect(res.statusCode).toBe(200);
      const { ok, message } = res.json();
      expect(ok).toBe(true);
      expect(message).toMatchObject({ id: 'msg_1008', folder: 'sent', from: 'ada@example.com', to: 'grace@example.com', subject: 'Hello' });
      const sent = await app.inject({ method: 'GET', url: '/api/examples/inbox/messages?folder=sent' });
      expect(sent.json().messages.map((m: { id: string }) => m.id)).toEqual(['msg_1008', 'msg_1001']);

      const invalid = await app.inject({
        method: 'POST',
        url: '/api/examples/inbox/messages',
        payload: { to: 'not-an-email', subject: '', body: '' },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({ ok: false, error: 'Enter a valid email address' });
    });
  });

  describe('orders', () => {
    it('renders the search form, the filter and the pager', async () => {
      const res = await app.inject({ method: 'GET', url: '/examples/orders' });
      const html = res.body;
      expect(html).toContain('data-testid="search-form"');
      expect(html).toContain('<label for="order-search">Search orders</label>');
      expect(html).toContain('type="text" name="q" id="order-search"');
      expect(html).toContain('<label for="status-filter">');
      expect(html).toContain('data-testid="orders-loading"');
      expect(html).toContain('data-testid="next-page"');
      expect(html).toContain('data-testid="prev-page"');
      // The search form has no submit button on purpose: Enter submits it.
      expect(html).not.toMatch(/<form[^>]*search-form[\s\S]*?<button[^>]*type="submit"[\s\S]*?<\/form>/);
    });

    it('seeds 24 orders, exactly two of them pending pricing', () => {
      expect(ORDERS).toHaveLength(24);
      const unpriced = ORDERS.filter((o) => o.total === null);
      expect(unpriced.map((o) => o.id)).toEqual([...UNPRICED_ORDER_IDS]);
      expect(unpriced.every((o) => o.status === 'pending')).toBe(true);
      expect(new Set(ORDERS.map((o) => o.id)).size).toBe(24);
    });

    it('pages, searches and filters', async () => {
      const first = await app.inject({ method: 'GET', url: '/api/examples/orders' });
      expect(first.statusCode).toBe(200);
      const page1 = first.json();
      expect(page1).toMatchObject({ ok: true, page: 1, pageCount: 3, total: 24, sort: '', dir: 'asc' });
      expect(page1.rows).toHaveLength(PAGE_SIZE);
      expect(page1.rows[0]).toMatchObject({ id: 'NW-1024', customer: 'Grace Hopper', total: null, status: 'pending' });

      // Empty parameters mean defaults, which is what the client sends before the user touches anything.
      const empty = await app.inject({ method: 'GET', url: '/api/examples/orders?q=&status=&sort=&dir=&page=' });
      expect(empty.statusCode).toBe(200);
      expect(empty.json().rows.map((r: { id: string }) => r.id)).toEqual(page1.rows.map((r: { id: string }) => r.id));

      const last = (await app.inject({ method: 'GET', url: '/api/examples/orders?page=3' })).json();
      expect(last.rows).toHaveLength(8);
      expect(last.rows[7].id).toBe('NW-1001');
      const beyond = (await app.inject({ method: 'GET', url: '/api/examples/orders?page=9' })).json();
      expect(beyond.page).toBe(3);

      const hopper = (await app.inject({ method: 'GET', url: '/api/examples/orders?q=hopper' })).json();
      expect(hopper.total).toBe(3);
      expect(hopper.rows.filter((r: { total: number | null }) => r.total === null)).toHaveLength(1);
      const byId = (await app.inject({ method: 'GET', url: '/api/examples/orders?q=NW-1023' })).json();
      expect(byId.rows).toEqual([expect.objectContaining({ id: 'NW-1023', customer: 'Ada Lovelace', total: null })]);

      const pending = (await app.inject({ method: 'GET', url: '/api/examples/orders?status=pending' })).json();
      expect(pending.rows.every((r: { status: string }) => r.status === 'pending')).toBe(true);
      expect(pending.rows.filter((r: { total: number | null }) => r.total === null)).toHaveLength(2);
    });

    it('sorts on the server with unpriced orders last in both directions', async () => {
      const asc = (await app.inject({ method: 'GET', url: '/api/examples/orders?sort=total&dir=asc&page=3' })).json();
      expect(asc.sort).toBe('total');
      const ascIds = asc.rows.map((r: { id: string }) => r.id);
      expect(ascIds.slice(-2).sort()).toEqual([...UNPRICED_ORDER_IDS].sort());
      const desc = (await app.inject({ method: 'GET', url: '/api/examples/orders?sort=total&dir=desc&page=3' })).json();
      expect(desc.rows.slice(-2).every((r: { total: number | null }) => r.total === null)).toBe(true);

      const descTotals = (await app.inject({ method: 'GET', url: '/api/examples/orders?sort=total&dir=desc' })).json().rows.map((r: { total: number }) => r.total);
      expect([...descTotals].sort((a, b) => b - a)).toEqual(descTotals);

      const customers = (await app.inject({ method: 'GET', url: '/api/examples/orders?sort=customer' })).json().rows.map((r: { customer: string }) => r.customer);
      expect([...customers].sort()).toEqual(customers);
      expect(customers[0]).toBe('Ada Lovelace');

      const bad = await app.inject({ method: 'GET', url: '/api/examples/orders?sort=placedAt' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().ok).toBe(false);
      expect((await app.inject({ method: 'GET', url: '/api/examples/orders?page=0' })).statusCode).toBe(400);
    });
  });

  describe('signup', () => {
    it('renders the three steps with labelled controls and Finish visually disabled', async () => {
      const res = await app.inject({ method: 'GET', url: '/examples/signup' });
      const html = res.body;
      for (const id of ['signup-email', 'signup-password', 'full-name', 'role', 'terms', 'verification-code']) {
        expect(html).toContain(`<label for="${id}">`);
        expect(html).toMatch(new RegExp(`id="${id}"`));
      }
      for (const testid of ['step1-next', 'step2-next', 'finish', 'step-1', 'step-2', 'step-3']) {
        expect(html).toContain(`data-testid="${testid}"`);
      }
      expect(html).toContain('<fieldset id="step-2" data-testid="step-2" hidden>');
      expect(html).toContain('<fieldset id="step-3" data-testid="step-3" hidden>');
      expect(html).toContain('type="password" name="code" id="verification-code" autocomplete="one-time-code" inputmode="numeric" maxlength="6"');
      expect(html).toContain('data-testid="finish" aria-disabled="true"');
      expect(html).toContain('autocomplete="new-password"');
      expect(html.match(/<select name="role" id="role">([\s\S]*?)<\/select>/)![1]!.match(/<option/g)).toHaveLength(5);
      expect(html).not.toContain('data-testid="welcome"');
    });

    it('creates the account and keeps the password and the code out of the response', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/examples/signup', payload: validSignup });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
      expect(body.user.id).toMatch(/^usr_[a-z0-9]{6}$/);
      expect(res.body).not.toContain(validSignup.password);
      expect(res.body).not.toContain(validSignup.code);
    });

    it('accepts the redacted placeholders a generated test replays with', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/examples/signup',
        payload: { ...validSignup, password: 'REDACTED_password', code: 'REDACT' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects a bad email, a short password, unaccepted terms and a missing code', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ email: 'nope' }, 'Enter a valid email address'],
        [{ password: 'short' }, 'Password must be at least 8 characters'],
        [{ terms: false }, 'You must agree to the terms'],
        [{ code: '' }, 'Verification code is required'],
        [{ role: 'wizard' }, ''],
      ];
      for (const [patch, message] of cases) {
        const res = await app.inject({ method: 'POST', url: '/api/examples/signup', payload: { ...validSignup, ...patch } });
        expect(res.statusCode, JSON.stringify(patch)).toBe(400);
        expect(res.json().ok).toBe(false);
        if (message) expect(res.json().error).toBe(message);
      }
    });
  });

  it('keeps JSON 404s for unknown example API routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/examples/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'Not found' });
  });
});
