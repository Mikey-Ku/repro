import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/**
 * The public ingestion API is called from arbitrary end-user origins, so it allows any origin.
 * Register this inside the /v1 plugin scope only: the internal API never needs CORS because
 * browsers never call it.
 */
export async function registerPublicCors(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: '*',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'content-encoding', 'x-repro-key'],
    maxAge: 600,
  });
}
