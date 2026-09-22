import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveTarget } from '../src/jobs/run-reproduction.js';
import type { ExecuteOptions, ExecuteResult } from '../src/runner/execute.js';
import { executeRun, targetUrl, type DemoModeClient, type RunnerOptions } from '../src/runner/run.js';

const DEMO_URL = 'http://localhost:4100';
const TARGET_URL = 'https://staging.example.com';
const log = pino({ level: 'silent' });

/** A generator-shaped spec. `origin` is quoted in a comment-free string so the URL rule sees it. */
const spec = (origin: string) => `import { test, expect } from '@playwright/test';

test('checkout', async ({ page }) => {
  await page.goto('/login');
  const responsePromise = page.waitForResponse((response) => response.url() === '${origin}/api/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await responsePromise;
  await expect(page.getByTestId('order-confirmation')).toBeVisible();
});
`;

/** A fake demo control endpoint that records every call. */
function fakeDemoMode(initial: 'broken' | 'fixed' = 'broken') {
  let mode = initial;
  const client: DemoModeClient = {
    get: vi.fn(async () => mode),
    set: vi.fn(async (_url: string, next: 'broken' | 'fixed') => {
      mode = next;
    }),
  };
  return { client, current: () => mode };
}

/** A fake Playwright child that writes a passing report and records how it was invoked. */
function fakeExecute() {
  const calls: ExecuteOptions[] = [];
  const execute = async (options: ExecuteOptions): Promise<ExecuteResult> => {
    calls.push(options);
    const report = { suites: [{ specs: [{ title: 't', ok: true, tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }] }], stats: { expected: 1, unexpected: 0 } };
    await fs.writeFile(path.join(options.workspaceDir, 'report.json'), JSON.stringify(report), 'utf8');
    return { stdout: 'ok', stderr: '', exitCode: 0, timedOut: false };
  };
  return { calls, execute };
}

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'repro-run-targets-'));
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const options = (overrides: Partial<RunnerOptions>): RunnerOptions => ({
  demoUrl: DEMO_URL,
  artifactsDir: path.join(root, 'artifacts'),
  workspaceDir: path.join(root, 'workspace'),
  runTimeoutMs: 10_000,
  log,
  ...overrides,
});

describe('targetUrl', () => {
  it('is the demo for the demo target and the stored origin for an external one', () => {
    expect(targetUrl({ kind: 'demo', mode: 'broken' }, DEMO_URL)).toBe(DEMO_URL);
    expect(targetUrl({ kind: 'external', url: TARGET_URL }, DEMO_URL)).toBe(TARGET_URL);
  });
});

describe('executeRun against an external target', () => {
  it('never touches the demo mode endpoint and points Playwright at the target origin', async () => {
    const demo = fakeDemoMode('broken');
    const child = fakeExecute();
    const outcome = await executeRun(
      { runId: randomUUID(), code: spec(TARGET_URL), target: { kind: 'external', url: TARGET_URL } },
      options({ demoMode: demo.client, execute: child.execute }),
    );
    expect(outcome.status, outcome.failureMessage ?? '').toBe('passed');
    expect(demo.client.get).not.toHaveBeenCalled();
    expect(demo.client.set).not.toHaveBeenCalled();
    expect(child.calls).toHaveLength(1);
    expect(child.calls[0]!.targetUrl).toBe(TARGET_URL);
    expect(outcome.artifacts.map((a) => a.name)).toEqual(['report.json']);
  });

  it('validates the code against the target origin, not the demo origin', async () => {
    const demo = fakeDemoMode('broken');
    const child = fakeExecute();
    // The same code that passes for the demo target is rejected for the external one, and the
    // other way round, because the only allowed absolute URL origin is the run's target.
    const rejected = await executeRun(
      { runId: randomUUID(), code: spec(DEMO_URL), target: { kind: 'external', url: TARGET_URL } },
      options({ demoMode: demo.client, execute: child.execute }),
    );
    expect(rejected.status).toBe('error');
    expect(rejected.failureMessage).toContain(`only reference the target application at ${TARGET_URL}`);
    expect(rejected.failureMessage).toContain(DEMO_URL);
    expect(child.calls).toHaveLength(0);
    expect(demo.client.get).not.toHaveBeenCalled();

    const accepted = await executeRun(
      { runId: randomUUID(), code: spec(DEMO_URL), target: { kind: 'demo', mode: 'broken' } },
      options({ demoMode: demo.client, execute: child.execute }),
    );
    expect(accepted.status, accepted.failureMessage ?? '').toBe('passed');
    expect(child.calls[0]!.targetUrl).toBe(DEMO_URL);
  });
});

describe('executeRun against the demo target', () => {
  it('still switches the demo into the requested mode and restores it afterwards', async () => {
    const demo = fakeDemoMode('broken');
    const child = fakeExecute();
    const outcome = await executeRun(
      { runId: randomUUID(), code: spec(DEMO_URL), target: { kind: 'demo', mode: 'fixed' } },
      options({ demoMode: demo.client, execute: child.execute }),
    );
    expect(outcome.status).toBe('passed');
    expect(demo.client.get).toHaveBeenCalledWith(DEMO_URL);
    expect(demo.client.set).toHaveBeenNthCalledWith(1, DEMO_URL, 'fixed');
    expect(demo.client.set).toHaveBeenNthCalledWith(2, DEMO_URL, 'broken');
    expect(demo.current()).toBe('broken');
    expect(child.calls[0]!.targetUrl).toBe(DEMO_URL);
  });
});

describe('resolveTarget', () => {
  it('maps run rows to runner targets and refuses what cannot be executed', () => {
    expect(resolveTarget({ target: 'demo', targetMode: 'fixed', targetUrl: null })).toEqual({ ok: true, spec: { kind: 'demo', mode: 'fixed' } });
    expect(resolveTarget({ target: 'demo', targetMode: 'none', targetUrl: null })).toMatchObject({ ok: false });
    expect(resolveTarget({ target: 'a1b2c3d4', targetMode: 'none', targetUrl: 'https://staging.example.com/' })).toEqual({
      ok: true,
      spec: { kind: 'external', url: 'https://staging.example.com' },
    });
    expect(resolveTarget({ target: 'a1b2c3d4', targetMode: 'none', targetUrl: null })).toMatchObject({ ok: false, reason: expect.stringContaining('a1b2c3d4') });
    expect(resolveTarget({ target: 'a1b2c3d4', targetMode: 'none', targetUrl: 'javascript:alert(1)' })).toMatchObject({ ok: false });
  });
});
