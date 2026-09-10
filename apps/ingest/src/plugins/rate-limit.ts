import rateLimit, { type RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { extractIngestionKey } from './auth.js';

export interface RateLimitSettings {
  /** Requests per window per ingestion key. Default 600. */
  max: number;
  /** Window length. Default one minute. */
  timeWindow: number | string;
}

export const DEFAULT_RATE_LIMIT: RateLimitSettings = { max: 600, timeWindow: '1 minute' };

/**
 * In-memory limiter, keyed by ingestion key and applied only to routes that opt in via
 * `config.rateLimit` (the /v1 routes). This is the documented local substitute for a shared
 * limiter: counts live in this process and reset on restart. Requests without a key fall back
 * to the client IP so an unauthenticated flood is still bounded.
 */
export async function registerRateLimit(app: FastifyInstance, settings: RateLimitSettings): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    max: settings.max,
    timeWindow: settings.timeWindow,
    keyGenerator: (request) => {
      const key = extractIngestionKey(request);
      return key ? `key:${key}` : `ip:${request.ip}`;
    },
    // The plugin throws whatever this returns; an AppError lands in our error handler with the API shape.
    errorResponseBuilder: (_request, context) =>
      new AppError('rate_limited', `Rate limit exceeded, retry in ${context.after}`, {
        max: context.max,
        retryAfter: context.after,
      }),
  });
}

/** Route config that turns the limiter on for one route. */
export function ingestRateLimitConfig(settings: RateLimitSettings): { rateLimit: RateLimitOptions } {
  return { rateLimit: { max: settings.max, timeWindow: settings.timeWindow } };
}
