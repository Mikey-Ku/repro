import type { FastifyInstance } from 'fastify';
import type { Health } from '@repro/contracts';
import type { AppContext } from '../context.js';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const base = (): Omit<Health, 'checks'> => ({
    ok: true,
    service: 'ingest',
    version: ctx.version,
    uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
  });

  /** Liveness: the process is up and serving. Never touches the database. */
  app.get('/health', async () => base());

  /** Readiness: the database answers. Load balancers and the dashboard status dot use this. */
  app.get('/ready', async (request, reply) => {
    try {
      await ctx.sql`SELECT 1`;
      const body: Health = { ...base(), checks: { database: 'ok' } };
      return reply.send(body);
    } catch (error) {
      request.log.warn({ err: error }, 'readiness check failed');
      const body: Health = { ...base(), ok: false, checks: { database: 'fail' } };
      return reply.status(503).send(body);
    }
  });
}
