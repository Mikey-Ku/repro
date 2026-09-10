import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDir, loadRootEnv } from '../src/env.js';
import { getDemoMode } from '../src/runner/demo-mode.js';
import { executeRun } from '../src/runner/run.js';

loadRootEnv();

/**
 * Executes real Playwright against the running demo application. Opt in with
 * RUN_RUNNER_SMOKE=1 (needs `pnpm --filter @repro/demo start` and installed Chromium).
 */
const enabled = process.env.RUN_RUNNER_SMOKE === '1';

const demoUrl = (process.env.DEMO_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
let artifactsDir: string;
// The workspace must stay under apps/worker so the spec resolves @playwright/test.
const workspaceDir = path.join(appDir, 'workspace');
const log = pino({ level: 'silent' });

const spec = (body: string) => `import { test, expect } from '@playwright/test';

test('smoke', async ({ page }) => {
  await page.goto('/login');
${body}
});
`;

describe.skipIf(!enabled)('reproduction runner smoke test', () => {
  let previousMode: 'broken' | 'fixed';

  beforeAll(async () => {
    artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repro-artifacts-'));
    previousMode = await getDemoMode(demoUrl);
  });

  afterAll(async () => {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  });

  const options = () => ({ demoUrl, artifactsDir, workspaceDir, runTimeoutMs: 90_000, log });

  it('passes a test that reaches the demo login page and restores the demo mode', async () => {
    const runId = randomUUID();
    const outcome = await executeRun(
      { runId, code: spec("  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();"), targetMode: 'fixed' },
      options(),
    );
    expect(outcome.status, outcome.failureMessage ?? outcome.logs ?? '').toBe('passed');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.artifacts.map((a) => a.name)).toEqual(['trace.zip', 'report.json']);
    expect(outcome.durationMs).toBeGreaterThan(0);
    await expect(fs.access(path.join(workspaceDir, runId))).rejects.toThrow();
    expect(await getDemoMode(demoUrl)).toBe(previousMode);
  });

  it('fails a test whose expectation does not hold and keeps the screenshot', async () => {
    const runId = randomUUID();
    const outcome = await executeRun(
      { runId, code: spec("  await expect(page.getByTestId('does-not-exist')).toBeVisible();"), targetMode: 'broken' },
      options(),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.failureMessage).toMatch(/does-not-exist/);
    expect(outcome.failureMessage).not.toContain('\u001b');
    expect(outcome.artifacts.map((a) => a.name)).toEqual(['screenshot.png', 'trace.zip', 'report.json']);
    expect(await getDemoMode(demoUrl)).toBe(previousMode);
  });

  it('reports a timeout when the test hangs past the limit', async () => {
    const outcome = await executeRun(
      { runId: randomUUID(), code: spec('  await page.waitForTimeout(60_000);'), targetMode: 'broken' },
      { ...options(), runTimeoutMs: 8_000 },
    );
    expect(outcome.status).toBe('timeout');
    expect(outcome.exitCode).toBeNull();
    expect(await getDemoMode(demoUrl)).toBe(previousMode);
  });

  it('stores an error without executing when the demo is unreachable', async () => {
    const outcome = await executeRun(
      { runId: randomUUID(), code: spec(''), targetMode: 'broken' },
      { ...options(), demoUrl: 'http://127.0.0.1:1' },
    );
    expect(outcome.status).toBe('error');
    expect(outcome.failureMessage).toBe('Demo application is not reachable at http://127.0.0.1:1');
    expect(outcome.artifacts).toEqual([]);
  });
});
