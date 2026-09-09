import { defineConfig, devices } from '@playwright/test';
import { env, repoRoot } from './support/env.js';

const serverEnv = {
  ...process.env,
  DATABASE_URL: env.databaseUrl,
  INGEST_URL: env.ingestUrl,
  DEMO_URL: env.demoUrl,
  DEMO_PROJECT_KEY: env.demoProjectKey,
  REPRO_INTERNAL_TOKEN: env.internalToken,
  NEXT_PUBLIC_APP_URL: env.webUrl,
  DEMO_MODE: 'broken',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
};

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './test-results',
  use: {
    baseURL: env.demoUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'pnpm --filter @repro/ingest start',
      url: `${env.ingestUrl}/ready`,
      cwd: repoRoot,
      env: serverEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @repro/worker start',
      url: `${env.workerUrl}/health`,
      cwd: repoRoot,
      env: serverEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @repro/demo start',
      url: `${env.demoUrl}/__demo/health`,
      cwd: repoRoot,
      env: serverEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @repro/web start',
      url: `${env.webUrl}/api/health`,
      cwd: repoRoot,
      env: serverEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
