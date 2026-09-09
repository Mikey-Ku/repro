import fs from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canaries } from './canaries.js';
import type { DemoMode } from './env.js';
import type { DemoPageConfig } from './layout.js';
import { renderCheckoutPage } from './pages/checkout.js';
import { renderLoginPage } from './pages/login.js';
import { renderNotFoundPage, renderOrderPage } from './pages/order.js';
import { publicDir, sdkBundlePath } from './paths.js';
import { createOrder, getCart, OrderStore } from './shop.js';

export interface AppOptions {
  mode: DemoMode;
  projectKey: string;
  ingestUrl: string;
  release: string;
  /** Path to the SDK IIFE bundle; a no-op stub is served when the file does not exist. */
  sdkBundle?: string;
  /** Artificial API latency range in milliseconds. Tests pass [0, 0]. */
  latencyMs?: [number, number];
  logger?: boolean;
}

const ModeBody = z.object({ mode: z.enum(['broken', 'fixed']) });

const LoginBody = z.object({
  email: z.string().trim().min(1, 'Email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Presence checks only. Generated reproduction tests replace card details with redacted
// placeholders, and those must still be accepted so the replay reaches the frontend bug.
const OrderBody = z.object({
  fullName: z.string().trim().min(1, 'Full name is required'),
  email: z.string().trim().min(1, 'Email is required'),
  address: z.string().trim().min(1, 'Address is required'),
  city: z.string().trim().min(1, 'City is required'),
  postalCode: z.string().trim().min(1, 'Postal code is required'),
  shipping: z.enum(['standard', 'express']),
  cardNumber: z.string().trim().min(12, 'Card number must be at least 12 characters'),
  // Real CVCs are 3 or 4 digits, but the canary CVC and redacted placeholders are longer, so only a minimum is enforced.
  cvc: z.string().trim().min(3, 'CVC must be at least 3 characters'),
  expiry: z.string().trim().min(1, 'Expiry is required'),
  saveCard: z.boolean().optional().default(false),
  promoCode: z.string().trim().optional().default(''),
  apiKey: z.string().optional().default(''),
});

/** Served when the SDK bundle has not been built yet, so the shop keeps working without recording. */
const SDK_STUB = `(function () {
  var noop = function () {};
  var client = {
    start: noop, stop: noop, captureException: noop, identify: noop, annotate: noop,
    flush: function () { return Promise.resolve(); },
    getSessionId: function () { return null; },
    isRecording: function () { return false; }
  };
  window.Repro = Object.assign({ init: function () { return client; } }, client);
  console.warn('[demo] Repro SDK bundle is missing; window.Repro is a no-op stub.');
})();
`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const state = { mode: options.mode };
  const orders = new OrderStore();
  const bundlePath = options.sdkBundle ?? sdkBundlePath;
  const [minLatency, maxLatency] = options.latencyMs ?? [80, 150];

  const sdkAvailable = fs.existsSync(bundlePath);
  if (!sdkAvailable) {
    console.warn(
      `[demo] Repro SDK bundle not found at ${bundlePath}. Serving a no-op stub; run "pnpm --filter @repro/browser-sdk build" to record sessions.`,
    );
  }

  const pageConfig = (): DemoPageConfig => ({
    projectKey: options.projectKey,
    endpoint: options.ingestUrl,
    mode: state.mode,
    release: options.release,
  });

  app.register(fastifyStatic, { root: publicDir, prefix: '/', index: false, wildcard: true });

  // Small artificial latency so the recorded network timeline looks like a real shop.
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/') && maxLatency > 0) {
      await sleep(minLatency + Math.random() * (maxLatency - minLatency));
    }
  });

  app.get('/vendor/repro.iife.js', async (_request, reply) => {
    reply.type('application/javascript; charset=utf-8');
    if (fs.existsSync(bundlePath)) return fs.createReadStream(bundlePath);
    return SDK_STUB;
  });

  // Demo controls (process state, not persisted).
  app.get('/__demo/health', async () => ({ ok: true, mode: state.mode }));
  app.get('/__demo/mode', async () => ({ mode: state.mode }));
  app.post('/__demo/mode', async (request, reply) => {
    const parsed = ModeBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'mode must be "broken" or "fixed"', issues: parsed.error.issues });
    }
    state.mode = parsed.data.mode;
    return { mode: state.mode };
  });

  // Pages
  app.get('/', async (_request, reply) => reply.redirect('/login', 302));
  app.get('/login', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderLoginPage(pageConfig())));
  app.get('/checkout', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(renderCheckoutPage(pageConfig())),
  );
  app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    reply.type('text/html; charset=utf-8');
    // In broken mode the checkout never gets this far, so the confirmation page does not exist yet.
    if (state.mode !== 'fixed') return reply.redirect('/checkout', 302);
    const order = orders.get(request.params.id);
    if (!order) return reply.code(404).send(renderNotFoundPage(pageConfig(), 'We could not find that order.'));
    return reply.send(renderOrderPage(pageConfig(), order));
  });

  // API
  app.post('/api/login', async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid login' });
    }
    // Deliberately not HttpOnly: the canary cookie must be visible to page scripts so the
    // privacy tests can prove the SDK never picks it up.
    reply.header('set-cookie', `demo_session=${canaries.cookie}; Path=/; SameSite=Lax`);
    return { ok: true, token: canaries.token, user: { id: 'usr_1042', name: 'Ada Lovelace' } };
  });

  const requireBearer = (authorization: string | undefined): boolean => authorization === canaries.bearerHeader;

  app.get('/api/cart', async (request, reply) => {
    if (!requireBearer(request.headers.authorization)) {
      return reply.code(401).send({ ok: false, error: 'Missing or invalid bearer token' });
    }
    return getCart();
  });

  app.post('/api/orders', async (request, reply) => {
    if (!requireBearer(request.headers.authorization)) {
      return reply.code(401).send({ ok: false, error: 'Missing or invalid bearer token' });
    }
    const parsed = OrderBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid order',
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    const order = createOrder(parsed.data);
    orders.add(order);
    // The API is correct in both modes: the id lives under `order`. The checkout bundle is what breaks.
    return {
      ok: true,
      order: {
        id: order.id,
        total: order.total,
        totalFormatted: order.totalFormatted,
        currency: order.currency,
        eta: order.eta,
      },
      meta: { apiKey: canaries.responseSecret },
    };
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/__demo/')) {
      return reply.code(404).send({ ok: false, error: 'Not found' });
    }
    return reply.code(404).type('text/html; charset=utf-8').send(renderNotFoundPage(pageConfig(), 'That page does not exist.'));
  });

  return app;
}
