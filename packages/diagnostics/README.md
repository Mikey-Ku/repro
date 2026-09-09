# @repro/diagnostics

Deterministic evidence summaries, incident extraction and an optional AI investigator for recorded Repro sessions.

The package has one design rule: **facts and guesses never mix**. Everything in an `EvidenceSummary` is computed from captured events by plain code and carries a pointer back to the event it came from. Anything that goes beyond the events (a hypothesis, a reasoning step) lives in an `Investigation`, is labelled as inference, and is produced by an investigator that is offline by default.

## Public interface

```ts
import {
  summarizeEvidence, extractIncidents,
  createFakeInvestigator, createAiInvestigator, createInvestigatorFromEnv, redactForModel,
} from '@repro/diagnostics';

const ctx = { startedAt: session.startedAt.getTime(), release, browser, status };
const summary = summarizeEvidence(events, ctx);      // EvidenceSummary (contracts)
const incidents = extractIncidents(events, ctx);     // IncidentCandidate[]
const investigator = createInvestigatorFromEnv();    // fake unless AI env vars are set
const finding = await investigator.investigate({ summary, timeline: buildTimeline(events, ctx.startedAt) });
```

`SessionContext` is `{ startedAt, release?, browser?, status? }`. `status` is optional and only used for one gap statement (see below).

## The evidence model

`summarizeEvidence(events, ctx)` returns the `EvidenceSummary` shape defined in `@repro/contracts`. Every entry that points at an event carries an `EvidenceRef` `{ seq, ts, offsetMs, label }`; the dashboard uses it to seek the replay. Labels reuse the titles of `buildTimeline` so the evidence panel and the timeline read the same.

| Field | Derived from |
| --- | --- |
| `route` | Route template of the first navigation (`routeFromPath(sanitizePath(url))`). |
| `release`, `browser` | Passed in through `ctx`; the events do not carry them. |
| `earliestError` | First error event with `handled: false`, else the first error of any kind. Includes name, message, stack and kind. |
| `failedRequests` | Network events with `ok: false` or status >= 400, up to 20. |
| `slowRequests` | Network events slower than 2000 ms that did not fail, up to 20. |
| `lastActions` | The last 8 normalised actions (`normalizeEvents`) before the earliest error, or before the end when there is none, described in plain language: `Clicked button "Place order"`, `Filled textbox "Card number" ([masked])`, `Navigated to /checkout`. |
| `consoleErrors` | Console events, `error` level first, up to 20. |
| `requestsBeforeError` | Network events whose timestamp falls in the 5 s before the earliest error, in seq order, with `ok` and `status`. |
| `gaps` | Plain-language statements about what the recording could not establish. |
| `stats` | Counts of events, errors, requests and actions, and `durationMs` (last event minus `startedAt`). |

The function is pure: the same events and context always give the same summary, independent of the order the events arrive in. Tests assert this by comparing two runs and a reversed input.

### Gap statements

Gaps are the summary saying "here is what I do not know". They are ordinary strings so the UI can show them as-is:

- `No events were recorded for this session.`
- `No navigation was recorded, so the route is unknown.`
- `No uncaught error was recorded; the failure may be visual only.`
- `No network request completed within 5 s before the error.`
- `No user actions were recorded before the error.`
- `The recorded stack trace is missing, so the failing source location is unknown.`
- `The session was still recording when captured; later events may be missing.` (when `ctx.status === 'recording'`)

## Incidents

`extractIncidents(events, ctx)` produces one candidate per distinct fingerprint, in seq order. The worker upserts them into the `incidents` table (unique on session + fingerprint).

- **Uncaught errors** (`handled: false`): fingerprint = SHA-1 of kind, error name, the first line of the message with digit runs and quoted strings normalised, and the file path of the top stack frame without line or column. Title is `Name: first line` truncated to 120 characters.
- **Unhandled rejections**: same rule with kind `unhandledrejection`.
- **Network**: status >= 500, or no status with a network-level error. Fingerprint = method, route template (`routeFromPath`) and status. Title `GET /api/orders/:id failed (500)`.
- **Console**: `console.error` entries create a `console` incident only when the session has no uncaught error, because the browser also logs uncaught errors to the console and they would duplicate each other.

`route` on a candidate is the route template active at that point of the session (the last navigation before the event).

## Investigators

An `Investigator` is `{ provider, model, investigate(input) }` where the input is the evidence summary plus the timeline. It returns an `Investigation` from `@repro/contracts`: hypothesis, confidence, `evidence` (claims with refs), `inferences` (reasoning), `suggestedChecks`, and `abstained` with a reason.

### Fake (default)

`createFakeInvestigator()` is deterministic and offline (`provider: 'fake'`, `model: 'rules-v1'`). It applies three readable rules:

1. A successful request within 5 s before a `TypeError` mentioning `undefined` or `null`: the response succeeded but the page read a property that is not in the response shape (confidence `medium`).
2. A failed request within 5 s before the error: the page did not handle the failed response (confidence `medium`).
3. No request nearby: the last user action triggered the error directly (confidence `low`).

When there is no error at all it abstains. Every evidence entry it returns points at a ref from the summary.

### AI (optional, off by default)

`createAiInvestigator({ model, apiKey? })` uses the `ai` package (v6) with `generateText` and `Output.object`, validated against `InvestigationSchema`. The model is a plain gateway string such as `anthropic/claude-sonnet-4.5`; the AI SDK routes it through Vercel AI Gateway with `AI_GATEWAY_API_KEY`.

`createInvestigatorFromEnv(env)` returns the AI investigator only when **both** `AI_GATEWAY_API_KEY` and `REPRO_AI_MODEL` are set, otherwise the fake. Nothing leaves the machine unless an operator sets both.

#### What is sent

`redactForModel(input)` is the exact transformation applied before a prompt is built, and it is exported so it can be tested and inspected:

- the evidence summary, and
- the timeline rows reduced to `seq`, `ts`, `offsetMs`, `kind`, `severity`, `title` and `detail` (details truncated to 300 characters), capped at 200 rows around the error,
- with every string passed through `scrubText` from `@repro/contracts`, which redacts token- and secret-looking substrings (bearer headers, API keys, JWTs, card-number-like digit runs, `password=...` pairs).

#### What is never sent

- rrweb DOM snapshots and mutations (they are not part of the timeline at all),
- raw event payloads (the `event` field of timeline entries is removed),
- input values, cookies, headers, request or response bodies (the SDK never captures them in the first place),
- anything from the database other than what is in the summary and timeline.

The prompt instructs the model to separate evidence from inference, to only cite refs that exist in the summary, to state confidence, and to abstain when the evidence is insufficient. After the call, evidence entries whose ref is not in the summary are dropped and a warning is appended to `inferences`. If the model returns something that does not validate, the investigator returns an abstained `Investigation` with the validation problem as `abstainReason` instead of throwing. Transport errors (gateway unreachable, bad key) are thrown so the caller can surface them.

Tests never call the network: `createAiInvestigator` accepts an injected `generate` function.

## Scripts

`pnpm --filter @repro/diagnostics build | typecheck | lint | test`
