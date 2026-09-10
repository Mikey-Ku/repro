import type { DbHandle } from '@repro/db';
import type { Investigator } from '@repro/diagnostics';
import type { generatePlaywrightTest } from '@repro/test-generator';

export type GenerateTestFn = typeof generatePlaywrightTest;

/**
 * Everything the routes and services need, assembled once in buildApp and passed down explicitly.
 * Keeping it a plain object (instead of Fastify decorators) makes tests and typing straightforward.
 */
export interface AppContext {
  db: DbHandle['db'];
  sql: DbHandle['sql'];
  internalToken: string;
  maxBatchBytes: number;
  /** Where reproduction runs store their artifacts. Relative artifact paths resolve against it. */
  artifactsDir: string;
  /** Base URL of the dashboard, used for links inside generated tests. */
  appUrl: string;
  investigator: Investigator;
  generateTest: GenerateTestFn;
  version: string;
  /** Process start, for the uptime reported by /health. */
  startedAt: number;
}
