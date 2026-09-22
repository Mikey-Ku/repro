# Reproduction runner

The worker (`apps/worker`) executes generated Playwright tests against a target (the bundled
demo application, or an application the project owner registered) and records the result. This
page states exactly what runs, what is refused, and what risk remains. Read it before pointing
the worker at anything other than a local demo.

## Targets

A run has one target, chosen when it is queued (`POST /tests/:testId/runs`, `targetId`) and
copied onto the `reproduction_runs` row, so the worker never looks the target up again.

**The bundled demo** (`targetId: 'demo'`, the default) is the application in `apps/demo`, at the
origin the worker reads from `DEMO_URL`. It is the only target with modes. The run's `targetMode`
is `broken` or `fixed`; the worker reads the demo's current mode, switches it to the requested
one for the duration of the run and restores it afterwards (steps 4 and 7 below). The same
generated test failing on `broken` and passing on `fixed` is the proof that it reproduces the
bug.

**External targets** are origins the project owner adds under Settings, "Reproduction targets",
or through `POST /api/projects/:projectId/targets`. A project can hold up to ten. Each one is
stored as an origin only (scheme, host, port; no path, query, credentials or fragment) and the
run row keeps a copy of its `targetUrl` and `targetName`. For an external target:

- Nothing is switched. There is no mode endpoint to call, the run stores `targetMode: 'none'`,
  and the worker never contacts the demo's `/__demo/mode` for that run. The test runs against
  the application exactly as it is; arranging the before/after states is up to you.
- `REPRO_TARGET_URL` (and so Playwright's `baseURL`) is the target's origin instead of the demo's.
- The origin rule applies to that origin: every absolute `http(s)://` URL in the generated code
  must belong to the target, and `page.goto` still only accepts relative paths. A test generated
  from a session recorded on one origin and run against another will typically be rejected by
  the validator before anything executes, which is intended: the generated code names the
  origin it was recorded against.
- Everything else is unchanged: the same two validators, the same fixed Playwright config,
  timeouts, artifact collection and allowlisted environment.

Two things to know before adding a target. First, the machine running the worker is what opens
the browser, so it must be able to reach the target's origin; a target behind a VPN the worker
is not on will end the run with a Playwright navigation error, not a Repro one. Second, external
targets are for applications you own or are allowed to test. A generated test clicks whatever
the recorded user clicked ("Place order" included) against a live application; Repro does not
know what that does on your side, and it never asks the target for consent. Loopback and
private-network hosts are accepted precisely because the usual target is your own application on
your own machine.

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
4. Demo target only: reads the demo's current mode from `GET ${DEMO_URL}/__demo/mode`, then
   switches it to the run's `targetMode` (`broken` or `fixed`). An unreachable demo ends the run
   with status `error` and the message `Demo application is not reachable at <url>`. External
   targets skip this step entirely.
5. Runs `node <path to @playwright/test/cli> test --config <workspace>/playwright.config.ts`
   with `execFile` (no shell, so nothing in the code can be interpreted by one). The child gets
   an allowlisted environment: `PATH`, `HOME`, `CI=1`, `REPRO_TARGET_URL=<target origin>`,
   `PLAYWRIGHT_BROWSERS_PATH` when the operator set it, and every `REPRO_FIXTURE_*` variable.
   The database URL, internal token and everything else stay in the worker.
6. Kills the whole child process group with SIGKILL after `RUN_TIMEOUT_MS` (default 90 s).
7. Demo target only: restores the demo's previous mode, whatever happened.
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
| Contains an absolute `http(s)://` URL whose origin is not the run's target (`DEMO_URL` for the demo, the stored origin for an external target) | The test may only talk to the application it targets. |
| Calls `page.goto(` with anything but a relative path literal such as `'/checkout'` | Every navigation resolves against the target's `baseURL`. |

The rules were written against `packages/test-generator/src/emit.ts`: everything the generator
emits (header comments with a dashboard URL, the `fixture` helper reading
``process.env[`REPRO_FIXTURE_${...}`]``, `page.waitForResponse`, `requestSubmit()` via
`locator.evaluate`) passes, and `test/validate.test.ts` keeps it that way.

## Why the demo is still the reference target

Executing a test against a real application means executing code on a machine that can reach
that application, with whatever the application does when the test clicks "Place order".
External targets exist so that a generated test can be tried against something real, but the
demo remains what the product is measured against:

- The bundled demo is a small, local Fastify app whose only state is in memory. Running a test
  against it changes nothing that matters.
- Its `broken` and `fixed` modes are the whole point of the runner: the same generated test
  should fail on one and pass on the other, which is the proof that the test reproduces the bug.
  External targets have no such switch, so a run against one is a single observation, not a
  proof.
- Per-target credentials, network policy, a hosted browser pool and consent from whoever owns
  the target are not built. External targets assume the target is yours and reachable from the
  worker's machine; see `docs/LIMITATIONS.md` and item 2 of `docs/ROADMAP.md`.

`reproduction_runs.target` is `demo` or the id of the project target the run was queued
against; `target_url` and `target_name` hold the external target's snapshot. The worker stores an
`error` for a non-demo run whose row carries no valid origin, so a hand-edited row cannot point
Playwright anywhere the API did not validate.

## Limits

- One run at a time per worker; queued runs wait.
- `RUN_TIMEOUT_MS` (default 90 s) for the whole Playwright process, on top of Playwright's own
  30 s per test.
- Test code up to 64 KB, output kept up to 200 KB, `maxBuffer` 8 MB for the child.
- Chromium only, headless, `Desktop Chrome` device profile.
- Up to ten external targets per project, each an origin only.
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
  only navigate to the run's target origin per the rules, but the page it loads is the target's,
  not the worker's, and a compromised target could exploit a browser bug. An external target is
  whatever the project owner registered; the worker trusts that choice.
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

The allowlist means a generated test can only do what the generator can express. That is still code executed by Playwright in a browser on the operator's machine, which is why the only origins a run may talk to are the bundled demo or a target the project owner registered on purpose, and why the browser is the only thing the test can talk to.
