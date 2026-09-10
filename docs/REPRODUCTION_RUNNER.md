# Reproduction runner

The worker (`apps/worker`) executes generated Playwright tests against the bundled demo
application and records the result. This page states exactly what runs, what is refused, and
what risk remains. Read it before pointing the worker at anything other than a local demo.

## What is executed

A `run_reproduction` job names a row in `reproduction_runs`, which points at a row in
`generated_tests`. The worker:

1. Marks the run `running` and records `startedAt`.
2. Validates the test code statically (rules below). A rejection is stored as status `error`
   with the reason in `failureMessage`; nothing is written to disk or executed.
3. Creates a throwaway workspace at `apps/worker/workspace/<runId>/` with two files: the
   generated `repro.spec.ts` and a fixed `playwright.config.ts` that the generated code cannot
   change (Chromium only, one worker, no retries, 30 s test timeout, 5 s expect timeout, trace
   always on, screenshot on failure, JSON reporter to `report.json`).
4. Reads the demo's current mode from `GET ${DEMO_URL}/__demo/mode`, then switches it to the
   run's `targetMode` (`broken` or `fixed`). An unreachable demo ends the run with status
   `error` and the message `Demo application is not reachable at <url>`.
5. Runs `node <path to @playwright/test/cli> test --config <workspace>/playwright.config.ts`
   with `execFile` (no shell, so nothing in the code can be interpreted by one). The child gets
   an allowlisted environment: `PATH`, `HOME`, `CI=1`, `REPRO_TARGET_URL=<DEMO_URL>`,
   `PLAYWRIGHT_BROWSERS_PATH` when the operator set it, and every `REPRO_FIXTURE_*` variable.
   The database URL, internal token and everything else stay in the worker.
6. Kills the whole child process group with SIGKILL after `RUN_TIMEOUT_MS` (default 90 s).
7. Restores the demo's previous mode, whatever happened.
8. Parses `report.json`: a test with status `expected` passes, anything else fails, and the first
   error message (ANSI colours removed) becomes `failureMessage`. A kill by timeout gives status
   `timeout`; a non-zero exit with no report gives status `error`.
9. Copies the first screenshot, the first `trace.zip` and `report.json` into
   `${ARTIFACTS_DIR}/<runId>/` and stores `[{ name, contentType, bytes, path }]` on the run
   together with the combined stdout and stderr (last 200 KB), `exitCode`, `finishedAt` and
   `durationMs`.
10. Deletes the workspace. Artifacts are kept until the session is deleted.

Runs are serialised: the worker handles one job at a time because the demo's mode is process
state and two runs switching it would race.

## Validation rules

`apps/worker/src/runner/validate.ts` is pure and unit-tested. Comments are ignored (the generator
quotes recorded error messages in comments, and those must not cause false rejections) while
string contents are still inspected for URLs. Code is rejected when any of these hold:

| Rule | Why |
| --- | --- |
| Larger than 64 KB | A generated test is a few KB; anything bigger is not one. |
| Not exactly one `import`, or the import is not `import { test, expect } from '@playwright/test';` | Only the test runner API is available. Single or double quotes are accepted because prettier may rewrite them. |
| Contains `require(`, dynamic `import(`, `child_process`, `eval(`, `Function(` or `fetch(` | Each one is a way to reach beyond the browser page or to run code that was not reviewed. |
| References the `fs` or `net` modules (`'fs'`, `'node:fs'`, `'fs/promises'`, `'net'`, `'node:net'`) | No file or socket access from a test. |
| Uses `process` for anything but `process.env.REPRO_FIXTURE_*` (dot or bracket form) | The fixture helper is the only legitimate reason to touch the process. |
| Contains an absolute `http(s)://` URL whose origin is not `DEMO_URL` | The test may only talk to the demo application. |
| Calls `page.goto(` with anything but a relative path literal such as `'/checkout'` | Every navigation resolves against the demo's `baseURL`. |

The rules were written against `packages/test-generator/src/emit.ts`: everything the generator
emits (header comments with a dashboard URL, the `fixture` helper reading
``process.env[`REPRO_FIXTURE_${...}`]``, `page.waitForResponse`, `requestSubmit()` via
`locator.evaluate`) passes, and `test/validate.test.ts` keeps it that way.

