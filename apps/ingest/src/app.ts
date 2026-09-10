import Fastify, { type FastifyInstance } from 'fastify';
import type { DbHandle } from '@repro/db';
import { createInvestigatorFromEnv, type Investigator } from '@repro/diagnostics';
import { generatePlaywrightTest } from '@repro/test-generator';
import type { AppContext } from './context.js';
import { requireInternalToken } from './plugins/auth.js';
import { registerBodyParsing } from './plugins/body.js';
import { registerPublicCors } from './plugins/cors.js';
import { registerErrorHandling } from './plugins/errors.js';
import { DEFAULT_RATE_LIMIT, registerRateLimit, type RateLimitSettings } from './plugins/rate-limit.js';
import { registerFindingRoutes } from './routes/findings.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerIncidentRoutes } from './routes/incidents.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerTestRoutes } from './routes/tests.js';
import { readServiceVersion } from './version.js';

export interface BuildAppOptions {
  db: DbHandle;
  internalToken: string;
  maxBatchBytes: number;
  /** Fastify logger option: false (tests), true, or pino options. */
  logger?: boolean | object;
  /** Defaults to the investigator chosen by the environment (fake unless AI variables are set). */
  investigator?: Investigator;
  artifactsDir: string;
  /** Test seam for the deterministic generator. */
  generateTest?: typeof generatePlaywrightTest;
  /** Dashboard base URL for links inside generated tests. */
  appUrl?: string;
  rateLimit?: RateLimitSettings;
}

/**
 * Assemble the service. Everything is registered here, in order:
 * body parsing and error shape (global), rate limiter (opt-in per route), the response log,
 * then the three route groups: health, public /v1 (key auth, CORS) and internal /api (token auth).
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // One log line per request, written by the onResponse hook below with exactly the documented fields.
    disableRequestLogging: true,
    requestIdLogLabel: 'reqId',
  });

  const ctx: AppContext = {
    db: options.db.db,
    sql: options.db.sql,
    internalToken: options.internalToken,
    maxBatchBytes: options.maxBatchBytes,
    artifactsDir: options.artifactsDir,
    appUrl: (options.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    investigator: options.investigator ?? createInvestigatorFromEnv(),
    generateTest: options.generateTest ?? generatePlaywrightTest,
    version: readServiceVersion(),
    startedAt: Date.now(),
  };
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;

  registerBodyParsing(app, ctx.maxBatchBytes);
  registerErrorHandling(app);
  await registerRateLimit(app, rateLimit);

  app.addHook('onResponse', (request, reply, done) => {
    // The path only: a query string can carry an ingestion key (`?key=` for sendBeacon).
    const url = request.url.split('?')[0] ?? request.url;
    request.log.info(
      {
        reqId: request.id,
        method: request.method,
        url,
        statusCode: reply.statusCode,
        responseTime: Math.round(reply.elapsedTime * 1000) / 1000,
        ...(request.projectId ? { projectId: request.projectId } : {}),
      },
      'request completed',
    );
    done();
  });

  registerHealthRoutes(app, ctx);

  await app.register(
    async (v1) => {
      await registerPublicCors(v1);
      registerIngestRoutes(v1, ctx, rateLimit);
    },
    { prefix: '/v1' },
  );

  await app.register(
    async (api) => {
      api.addHook('onRequest', requireInternalToken(ctx));
      registerProjectRoutes(api, ctx);
      registerSessionRoutes(api, ctx);
      registerIncidentRoutes(api, ctx);
      registerTestRoutes(api, ctx);
      registerRunRoutes(api, ctx);
      registerFindingRoutes(api, ctx);
    },
    { prefix: '/api' },
  );

  return app;
}
