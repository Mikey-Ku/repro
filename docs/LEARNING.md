# How Repro works, in plain English

This document follows one shopper's failed checkout from the first keystroke to a passing regression test. Each step names the code that does the work so you can read along.

## 1. A script starts recording

The demo store's HTML includes `/vendor/repro.iife.js` and calls `Repro.init({ projectKey, endpoint, release })`. That single call, in `packages/browser-sdk/src/client.ts`, does five things:

1. Creates or resumes a session id (stored in `sessionStorage`, so a full page navigation stays in the same session).
2. Starts rrweb. rrweb takes a snapshot of the DOM and then records every mutation, scroll and mouse move as small JSON events. That is what the replay is built from.
3. Attaches listeners for clicks, `change` (a field's final value), `submit`, navigation, uncaught errors and unhandled promise rejections.
4. Wraps `fetch`, `XMLHttpRequest`, `console.error` and `console.warn` so it can note what happened without changing behaviour.
5. Starts a timer that uploads whatever has accumulated every two seconds.

Every event gets a `seq` number and a timestamp. `seq` is the backbone of the system: it lets the server deduplicate retries and lets the dashboard order everything from different sources into one timeline.

## 2. Secrets are masked before they exist as events

The password field is `type=password`, so both rrweb and the SDK's own input capture mask it. The card number field has `autocomplete="cc-number"` and a label "Card number", and `isSensitiveField` in `packages/contracts/src/sanitize.ts` recognises either hint. The hidden `apiKey` input is masked because every hidden input is. The account number on screen has `data-repro-mask`, so rrweb replaces its text with asterisks. The support widget has `data-repro-block`, so rrweb records a grey box of the same size instead of its content.

The login response sets a cookie and returns a token that the page stores and sends as an `Authorization` header. None of that is captured because the SDK never reads cookies, headers or bodies; it records method, URL, status and duration only. The `?token=` in the checkout URL is removed by `sanitizeUrl`. Error messages pass through `scrubText`, which removes anything that looks like a bearer token, key, JWT or card number.

The test that proves this is not a dashboard screenshot. `packages/browser-sdk/test` seeds every canary and inspects the serialised bytes that would go on the wire. The E2E suite repeats the check against the real demo, both on the wire and in the database.

## 3. Uploads are small, ordered and retried

`packages/browser-sdk/src/transport.ts` serialises a batch, compresses it with the browser's built-in `CompressionStream`, and posts it with `keepalive` so the request survives a page navigation. Each batch carries `batchSeq`. If the network fails, the batch is retried with exponential backoff up to five times and then dropped, and the queue is capped so a broken network cannot grow memory without bound. When the page is being hidden the SDK uses `sendBeacon`, which browsers allow during unload.

## 4. The server validates, sanitises again and stores

`apps/ingest/src/routes/ingest.ts` looks up the project by hashing the key from the `x-repro-key` header (keys are stored hashed, like passwords). It decompresses the body, checks the size cap, and validates the whole batch against the Zod schema in `packages/contracts/src/events.ts`. Anything unexpected is a 400 with the list of issues.

The events are then written as one row in `event_chunks`, compressed again, inside a transaction that also updates the session's counters. The unique index on `(session_id, batch_seq)` means a retried upload is recognised and ignored. When the SDK sends `final: true`, the session is marked completed and a `process_session` job is queued.

## 5. The worker turns events into incidents and evidence

`apps/worker` polls the `jobs` table with `SELECT ... FOR UPDATE SKIP LOCKED`, which lets several workers share a queue without a message broker. For `process_session` it decodes the chunks, runs `extractIncidents` (one incident per distinct error fingerprint) and `summarizeEvidence` from `packages/diagnostics`, and stores both.

The evidence summary is deterministic: earliest error, the requests that completed in the five seconds before it, the last eight user actions, console errors, and a list of gaps such as "no stack trace was recorded". Every item points at a `seq`, which is why the dashboard can offer a "jump to this moment" button next to each one.

## 6. The dashboard replays and explains

`apps/web` is a Next.js app whose server components call the ingest API with a token the browser never sees. The replay uses `rrweb-player`, which rebuilds the recorded DOM inside an iframe with a `sandbox` attribute and no script execution; the original page's scripts never run in the dashboard. The timeline, evidence, test and runs panels all derive from the same event list.

Anything recorded from a user's page is treated as hostile text. React escapes it, and the E2E security test posts HTML-shaped payloads and checks that nothing executes.

## 7. A test is generated, deterministically

`packages/contracts/src/normalize.ts` first turns raw events into actions: consecutive edits collapse to the final value, a click on a field that is then filled is dropped, and a click on the submit button absorbs the form's submit event. `packages/test-generator` then picks a selector for each action in a fixed order (test id, then role and name, then label, then placeholder, then stable attributes, then a CSS path as a documented fallback) and emits Playwright code, formatted with Prettier. Masked values become `fixture('cardNumber')`, which reads an environment variable so the secret never appears in the test.

The output includes a hash of the normalised input. The same recording always produces the same file, which is what makes the generator testable with fixtures.

## 8. The test fails, then passes

The worker writes the generated file into a throwaway Playwright project, validates it against an allowlist (one import, no `require`, no absolute URLs outside the demo), switches the demo into the requested mode over HTTP, and runs Playwright with `execFile` and a timeout. In broken mode the checkout throws, `page.on('pageerror')` catches it, and the confirmation assertion times out. In fixed mode the same steps complete. The JSON report, trace and screenshot are saved and shown in the dashboard.

## What to say in an interview

- Why redaction lives in the SDK: the server cannot un-know a secret. Once bytes leave the browser, the trust boundary has been crossed.
- Why `seq` and `batchSeq` are separate: `seq` orders events, `batchSeq` makes uploads idempotent.
- Why generation is deterministic and AI is optional: the regression test must be reviewable and stable; a model can add hypotheses but cannot be the thing that decides which selector to use.
- Why the runner is restricted: generated code is still code, so it runs against a bundled target under an allowlist and a timeout rather than against arbitrary sites.