## Why only the demo target in this release

Executing a test against a real application means executing code on a machine that can reach
that application, with whatever the application does when the test clicks "Place order". This
release keeps the runner honest about that:

- The bundled demo is a small, local Fastify app whose only state is in memory. Running a test
  against it changes nothing that matters.
- Its `broken` and `fixed` modes are the whole point of the runner: the same generated test
  should fail on one and pass on the other, which is the proof that the test reproduces the bug.
- A configurable target would need per-project credentials, network policy, a sandbox for the
  browser, and consent from whoever owns the target. None of that is a weekend of work, so it
  is on the roadmap rather than half-built here.

`reproduction_runs.target` exists in the schema so that other targets can be added without a
migration; the worker stores an `error` for any value other than `demo`.

## Limits

- One run at a time per worker; queued runs wait.
- `RUN_TIMEOUT_MS` (default 90 s) for the whole Playwright process, on top of Playwright's own
  30 s per test.
- Test code up to 64 KB, output kept up to 200 KB, `maxBuffer` 8 MB for the child.
- Chromium only, headless, `Desktop Chrome` device profile.
- Artifacts: the first screenshot, the first trace and the JSON report. Video is off.
- The workspace must live under `apps/worker` (the default) so that node resolves
  `@playwright/test` for the spec from `apps/worker/node_modules`. Pointing `WORKSPACE_DIR`
  elsewhere requires `@playwright/test` to be resolvable from that location.

## Residual risk

Generated code is still code. After validation it is TypeScript that Playwright compiles and runs
in a node process on the operator's machine, driving a real Chromium. The validator is a
denylist over a known dialect, not a sandbox:

- A determined author who can write rows into `generated_tests` could look for a construct the
  rules do not name. The denylist blocks the obvious escape hatches (module loading, child
  processes, `eval`, network calls from node, file and socket modules) and the allowlisted
  environment limits what such code could read, but it cannot prove absence of every trick.
  Treat write access to the database as equivalent to code execution on the worker host.
- The browser itself runs unsandboxed relative to the host beyond what Chromium provides. It can
  only navigate to the demo origin per the rules, but the page it loads is the demo's, not the
  worker's, and a compromised demo could exploit a browser bug.
- On timeout the worker kills the CLI's process group. Playwright launches browsers detached, so
  a browser can outlive the kill for a moment until its pipe to the dead worker closes.
- Fixture values passed through `REPRO_FIXTURE_*` are visible to the test code by design. Only
  provide fixtures for the demo, never real secrets.

Run the worker as an unprivileged user on a machine that holds nothing you would not want a
generated test to read.


## Two validators: a denylist and a syntax-tree allowlist

Validation runs in two passes, both in `apps/worker/src/runner/`.

1. `validate.ts` is a denylist over the source text: size cap, exactly one import (`@playwright/test`), no `require`, dynamic `import`, `eval`, `Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `page.request`, `route()`, page instrumentation APIs, `window[...]`, `globalThis`, `.constructor`, `import.meta`, no `process` other than `process.env.REPRO_FIXTURE_*`, no absolute URLs outside the demo origin, and `page.goto` only with a relative path literal. Its messages are specific, which is why it runs first.
2. `ast.ts` parses the file with the TypeScript compiler and walks the tree with an allowlist: only the node kinds, global identifiers (`test`, `expect`, `String`, `URL`, `RegExp`, `process`, `HTMLFormElement`), member names (`goto`, `getByRole`, `fill`, `click`, `waitForResponse`, `toBeVisible`, and the rest of what the generator emits) and operators (`&&`, `===`, `??`) that `@repro/test-generator` produces are accepted. Anything else, including loops, `throw`, string concatenation, computed member access, unknown identifiers and unknown members, is rejected by shape. `apps/worker/test/ast.test.ts` proves that every committed generator fixture and every recorded benchmark fixture passes, and that thirteen obfuscated escapes (`window['fet' + 'ch']`, `({}).constructor.constructor`, `page.request.get`, `page.route`, `process.exit`, dynamic members) fail.

The allowlist means a generated test can only do what the generator can express. That is still code executed by Playwright in a browser on the operator's machine, which is why the runner stays limited to the bundled demo application in this release and why the browser is the only thing the test can talk to.
