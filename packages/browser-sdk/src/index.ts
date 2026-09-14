/**
 * Public entry point. `Repro.init()` creates the active client; the other `Repro` methods
 * delegate to it so script-tag users never need to keep a reference.
 */
import { createClient } from './client.js';
import type { ReproClient, ReproMode, ReproOptions } from './types.js';
import { version } from './version.js';

export type { ReproClient, ReproMode, ReproOptions } from './types.js';
export { version };

/** True in a real browser page. False under SSR, workers and plain Node, where init() is a no-op. */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof location !== 'undefined';
}

const noopClient: ReproClient = {
  start() {},
  stop() {},
  captureException() {},
  identify() {},
  annotate() {},
  flagIncident() {},
  flush: () => Promise.resolve(),
  getSessionId: () => null,
  isRecording: () => false,
  getMode: () => 'always',
  hasTriggered: () => false,
};

let active: ReproClient | null = null;

function init(options: ReproOptions): ReproClient {
  if (!isBrowser()) return noopClient;
  if (!options || typeof options.projectKey !== 'string' || typeof options.endpoint !== 'string') {
    console.warn('[repro] init() needs projectKey and endpoint; recording disabled');
    return noopClient;
  }
  // Re-initialising ends the previous session cleanly rather than leaking two recorders.
  if (active) active.stop();
  active = createClient(options);
  if (options.autoStart !== false) active.start();
  return active;
}

export const Repro = {
  init,
  start: () => active?.start(),
  stop: () => active?.stop(),
  captureException: (error: unknown, context?: Record<string, string | number | boolean>) =>
    active?.captureException(error, context),
  identify: (userId: string, traits?: Record<string, string | number | boolean>) => active?.identify(userId, traits),
  annotate: (name: string, data?: Record<string, string | number | boolean>) => active?.annotate(name, data),
  flagIncident: (reason: string, data?: Record<string, string | number | boolean>) => active?.flagIncident(reason, data),
  flush: (): Promise<void> => active?.flush() ?? Promise.resolve(),
  getSessionId: (): string | null => active?.getSessionId() ?? null,
  isRecording: (): boolean => active?.isRecording() ?? false,
  getMode: (): ReproMode => active?.getMode() ?? 'always',
  hasTriggered: (): boolean => active?.hasTriggered() ?? false,
  version,
};

export default Repro;
