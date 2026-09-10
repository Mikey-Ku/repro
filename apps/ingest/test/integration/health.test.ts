import { HealthSchema } from '@repro/contracts';
import { createDb } from '@repro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { INTERNAL_TOKEN, startTestApp, type TestEnv } from './helpers.js';

describe('health endpoints', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startTestApp();
  });
  afterAll(async () => {
    await env.close();
  });

  it('GET /health reports liveness without touching the database', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthSchema.parse(res.json());
    expect(body).toMatchObject({ ok: true, service: 'ingest' });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.checks).toBeUndefined();
  });

  it('GET /ready runs SELECT 1', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(HealthSchema.parse(res.json())).toMatchObject({ ok: true, checks: { database: 'ok' } });
  });

  it('GET /ready answers 503 when the database is unreachable', async () => {
    // Port 1 is never Postgres: the connection is refused immediately.
    const dead = createDb('postgres://repro:repro@127.0.0.1:1/repro', { max: 1 });
    const app = await buildApp({ db: dead, internalToken: INTERNAL_TOKEN, maxBatchBytes: 1000, artifactsDir: env.artifactsDir, logger: false });
    try {
      const res = await app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(503);
      expect(HealthSchema.parse(res.json())).toMatchObject({ ok: false, checks: { database: 'fail' } });
      // Liveness is unaffected.
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    } finally {
      await app.close();
      await dead.close();
    }
  });

  it('unknown routes answer in the API error shape', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: { code: 'not_found', message: 'Route GET /nope not found' } });
  });
});
