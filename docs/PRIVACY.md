# Privacy and threat model

Repro records what a user did in a browser. That is sensitive by construction, so the design starts from what must never leave the page rather than from what would be useful to capture.

## What Repro protects against

Redaction runs inside the browser SDK, before serialisation. The server re-applies the URL and message rules as defence in depth, but the primary control is that the sensitive value is never placed in the event buffer.

| Threat | Control | Where enforced | Verified by |
| --- | --- | --- | --- |
| Password values in the recording | rrweb `maskInputOptions.password`, and the SDK's own input events mask any `type=password` control | SDK | `packages/browser-sdk/test`, E2E step 2 |
| Payment data (card number, expiry, CVC) | Field sensitivity heuristics on name, id, label, placeholder and `autocomplete` (`cc-*`) | SDK, `isSensitiveField` in contracts | contracts unit tests, SDK payload tests, E2E |
| Secrets, tokens, auth, cookies, API keys typed into forms | Same heuristics (`secret`, `token`, `auth`, `cookie`, `session`, `api key`, `ssn`, `pin`, and so on) | SDK | contracts unit tests, SDK payload tests |
| Hidden inputs | Always masked | SDK | SDK payload tests, E2E (`apiKey` hidden field) |
| Secrets displayed as page text | `data-repro-mask` (text masked), `data-repro-block` (subtree replaced by a placeholder), plus rrweb's `rr-mask` and `rr-block` classes; `strict` mode masks all free-text inputs | SDK, application markup | SDK payload tests, E2E (`maskedText`, `blockedText` canaries) |
| Tokens in URLs | `sanitizeUrl` removes sensitive query-string and fragment parameters, and basic-auth credentials, on navigation, network and metadata URLs | SDK and server | contracts tests, E2E (`?token=` canary) |
| Authorization headers and cookies | The SDK never reads request or response headers; it records method, URL, status and duration only. `document.cookie` is never read. | SDK | SDK payload tests, E2E (`bearerHeader`, `cookie` canaries) |
| Request and response bodies | Never captured | SDK | E2E (`responseSecret` canary) |
| Secrets inside error messages or console output | `scrubText` removes bearer tokens, key-shaped strings, JWTs, card-number-shaped digit runs and `key=value` secrets from free text | SDK and server | contracts tests |
| Personal identifiers via `identify()` | Email-shaped ids are refused; trait keys that look sensitive are dropped | SDK | SDK tests |
| Recorded secrets reaching a model | `redactForModel` strips event payloads and scrubs every string before an investigator sees it; the AI investigator is off unless configured | diagnostics | diagnostics tests |
| Stored XSS from recorded content | React escapes all recorded text; the only `dangerouslySetInnerHTML` is shiki output of generator-produced code, which is escaped by shiki; rrweb replay runs in a sandboxed iframe without `allow-scripts` and rrweb-snapshot neutralises `<script>` | dashboard | web component tests, E2E security spec |
| Scripts from the recorded page running in the dashboard | rrweb rebuilds the DOM from a serialised snapshot; script elements are not executed; the iframe sandbox blocks scripts | dashboard | E2E security spec |
| Cross-project data access | Every internal route is project-scoped; children are looked up by `(projectId, id)`; foreign resources return 404 | ingest | ingest integration tests |
| Stolen ingestion key | Keys are stored as SHA-256 hashes with a display prefix; revocation is immediate; keys can only write, never read | ingest, db | ingest integration tests |
| Oversize or malformed uploads | 2 MB decompressed cap, 2000 events per batch, Zod validation of every field, `gzip` or identity only | ingest | ingest tests, E2E security spec |
| Upload floods | In-memory per-key rate limit (600 requests per minute). This is a local substitute; a shared limiter belongs in front of a multi-instance deployment. | ingest | documented |
| Arbitrary code execution from generated tests | The runner validates the file against an allowlist (single Playwright import, no `require`, `import()`, `process` other than `REPRO_FIXTURE_*`, no absolute URLs outside the demo origin), runs it with `execFile` and a fixed argument list, no shell, under a timeout, only against the bundled demo app | worker | worker unit tests |
| Model-generated shell commands | There is no code path from an investigator's output to a process. Investigations are displayed, never executed. | diagnostics, worker | code review |
| Secrets in committed fixtures | `pnpm secrets:scan` fails on credential-shaped strings and on any demo canary outside the allowlisted test and demo files | repo | verify script |

## What Repro does not protect against

Be honest with users of the SDK about these.

1. **Secrets rendered as ordinary page text without a mask attribute.** rrweb records the DOM. If an application prints an API key in a `<td>` with no `data-repro-mask`, it is recorded. Use `data-repro-mask`, `data-repro-block`, or `strict` mode plus a `maskSelector`.
2. **Sensitive values in URL paths.** Only query-string and fragment parameters are sanitised. `/reset/abcdef123` keeps its path. Use `annotate` to mark such routes and consider masking on the server side.
3. **Values in non-standard fields.** The heuristics are broad but cannot know that a field named `note` contains a passport number. Mark such fields with `data-repro-mask`.
4. **Text typed and deleted before `change` fires.** Input events are recorded on `change`, but rrweb also records input mutations continuously, subject to its own masking. A value typed into an unmasked field is in the rrweb stream.
5. **Screenshots and traces from reproduction runs.** These are produced from the demo application during replay, not from the original user session, but they are stored unencrypted on disk under `apps/worker/artifacts`.
6. **Anyone with database access.** Chunks are compressed, not encrypted. Treat the Postgres volume as sensitive.
7. **A malicious application embedding the SDK.** The SDK trusts the page it runs in. It cannot stop the page from sending secrets through `annotate` with harmless-looking keys, although sensitive-looking trait keys are dropped.
8. **Local dashboard authentication.** This release has one local development user and a shared internal token. It is not a multi-user product yet.

## Data handling summary

- Ingestion keys: hashed at rest, plaintext shown once.
- Sessions and chunks: kept for `retention_days` per project (default 30), then deleted by the retention job with cascading deletes. Individual sessions can be deleted from the API.
- Logs: request logs carry ids, methods, paths, status codes and key prefixes. Never keys, never event contents.
- AI: off by default. When enabled, the model receives the redacted evidence summary and the redacted timeline, never rrweb events or raw stacks.

## Reporting

This is an open-source first release. Report privacy or security findings by opening an issue with the `security` label, or privately to the maintainer listed in `package.json`.
