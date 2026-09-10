import type { FastifyInstance } from 'fastify';
import { IngestBatchSchema } from '@repro/contracts';
import type { AppContext } from '../context.js';
import { unauthorized, validationFailed } from '../errors.js';
import { requireIngestionKey } from '../plugins/auth.js';
import { ingestRateLimitConfig, type RateLimitSettings } from '../plugins/rate-limit.js';
import { ingestBatch } from '../services/sessions.js';
import { summarizeIssues } from './shared.js';

/**
 * POST /v1/ingest. The body has already been decoded (gzip, size cap) by the content type parser
 * and the key resolved by the route's onRequest hook, so this handler only validates, stores and
 * answers. Authentication runs at the route level rather than the plugin level so the CORS
 * preflight route that @fastify/cors adds in the same scope stays open.
 */
export function registerIngestRoutes(app: FastifyInstance, ctx: AppContext, rateLimit: RateLimitSettings): void {
  app.route({
    method: 'POST',
    url: '/ingest',
    config: ingestRateLimitConfig(rateLimit),
    onRequest: requireIngestionKey(ctx),
    handler: async (request, reply) => {
      const key = request.ingestionKey;
      if (!key) throw unauthorized('Missing ingestion key');

      const parsed = IngestBatchSchema.safeParse(request.body);
      if (!parsed.success) throw validationFailed('Batch failed validation', summarizeIssues(parsed.error));
      const batch = parsed.data;

      const result = await ingestBatch(ctx.db, key, batch);
      // Counts and ids only. Event contents never reach the log.
      request.log.info(
        {
          sessionId: batch.sessionId,
          batchSeq: batch.batchSeq,
          events: batch.events.length,
          final: batch.final === true,
          accepted: result.response.accepted,
          duplicate: result.response.duplicate,
          sessionStatus: result.session.status,
        },
        'batch ingested',
      );
      return reply.send(result.response);
    },
  });
}
