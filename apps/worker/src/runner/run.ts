import fs from 'node:fs/promises';
import type { RunStatus, RunTargetMode } from '@repro/contracts';
import type { Logger } from '../logger.js';
import { collectArtifacts, type Artifact } from './artifacts.js';
import { DemoUnreachableError, getDemoMode, setDemoMode } from './demo-mode.js';
import { executePlaywright } from './execute.js';
import { parseReport } from './report.js';
import { validateTestCode } from './validate.js';
import { createWorkspace, removeWorkspace, type Workspace } from './workspace.js';

export const MAX_LOG_BYTES = 200 * 1024;

/**
 * Where a run executes. The bundled demo is switched into the requested mode for the duration
 * of the run; an external target is an origin the project owner configured, and nothing about
 * it is switched: the test simply runs against it as it is.
 */
export type RunTargetSpec = { kind: 'demo'; mode: RunTargetMode } | { kind: 'external'; url: string };

export interface RunInput {
  runId: string;
  code: string;
  target: RunTargetSpec;
}

/** The demo's mode control, injectable so a unit test can prove it is never touched for an external target. */
export interface DemoModeClient {
  get: (demoUrl: string) => Promise<RunTargetMode>;
  set: (demoUrl: string, mode: RunTargetMode) => Promise<void>;
}

export interface RunnerOptions {
  demoUrl: string;
  artifactsDir: string;
  workspaceDir: string;
  runTimeoutMs: number;
  log: Logger;
  /** Test seams. Production uses the real demo control endpoint and the real Playwright child. */
  demoMode?: DemoModeClient;
  execute?: typeof executePlaywright;
}

/** Everything the job handler writes back onto the reproduction_runs row. */
export interface RunOutcome {
  status: Exclude<RunStatus, 'queued' | 'running'>;
  failureMessage: string | null;
  logs: string | null;
  exitCode: number | null;
  artifacts: Artifact[];
  finishedAt: Date;
  durationMs: number;
}

/** Keep the tail of the output: Playwright prints its error summary last. */
export function truncateLogs(stdout: string, stderr: string): string | null {
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n\n--- stderr ---\n');
  if (!combined) return null;
  if (Buffer.byteLength(combined, 'utf8') <= MAX_LOG_BYTES) return combined;
  const tail = Buffer.from(combined, 'utf8').subarray(-MAX_LOG_BYTES).toString('utf8');
  return `[... earlier output truncated to ${MAX_LOG_BYTES} bytes ...]\n${tail}`;
}

async function readReport(reportPath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(reportPath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** The origin Playwright is pointed at: the demo, or the external target's stored origin. */
export function targetUrl(target: RunTargetSpec, demoUrl: string): string {
  return target.kind === 'demo' ? demoUrl : target.url;
}

/**
 * Execute one reproduction run end to end. Never throws for anything the run itself can
 * cause (bad code, unreachable demo, failing or hanging test): those become an outcome. Only
 * infrastructure failures (cannot write the workspace, say) propagate to the job handler.
 */
export async function executeRun(input: RunInput, options: RunnerOptions): Promise<RunOutcome> {
  const startedAt = Date.now();
  const log = options.log.child({ runId: input.runId });
  const demoMode: DemoModeClient = options.demoMode ?? { get: getDemoMode, set: setDemoMode };
  const execute = options.execute ?? executePlaywright;
  const url = targetUrl(input.target, options.demoUrl);
  const finish = (partial: Omit<RunOutcome, 'finishedAt' | 'durationMs'>): RunOutcome => {
    const finishedAt = new Date();
    return { ...partial, finishedAt, durationMs: finishedAt.getTime() - startedAt };
  };
  const errorOutcome = (failureMessage: string, logs: string | null = null): RunOutcome =>
    finish({ status: 'error', failureMessage, logs, exitCode: null, artifacts: [] });

  // 1. Validation against the origin this run targets. Rejected code is never written to disk.
  const validation = validateTestCode(input.code, url);
  if (!validation.ok) {
    log.warn({ reason: validation.reason }, 'generated test rejected by validator');
    return errorOutcome(`Generated test was rejected before execution: ${validation.reason}`);
  }

  // 2. Demo target only: point the demo at the requested mode, remembering what it was so it can
  //    be put back. An external target has no mode and its control endpoint is never called.
  let previousMode: RunTargetMode | undefined;
  if (input.target.kind === 'demo') {
    try {
      previousMode = await demoMode.get(options.demoUrl);
      if (previousMode !== input.target.mode) await demoMode.set(options.demoUrl, input.target.mode);
    } catch (error) {
      if (error instanceof DemoUnreachableError) {
        log.warn({ err: error }, 'demo application unreachable');
        return errorOutcome(error.message);
      }
      throw error;
    }
  }
  const restoreMode = input.target.kind === 'demo' && previousMode !== undefined && previousMode !== input.target.mode ? previousMode : null;

  let workspace: Workspace | undefined;
  try {
    // 3. Workspace with the fixed config and the validated spec.
    workspace = await createWorkspace(options.workspaceDir, input.runId, input.code);
    log.info({ workspace: workspace.dir, target: input.target.kind, url, mode: input.target.kind === 'demo' ? input.target.mode : 'none' }, 'running playwright');

    // 4. Execute with a hard timeout and an allowlisted environment. REPRO_TARGET_URL is the
    //    target origin, which the fixed config uses as baseURL.
    const result = await execute({
      workspaceDir: workspace.dir,
      configPath: workspace.configPath,
      targetUrl: url,
      timeoutMs: options.runTimeoutMs,
    });
    const logs = truncateLogs(result.stdout, result.stderr);

    // 5. Artifacts are copied out before the workspace is removed.
    const artifacts = await collectArtifacts({
      artifactsRoot: options.artifactsDir,
      runId: input.runId,
      resultsDir: workspace.resultsDir,
      reportPath: workspace.reportPath,
    });

    if (result.timedOut) {
      return finish({
        status: 'timeout',
        failureMessage: `Run exceeded the ${options.runTimeoutMs} ms limit and was killed.`,
        logs,
        exitCode: null,
        artifacts,
      });
    }

    const report = await readReport(workspace.reportPath);
    if (report === undefined) {
      const message =
        result.exitCode === 0
          ? 'Playwright exited without writing report.json.'
          : `Playwright exited with code ${result.exitCode ?? 'null'} without writing report.json.`;
      return finish({ status: 'error', failureMessage: message, logs, exitCode: result.exitCode, artifacts });
    }

    const parsed = parseReport(report);
    log.info({ outcome: parsed.outcome, tests: parsed.tests, exitCode: result.exitCode }, 'playwright finished');
    return finish({
      status: parsed.outcome,
      failureMessage: parsed.failureMessage,
      logs,
      exitCode: result.exitCode,
      artifacts,
    });
  } finally {
    // 6 and 7. Always restore the demo (when it was switched) and drop the workspace, whatever happened above.
    if (restoreMode !== null) {
      await demoMode.set(options.demoUrl, restoreMode).catch((error: unknown) => {
        log.error({ err: error }, 'could not restore demo mode');
      });
    }
    if (workspace) {
      await removeWorkspace(workspace).catch((error: unknown) => {
        log.error({ err: error, workspace: workspace?.dir }, 'could not remove workspace');
      });
    }
  }
}
