import type { ErrorResponse } from '@repro/contracts';
import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError, type ErrorCode } from '../errors.js';

/** Map Fastify's own status codes (body limit, media type, rate limit) onto API.md codes. */
function codeForStatus(statusCode: number): ErrorCode {
  switch (statusCode) {
    case 400:
      return 'validation_failed';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_encoding';
    case 429:
      return 'rate_limited';
    default:
      return 'internal';
  }
}

/**
 * One error shape for every failure. Client errors keep their message; anything unexpected is
 * logged with the request id and returned as a generic `internal` so stack traces never leak.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error, reqId: request.id }, error.message);
      return reply.status(error.statusCode).send(error.toResponse());
    }

    const statusCode = typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    const code = codeForStatus(statusCode);
    if (statusCode >= 500) {
      request.log.error({ err: error, reqId: request.id }, 'unhandled error');
    }
    const body: ErrorResponse = {
      ok: false,
      error: {
        code,
        message: statusCode >= 500 ? 'Internal server error' : error.message,
      },
    };
    return reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ErrorResponse = {
      ok: false,
      error: { code: 'not_found', message: `Route ${request.method} ${request.url.split('?')[0]} not found` },
    };
    return reply.status(404).send(body);
  });
}
