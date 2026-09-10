import { createDb } from '@repro/db';
import { buildApp } from './app.js';
import { loadRootEnv, readEnv } from './env.js';

/**
 * Process entry point: load the repo-root .env (never overriding variables already set), connect
 * to Postgres, build the app and listen. SIGINT/SIGTERM close the server first (so in-flight
 * requests finish) and the database pool second.
 */
async function main(): Promise<void> {
  loadRootEnv();
  const env = readEnv();

  const db = createDb(env.databaseUrl);
  const prettyLogs = process.stdout.isTTY && process.env.NODE_ENV !== 'production';
  const app = await buildApp({
    db,
    internalToken: env.internalToken,
    maxBatchBytes: env.maxBatchBytes,
    artifactsDir: env.artifactsDir,
    appUrl: env.appUrl,
    rateLimit: { max: env.rateLimitPerMinute, timeWindow: '1 minute' },
    logger: prettyLogs
      ? { level: env.logLevel, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : { level: env.logLevel },
  });

  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => db.close())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host: env.host, port: env.port });
  app.log.info({ artifactsDir: env.artifactsDir, maxBatchBytes: env.maxBatchBytes }, 'ingest ready');
}

main().catch((error: unknown) => {
  console.error('[ingest] failed to start', error);
  process.exit(1);
});
