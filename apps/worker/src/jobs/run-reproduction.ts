import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { RunTargetMode } from '@repro/contracts';
import { generatedTests, reproductionRuns, type Db } from '@repro/db';
import type { Logger } from '../logger.js';
import { executeRun, type RunnerOptions } from '../runner/run.js';

export const RunReproductionPayload = z.object({ projectId: z.uuid(), runId: z.uuid() });
export type RunReproductionPayload = z.infer<typeof RunReproductionPayload>;

export type RunReproductionResult = { skipped: true; reason: string } | { skipped: false; status: string };

/**
 * Drive one reproduction_runs row through the runner. The row goes to `running` first so the
 * dashboard can show progress, and always ends in a terminal status, even when the runner
 * itself throws, so a run never stays "running" forever.
 */
export async function runReproduction(
  db: Db,
  payload: RunReproductionPayload,
  options: Omit<RunnerOptions, 'log'> & { log: Logger },
): Promise<RunReproductionResult> {
  const [row] = await db
    .select({ run: reproductionRuns, code: generatedTests.code })
    .from(reproductionRuns)
    .innerJoin(generatedTests, eq(generatedTests.id, reproductionRuns.generatedTestId))
    .where(and(eq(reproductionRuns.id, payload.runId), eq(reproductionRuns.projectId, payload.projectId)))
    .limit(1);
  if (!row) throw new Error(`Run ${payload.runId} not found in project ${payload.projectId}`);

  const { run, code } = row;
  // A retried job must not re-execute a run that already finished.
  if (run.status !== 'queued' && run.status !== 'running') {
    return { skipped: true, reason: `run is already ${run.status}` };
  }
  if (run.target !== 'demo') {
    await db
      .update(reproductionRuns)
      .set({
        status: 'error',
        failureMessage: `Unsupported run target "${run.target}"; only the bundled demo application can be targeted in this release.`,
        finishedAt: new Date(),
        durationMs: 0,
      })
      .where(eq(reproductionRuns.id, run.id));
    return { skipped: false, status: 'error' };
  }

  const targetMode = RunTargetMode.safeParse(run.targetMode);
  const startedAt = new Date();
  await db.update(reproductionRuns).set({ status: 'running', startedAt }).where(eq(reproductionRuns.id, run.id));

  try {
    if (!targetMode.success) throw new Error(`Unknown target mode "${run.targetMode}"`);
    const outcome = await executeRun({ runId: run.id, code, targetMode: targetMode.data }, options);
    await db
      .update(reproductionRuns)
      .set({
        status: outcome.status,
        failureMessage: outcome.failureMessage,
        logs: outcome.logs,
        exitCode: outcome.exitCode,
        artifacts: outcome.artifacts,
        finishedAt: outcome.finishedAt,
        durationMs: outcome.durationMs,
      })
      .where(eq(reproductionRuns.id, run.id));
    return { skipped: false, status: outcome.status };
  } catch (error) {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(reproductionRuns)
      .set({
        status: 'error',
        failureMessage: `Worker failed to execute the run: ${message}`,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      })
      .where(eq(reproductionRuns.id, run.id));
    throw error;
  }
}
