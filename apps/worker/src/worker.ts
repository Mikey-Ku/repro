import { count, eq } from 'drizzle-orm';
import { JobKind } from '@repro/contracts';
import { claimJob, completeJob, failJob, jobs, type Db, type JobRow } from '@repro/db';
import { ProcessSessionPayload, processSession } from './jobs/process-session.js';
import { RunReproductionPayload, runReproduction } from './jobs/run-reproduction.js';
import type { Logger } from './logger.js';
import { MAINTENANCE_INTERVAL_MS, runMaintenance } from './maintenance.js';
import type { RunnerOptions } from './runner/run.js';

export interface WorkerOptions {
  db: Db;
  log: Logger;
  workerId: string;
  pollMs: number;
  runner: Omit<RunnerOptions, 'log'>;
  /** Overridable for tests; production uses the 60 s default. */
  maintenanceIntervalMs?: number;
}

/** Sleep that wakes early when `signal` aborts, so shutdown never waits out a full poll. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * The polling loop. One job at a time: reproduction runs flip the demo application's global
 * mode, so two of them in parallel would race each other. `start()` resolves once the loop has
 * exited after `stop()`, which lets main.ts wait for the in-flight job before closing the database.
 */
export class Worker {
  private readonly abort = new AbortController();
  private currentJobId: string | null = null;
  private loop: Promise<void> | undefined;
  private maintenanceTimer: NodeJS.Timeout | undefined;
  private maintenanceInFlight: Promise<void> = Promise.resolve();

  constructor(private readonly options: WorkerOptions) {}

  /** Id of the job being handled, for the health endpoint. */
  running(): string | null {
    return this.currentJobId;
  }

  async queueDepth(): Promise<number> {
    const [row] = await this.options.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'queued'));
    return row?.value ?? 0;
  }

  start(): void {
    if (this.loop) throw new Error('worker already started');
    this.scheduleMaintenance();
    this.loop = this.run();
  }

  /** Stop claiming jobs, let the current one finish, then resolve. */
  async stop(): Promise<void> {
    this.abort.abort();
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    await this.maintenanceInFlight;
    await this.loop;
  }

  /** Run the housekeeping pass now. Public so tests and main can trigger it directly. */
  async maintain(): Promise<void> {
    const { db, log } = this.options;
    try {
      const result = await runMaintenance(db);
      if (result.expiredSessions.length || result.reapedJobs) log.info(result, 'maintenance');
    } catch (error) {
      log.error({ err: error }, 'maintenance failed');
    }
  }

  private scheduleMaintenance(): void {
    const interval = this.options.maintenanceIntervalMs ?? MAINTENANCE_INTERVAL_MS;
    this.maintenanceInFlight = this.maintain();
    this.maintenanceTimer = setInterval(() => {
      this.maintenanceInFlight = this.maintain();
    }, interval);
    this.maintenanceTimer.unref();
  }

  private async run(): Promise<void> {
    const { db, log, workerId, pollMs } = this.options;
    const signal = this.abort.signal;
    while (!signal.aborted) {
      let job: JobRow | null = null;
      try {
        job = await claimJob(db, workerId, JobKind.options);
      } catch (error) {
        log.error({ err: error }, 'could not poll the job queue');
      }
      if (!job) {
        await sleep(pollMs, signal);
        continue;
      }
      await this.handle(job);
    }
  }

  private async handle(job: JobRow): Promise<void> {
    const { db, log } = this.options;
    const jobLog = log.child({ jobId: job.id, kind: job.kind, attempt: job.attempts });
    this.currentJobId = job.id;
    const startedAt = Date.now();
    try {
      const result = await this.dispatch(job, jobLog);
      await completeJob(db, job.id);
      jobLog.info({ durationMs: Date.now() - startedAt, result }, 'job done');
    } catch (error) {
      jobLog.error({ err: error, durationMs: Date.now() - startedAt }, 'job failed');
      await failJob(db, job, error).catch((failError: unknown) => {
        jobLog.error({ err: failError }, 'could not record the job failure');
      });
    } finally {
      this.currentJobId = null;
    }
  }

  private dispatch(job: JobRow, jobLog: Logger): Promise<unknown> {
    const { db } = this.options;
    switch (job.kind) {
      case 'process_session':
        return processSession(db, ProcessSessionPayload.parse(job.payload));
      case 'run_reproduction':
        return runReproduction(db, RunReproductionPayload.parse(job.payload), { ...this.options.runner, log: jobLog });
      default:
        throw new Error(`Unknown job kind "${job.kind}"`);
    }
  }
}
