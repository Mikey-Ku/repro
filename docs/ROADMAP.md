# Roadmap

Ordered by the value it adds to the working vertical slice. Nothing here is promised.

## Next

1. **Object storage for chunks.** `event_chunks.location` already exists. Add an S3-compatible writer and a reader that streams by `batch_seq`, keep Postgres for metadata.
2. **Run against your own app.** The runner is limited to the demo target. Add per-project allowed origins, a hosted browser pool, and fixture secrets stored encrypted so `REPRO_FIXTURE_*` values do not live in shell env.
3. **Incident grouping across sessions.** Fingerprints exist per session. Add a project-level incident table with counts, first seen, last seen and affected releases.
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
