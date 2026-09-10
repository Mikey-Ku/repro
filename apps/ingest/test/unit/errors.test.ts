import { ErrorResponseSchema } from '@repro/contracts';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AppError, notFound, validationFailed } from '../../src/errors.js';
import { registerErrorHandling } from '../../src/plugins/errors.js';

describe('AppError', () => {
  it('maps every code to its status and serialises to the API shape', () => {
    const cases: [AppError, number][] = [
      [new AppError('unauthorized', 'no'), 401],
      [new AppError('forbidden', 'no'), 403],
      [notFound('Session'), 404],
      [validationFailed('bad', { issues: [] }), 400],
      [new AppError('payload_too_large', 'big'), 413],
      [new AppError('unsupported_encoding', 'enc'), 415],
      [new AppError('rate_limited', 'slow down'), 429],
      [new AppError('conflict', 'dup'), 409],
      [new AppError('internal', 'boom'), 500],
    ];
    for (const [error, status] of cases) {
      expect(error.statusCode).toBe(status);
      const body = error.toResponse();
      expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
      expect(body.error.code).toBe(error.code);
    }
    expect(notFound('Session').message).toBe('Session not found');
    expect(validationFailed('bad', { issues: [1] }).toResponse().error.details).toEqual({ issues: [1] });
    expect('details' in notFound('x').toResponse().error).toBe(false);
  });
});

describe('error handler', () => {
  async function build() {
    const app = Fastify();
    registerErrorHandling(app);
    app.get('/app-error', async () => {
      throw new AppError('conflict', 'already there', { id: 1 });
    });
    app.get('/crash', async () => {
      throw new Error('secret stack trace details');
    });
    app.get('/status-error', async () => {
      throw Object.assign(new Error('fastify style'), { statusCode: 400 });
    });
    await app.ready();
    return app;
  }

  it('returns AppErrors with their status, code and details', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/app-error' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: { code: 'conflict', message: 'already there', details: { id: 1 } } });
    await app.close();
  });

  it('hides unexpected errors behind a generic internal response', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ ok: false, error: { code: 'internal', message: 'Internal server error' } });
    expect(res.body).not.toContain('secret');
    await app.close();
  });

  it('maps Fastify status codes and unknown routes onto API codes', async () => {
    const app = await build();
    const bad = await app.inject({ method: 'GET', url: '/status-error' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ ok: false, error: { code: 'validation_failed', message: 'fastify style' } });

    const missing = await app.inject({ method: 'GET', url: '/nowhere?key=rp_secret' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ ok: false, error: { code: 'not_found', message: 'Route GET /nowhere not found' } });
    await app.close();
  });
});
