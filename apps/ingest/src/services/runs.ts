import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import type { RunTargetMode } from '@repro/contracts';
import { enqueueJob, reproductionRuns, type Db, type GeneratedTestRow, type RunRow } from '@repro/db';
import { asDb } from './tx.js';

/**
 * Queue a reproduction run. The row and its job are written in one transaction so a run can
 * never exist without the job that executes it (or the other way round).
 */
export async function createRun(db: Db, test: GeneratedTestRow, mode: RunTargetMode): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(reproductionRuns)
      .values({
        projectId: test.projectId,
        sessionId: test.sessionId,
        generatedTestId: test.id,
        status: 'queued',
        target: 'demo',
        targetMode: mode,
      })
      .returning();
    if (!run) throw new Error('Run insert returned no row');
    await enqueueJob(asDb(tx), 'run_reproduction', { projectId: run.projectId, runId: run.id });
    return run;
  });
}

export async function listRunsForTest(db: Db, projectId: string, testId: string): Promise<RunRow[]> {
  return db
    .select()
    .from(reproductionRuns)
    .where(and(eq(reproductionRuns.projectId, projectId), eq(reproductionRuns.generatedTestId, testId)))
    .orderBy(desc(reproductionRuns.queuedAt), desc(reproductionRuns.id));
}

export async function getRun(db: Db, projectId: string, runId: string): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(reproductionRuns)
    .where(and(eq(reproductionRuns.id, runId), eq(reproductionRuns.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

export interface ResolvedArtifact {
  name: string;
  contentType: string;
  bytes: number;
  /** Absolute path on this machine. */
  filePath: string;
}

/**
 * Only names the worker recorded on the run can be served, so a client can never turn the
 * artifact route into a file browser. Paths are written by the worker; relative ones live
 * under the artifacts directory.
 */
export function resolveArtifact(run: RunRow, name: string, artifactsDir: string): ResolvedArtifact | null {
  const artifact = run.artifacts.find((entry) => entry.name === name);
  if (!artifact) return null;
  const filePath = path.isAbsolute(artifact.path) ? artifact.path : path.resolve(artifactsDir, artifact.path);
  return { name: artifact.name, contentType: artifact.contentType, bytes: artifact.bytes, filePath };
}
