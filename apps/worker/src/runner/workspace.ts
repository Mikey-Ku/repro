import fs from 'node:fs/promises';
import path from 'node:path';

export const SPEC_FILE = 'repro.spec.ts';
export const CONFIG_FILE = 'playwright.config.ts';
export const REPORT_FILE = 'report.json';
export const RESULTS_DIR = 'test-results';

/**
 * The Playwright config every run uses. It is written next to the spec so that the generated
 * code cannot change it. Chromium only, one worker, no retries, trace always on so a failed run
 * can be opened in the trace viewer, screenshot only when a step fails.
 */
export const PLAYWRIGHT_CONFIG = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  expect: { timeout: 5000 },
  retries: 0,
  workers: 1,
  reporter: [['json', { outputFile: '${REPORT_FILE}' }]],
  outputDir: '${RESULTS_DIR}',
  use: {
    baseURL: process.env.REPRO_TARGET_URL,
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: true,
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
});
`;

export interface Workspace {
  dir: string;
  configPath: string;
  specPath: string;
  reportPath: string;
  resultsDir: string;
}

/** Create `${root}/<runId>/` with the fixed config and the validated spec inside. */
export async function createWorkspace(root: string, runId: string, code: string): Promise<Workspace> {
  const dir = path.join(root, runId);
  // A leftover from a crashed attempt must not leak an old report into this run.
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(dir, CONFIG_FILE);
  const specPath = path.join(dir, SPEC_FILE);
  await fs.writeFile(configPath, PLAYWRIGHT_CONFIG, 'utf8');
  await fs.writeFile(specPath, code, 'utf8');
  return {
    dir,
    configPath,
    specPath,
    reportPath: path.join(dir, REPORT_FILE),
    resultsDir: path.join(dir, RESULTS_DIR),
  };
}

export async function removeWorkspace(workspace: Workspace): Promise<void> {
  await fs.rm(workspace.dir, { recursive: true, force: true });
}
