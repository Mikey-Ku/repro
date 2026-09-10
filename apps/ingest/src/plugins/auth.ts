import { timingSafeEqual } from 'node:crypto';
import type { IngestionKeyRow } from '@repro/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { unauthorized } from '../errors.js';
import { verifyIngestionKey } from '../services/keys.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireIngestionKey` on /v1 routes. */
    ingestionKey?: IngestionKeyRow;
  }
}

/** The key travels in a header, or in the query string for sendBeacon uploads that cannot set headers. */
export function extractIngestionKey(request: FastifyRequest): string | null {
  const header = request.headers['x-repro-key'];
  if (typeof header === 'string' && header.length > 0) return header;
  const query = request.query as Record<string, unknown> | undefined;
  const fromQuery = query?.key;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  return null;
}

/** onRequest hook for the ingest route. Resolves the project key or fails with 401 before any body is read. */
export function requireIngestionKey(ctx: AppContext) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const key = extractIngestionKey(request);
    if (!key) throw unauthorized('Missing ingestion key (x-repro-key header or ?key=)');
    const row = await verifyIngestionKey(ctx.db, key);
    if (!row) throw unauthorized('Invalid or revoked ingestion key');
    request.ingestionKey = row;
    // Only the prefix is ever logged.
    request.log = request.log.child({ projectId: row.projectId, keyPrefix: row.prefix });
  };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** onRequest hook for the internal API. The dashboard server sends the shared token; browsers never do. */
export function requireInternalToken(ctx: AppContext) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const provided = request.headers['x-repro-internal-token'];
    if (typeof provided !== 'string' || !safeEqual(provided, ctx.internalToken)) {
      throw unauthorized('Missing or invalid internal token');
    }
  };
}
