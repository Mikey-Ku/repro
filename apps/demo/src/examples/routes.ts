import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DemoPageConfig } from '../layout.js';
import { renderExamplesIndexPage } from '../pages/examples/index.js';
import { renderInboxPage } from '../pages/examples/inbox.js';
import { renderOrdersPage } from '../pages/examples/orders.js';
import { renderSettingsPage } from '../pages/examples/settings.js';
import { renderSignupPage } from '../pages/examples/signup.js';
import { FOLDERS, INBOX_PATHS, MessageBody, MessageStore, type Folder } from './inbox.js';
import { OrdersQuery, queryOrders } from './orders.js';
import { EXAMPLES, publicExampleMeta } from './registry.js';
import { SettingsBody, SettingsStore } from './settings.js';
import { SignupBody, createUser } from './signup.js';

export interface ExampleRouteOptions {
  pageConfig: () => DemoPageConfig;
}

const firstIssue = (issues: { message: string }[], fallback: string): string => issues[0]?.message ?? fallback;

const html = (reply: FastifyReply, page: string) => reply.type('text/html; charset=utf-8').send(page);

/**
 * Pages and API routes for the examples gallery. Every API here is correct in both modes, like
 * the checkout's: only the browser bundles change behaviour with the demo mode.
 */
export function registerExampleRoutes(app: FastifyInstance, options: ExampleRouteOptions): void {
  const { pageConfig } = options;
  const settings = new SettingsStore();
  const messages = new MessageStore();

  // Gallery metadata, used by the E2E suite and the docs.
  app.get('/__demo/examples', async () => EXAMPLES.map(publicExampleMeta));

  // Pages
  app.get('/examples', async (_request, reply) => html(reply, renderExamplesIndexPage(pageConfig(), EXAMPLES)));
  app.get('/examples/settings', async (_request, reply) =>
    html(reply, renderSettingsPage(pageConfig(), settings.get(), settings.lastSavedAt())),
  );
  for (const folder of FOLDERS) {
    // Client-side routing: all three folder paths serve the same page and the bundle renders the route.
    app.get(INBOX_PATHS[folder], async (_request, reply) => html(reply, renderInboxPage(pageConfig(), folder)));
  }
  app.get('/examples/orders', async (_request, reply) => html(reply, renderOrdersPage(pageConfig())));
  app.get('/examples/signup', async (_request, reply) => html(reply, renderSignupPage(pageConfig())));

  // Settings API. The catch-all parser is scoped to this plugin so that a non-JSON body reaches
  // the handler and gets the explicit 415 below instead of Fastify's generic one.
  app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    scope.put('/api/examples/settings', async (request, reply) => {
      const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
      if (!contentType.startsWith('application/json')) {
        return reply.code(415).send({ ok: false, error: 'expected application/json' });
      }
      const parsed = SettingsBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: firstIssue(parsed.error.issues, 'Invalid settings') });
      }
      const { savedAt } = settings.save(parsed.data);
      // The passwords are validated and dropped: the response carries neither.
      return { ok: true, savedAt };
    });
  });

  // Inbox API
  app.get<{ Querystring: { folder?: string } }>('/api/examples/inbox/messages', async (request, reply) => {
    const folder = (request.query.folder ?? 'inbox') as Folder;
    if (!FOLDERS.includes(folder)) {
      return reply.code(400).send({ ok: false, error: `folder must be one of ${FOLDERS.join(', ')}` });
    }
    return { ok: true, folder, messages: messages.list(folder) };
  });
  app.post('/api/examples/inbox/messages', async (request, reply) => {
    const parsed = MessageBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: firstIssue(parsed.error.issues, 'Invalid message') });
    }
    return { ok: true, message: messages.send(parsed.data) };
  });

  // Orders API
  app.get('/api/examples/orders', async (request, reply) => {
    const parsed = OrdersQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: firstIssue(parsed.error.issues, 'Invalid query') });
    }
    return { ok: true, ...queryOrders(parsed.data) };
  });

  // Sign-up API
  app.post('/api/examples/signup', async (request, reply) => {
    const parsed = SignupBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: firstIssue(parsed.error.issues, 'Invalid sign-up') });
    }
    // The password and the code are checked for presence and then forgotten.
    return { ok: true, user: createUser(parsed.data) };
  });
}
