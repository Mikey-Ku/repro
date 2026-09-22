# Roadmap

Ordered by the value it adds to the working vertical slice. Nothing here is promised.

## Next

1. **Object storage for chunks.** `event_chunks.location` already exists. Add an S3-compatible writer and a reader that streams by `batch_seq`, keep Postgres for metadata.
2. **Run against your own app, properly.** Per-project external targets exist: a project registers an origin, a run is queued against it, and the runner validates the generated code against that origin instead of the demo's. What is still missing is a hosted browser pool so the worker's machine does not have to reach the target itself, per-target fixture secrets stored encrypted so `REPRO_FIXTURE_*` values do not live in shell env, and a way to express the expected before/after state for targets that have no mode switch.
3. **Group-level incident state.** Groups by fingerprint exist as a query (`GET /incidents/groups`). Add a stored group with status, assignee and notes so a fix can be tracked across releases.
4. **Sampling and rate controls in the SDK.** `sampleRate` exists; add error-triggered "record on incident" mode with a ring buffer so healthy sessions cost nothing.

## Later

- Multi-user auth for the dashboard (local accounts first, then OIDC).
- Source map support for stack traces.
- Network body capture as an explicit opt-in with per-route allowlists and size caps.
- Better selectors: use accessible name computation from the recorded DOM snapshot instead of the SDK's lightweight approximation.
- Flaky-run detection: run each generated test N times and report stability.
- Retention that also removes run artifacts from disk.
- CI action that opens a pull request with the generated regression test.

## Not planned for this project

Billing, enterprise SSO, native or mobile recording, Kubernetes manifests, a general observability suite, a custom DOM recorder, or a chat interface as the primary way in.
