import { describe, expect, it } from 'vitest';
import { startHealthServer } from '../src/health.js';

describe('health server', () => {
  it('answers GET /health with the worker state and 404 elsewhere', async () => {
    const server = await startHealthServer(0, { version: '0.1.0', queueDepth: async () => 3, running: () => 'job-1' });
    try {
      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(health.status).toBe(200);
      const body = (await health.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ ok: true, service: 'worker', version: '0.1.0', queueDepth: 3, running: 'job-1' });
      expect(typeof body.uptimeSeconds).toBe('number');

      const missing = await fetch(`http://127.0.0.1:${server.port}/nope`);
      expect(missing.status).toBe(404);
      const post = await fetch(`http://127.0.0.1:${server.port}/health`, { method: 'POST' });
      expect(post.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns 503 when the queue cannot be read', async () => {
    const server = await startHealthServer(0, {
      version: '0.1.0',
      queueDepth: async () => {
        throw new Error('database down');
      },
      running: () => null,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, error: { message: 'database down' } });
    } finally {
      await server.close();
    }
  });
});
