import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { RunTargetMode, runTargetOrigin } from '@repro/contracts';
import { generatedTests, reproductionRuns, type Db, type RunRow } from '@repro/db';
import type { Logger } from '../logger.js';
import { executeRun, type RunnerOptions, type RunTargetSpec } from '../runner/run.js';

export const RunReproductionPayload = z.object({ projectId: z.uuid(), runId: z.uuid() });
export type RunReproductionPayload = z.infer<typeof RunReproductionPayload>;

export type RunReproductionResult = { skipped: true; reason: string } | { skipped: false; status: string };

type ResolvedTarget = { ok: true; spec: RunTargetSpec } | { ok: false; reason: string };

/**
 * Turn the run row's target columns into what the runner needs. The demo target must carry a
 * mode; any other target is external and must carry the origin the ingest API copied onto the
 * row when the run was queued. Nothing else is executable.
 */
export function resolveTarget(run: Pick<RunRow, 'target' | 'targetMode' | 'targetUrl'>): ResolvedTarget {
  if (run.target === 'demo') {
    const mode = RunTargetMode.safeParse(run.targetMode);
    if (!mode.success) return { ok: false, reason: `Unknown target mode "${run.targetMode}" for the demo target.` };
    return { ok: true, spec: { kind: 'demo', mode: mode.data } };
  }
  const url = run.targetUrl ? runTargetOrigin(run.targetUrl) : null;
  if (!url) {
    return { ok: false, reason: `Run target "${run.target}" has no valid origin stored on the run; it cannot be executed.` };
  }
  return { ok: true, spec: { kind: 'external', url } };
}

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
  const target = resolveTarget(run);
  if (!target.ok) {
    await db
      .update(reproductionRuns)
      .set({ status: 'error', failureMessage: target.reason, finishedAt: new Date(), durationMs: 0 })
      .where(eq(reproductionRuns.id, run.id));
    return { skipped: false, status: 'error' };
  }

  const startedAt = new Date();
  await db.update(reproductionRuns).set({ status: 'running', startedAt }).where(eq(reproductionRuns.id, run.id));

  try {
    const outcome = await executeRun({ runId: run.id, code, target: target.spec }, options);
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
