import http from 'node:http';

export interface HealthState {
  version: string;
  /** Queued jobs waiting for a worker. Read on every request so the number is live. */
  queueDepth: () => Promise<number>;
  /** Id of the job being handled right now, or null when idle. */
  running: () => string | null;
}

export interface HealthServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * A tiny liveness endpoint on node:http (no framework needed for one route). The E2E harness
 * waits for GET /health before it starts the journey.
 */
export function startHealthServer(port: number, state: HealthState): Promise<HealthServer> {
  const startedAt = Date.now();
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url?.split('?')[0] !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Not found' } }));
      return;
    }
    let body: string;
    let status = 200;
    try {
      body = JSON.stringify({
        ok: true,
        service: 'worker',
        version: state.version,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        queueDepth: await state.queueDepth(),
        running: state.running(),
      });
    } catch (error) {
      status = 503;
      body = JSON.stringify({
        ok: false,
        service: 'worker',
        version: state.version,
        error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
      });
    }
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(body);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: boundPort,
        close: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections();
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
