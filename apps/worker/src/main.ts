import fs from 'node:fs';
import path from 'node:path';
import { createDb } from '@repro/db';
import { appDir, loadRootEnv, readEnv } from './env.js';
import { startHealthServer } from './health.js';
import { createLogger } from './logger.js';
import { Worker } from './worker.js';

loadRootEnv();
const env = readEnv();
const log = createLogger(env.logLevel, env.workerId);

const version = (JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')) as { version: string }).version;

fs.mkdirSync(env.artifactsDir, { recursive: true });
fs.mkdirSync(env.workspaceDir, { recursive: true });

const handle = createDb(env.databaseUrl, { max: 4 });
const worker = new Worker({
  db: handle.db,
  log,
  workerId: env.workerId,
  pollMs: env.pollMs,
  runner: {
    demoUrl: env.demoUrl,
    artifactsDir: env.artifactsDir,
    workspaceDir: env.workspaceDir,
    runTimeoutMs: env.runTimeoutMs,
  },
});

const health = await startHealthServer(env.port, {
  version,
  queueDepth: () => worker.queueDepth(),
  running: () => worker.running(),
});
worker.start();
log.info(
  { port: health.port, demoUrl: env.demoUrl, artifactsDir: env.artifactsDir, workspaceDir: env.workspaceDir, pollMs: env.pollMs },
  'worker started',
);

let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    // A second signal means "now": skip the graceful wait.
    log.warn({ signal }, 'forced exit');
    process.exit(1);
  }
  stopping = true;
  log.info({ signal, running: worker.running() }, 'shutting down; waiting for the current job');
  try {
    await worker.stop();
    await health.close();
    await handle.close();
    log.info('worker stopped');
    process.exit(0);
  } catch (error) {
    log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
