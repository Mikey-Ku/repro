import type { RunTargetMode } from '@repro/contracts';

const REQUEST_TIMEOUT_MS = 5000;

/** Thrown when the demo application does not answer; the run is stored as an error, not retried. */
export class DemoUnreachableError extends Error {
  constructor(demoUrl: string, cause: unknown) {
    super(`Demo application is not reachable at ${demoUrl}`, { cause });
    this.name = 'DemoUnreachableError';
  }
}

function isMode(value: unknown): value is RunTargetMode {
  return value === 'broken' || value === 'fixed';
}

/** The demo's current mode, read through its control endpoint. */
export async function getDemoMode(demoUrl: string): Promise<RunTargetMode> {
  let response: Response;
  try {
    response = await fetch(`${demoUrl}/__demo/mode`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new DemoUnreachableError(demoUrl, error);
  }
  if (!response.ok) throw new DemoUnreachableError(demoUrl, new Error(`GET /__demo/mode returned ${response.status}`));
  const body = (await response.json()) as { mode?: unknown };
  if (!isMode(body.mode)) throw new DemoUnreachableError(demoUrl, new Error('GET /__demo/mode returned no mode'));
  return body.mode;
}

/** Switch the demo between its broken and fixed checkout. The setting is process state, not persisted. */
export async function setDemoMode(demoUrl: string, mode: RunTargetMode): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${demoUrl}/__demo/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DemoUnreachableError(demoUrl, error);
  }
  if (!response.ok) throw new DemoUnreachableError(demoUrl, new Error(`POST /__demo/mode returned ${response.status}`));
}
