# @repro/worker

Long-running node process that turns finished sessions into incidents and evidence, and runs
generated Playwright tests against the demo application. It polls the `jobs` table; nothing
calls it directly.

## What it does

| Job kind | Payload | Work |
| --- | --- | --- |
| `process_session` | `{ projectId, sessionId }` | Decodes the session's gzip chunks, extracts incidents (`@repro/diagnostics`), stores a deterministic evidence finding, refreshes `errorCount`, `networkFailureCount` and `routes`. Safe to repeat. |
| `run_reproduction` | `{ projectId, runId }` | Validates and executes the generated test for a `reproduction_runs` row, then stores status, logs, exit code and artifacts. See `docs/REPRODUCTION_RUNNER.md`. |

Every 60 seconds it also marks `recording` sessions idle for 30 minutes as `expired` (queueing
`process_session` for each) and requeues jobs whose worker died mid-run (`reapStaleJobs`).

Jobs are handled one at a time. Reproduction runs switch the demo application's global mode, so
running two of them in parallel would make both unreliable.

## Environment

Read from the process environment first, then from the repo root `.env` (a value already set in
the shell is never overridden).

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | Postgres connection string |
| `WORKER_POLL_MS` | `1000` | Sleep between polls when the queue is empty |
| `RUN_TIMEOUT_MS` | `90000` | Hard limit for one Playwright execution |
| `DEMO_URL` | `http://localhost:4100` | The only reproduction target |
| `ARTIFACTS_DIR` | `apps/worker/artifacts` | Where run artifacts are kept (`REPRO_ARTIFACTS_DIR` is accepted as an alias so the ingest API can share it) |
| `WORKSPACE_DIR` | `apps/worker/workspace` | Throwaway Playwright workspaces; keep it under `apps/worker` so the spec can resolve `@playwright/test` |
| `WORKER_PORT` | `4200` | Health server port |
| `WORKER_ID` | `<hostname>-<pid>` | Stored in `jobs.locked_by` |
| `LOG_LEVEL` | `info` | pino level |
| `LOG_PRETTY` | unset | Set to `1` for human-readable logs in development |
| `PLAYWRIGHT_BROWSERS_PATH` | unset | Forwarded to the Playwright child when set |
| `REPRO_FIXTURE_*` | unset | Forwarded to the Playwright child; values for inputs that were redacted at capture |

Relative `ARTIFACTS_DIR` and `WORKSPACE_DIR` values resolve against `apps/worker`.

## Running

```bash
pnpm --filter @repro/worker build      # dist/main.js
pnpm --filter @repro/worker start      # node dist/main.js
pnpm --filter @repro/worker dev        # tsx watch src/main.ts
```

Chromium must be installed for reproduction runs: `pnpm exec playwright install chromium`
from the repo root. The worker needs Postgres and, for runs, the demo app on `DEMO_URL`.

SIGINT or SIGTERM stops polling, lets the current job finish, closes the health server and the
database pool, then exits 0. A second signal exits immediately.

## Health

`GET http://localhost:4200/health`

```json
{ "ok": true, "service": "worker", "version": "0.1.0", "uptimeSeconds": 12, "queueDepth": 0, "running": null }
```

`queueDepth` is the number of queued jobs, `running` the id of the job in progress. Any other
path returns 404. The E2E harness waits on this URL before starting the journey.

## Boundary

The worker executes generated code. `src/runner/validate.ts` rejects anything outside the
generator's dialect (one import, no `require`/`import()`/`eval`/`fetch`/`child_process`, no
`fs`/`net`, no `process` except `REPRO_FIXTURE_*` reads, no URL off the demo origin, relative
`page.goto` only) before a file is written. Playwright then runs in a child process with no shell,
an allowlisted environment, a fixed config it cannot edit, and a process-group SIGKILL on
timeout. The full rules, limits and residual risk are in `docs/REPRODUCTION_RUNNER.md`.

## Layout

```
src/main.ts                 wiring: env, logger, db, health server, worker loop, signals
src/worker.ts               polling loop, dispatch, maintenance timer
src/env.ts                  .env loader and validated settings
src/events.ts               chunk decode, merge and dedupe
src/maintenance.ts          expire idle sessions, reap stale jobs
src/health.ts               node:http health endpoint
src/jobs/process-session.ts incidents, evidence finding, counters
src/jobs/run-reproduction.ts run row lifecycle around the runner
src/runner/validate.ts      static rules for generated code
src/runner/workspace.ts     fixed Playwright config and spec on disk
src/runner/demo-mode.ts     read and switch the demo's mode
src/runner/execute.ts       execFile of the Playwright CLI, allowlisted env, group kill
src/runner/report.ts        Playwright JSON report parsing
src/runner/artifacts.ts     screenshot, trace and report copy
src/runner/run.ts           the steps in order
```

## Tests

```bash
pnpm --filter @repro/worker test                    # unit + Postgres tests
RUN_RUNNER_SMOKE=1 pnpm --filter @repro/worker test # also runs real Playwright against the demo
```

The Postgres tests use `DATABASE_URL` from the root `.env`, create a throwaway project and delete
it afterwards. The smoke test needs the demo app running on `DEMO_URL` and Chromium installed.
