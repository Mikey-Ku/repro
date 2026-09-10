import pino, { type Logger } from 'pino';

export type { Logger };

/**
 * Structured JSON logs, like the ingest API. Set LOG_PRETTY=1 for human-readable output during
 * local development (pino-pretty is a dev dependency, so production never loads it).
 */
export function createLogger(level: string, workerId: string): Logger {
  const pretty = process.env.LOG_PRETTY === '1';
  return pino({
    level,
    base: { service: 'worker', workerId },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}
