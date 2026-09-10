# Repro

Privacy-first browser session replay and automated bug reproduction. Install a small SDK, capture a failed user session with secrets masked in the browser, replay it with its error and network timeline, and generate a Playwright test that fails on the bug and passes on the fix.

**Status:** first release. The complete loop below runs end to end on a laptop and is verified by an automated test. It is not production software; see `docs/LIMITATIONS.md`.

## The loop, verified

`pnpm test:e2e` drives this sequence against real services, every time:

1. A shopper signs in and places an order on the bundled demo store, which is broken on purpose. The checkout hangs.
2. The SDK records the session. Every outbound batch is intercepted and checked: none of the planted secrets (password, card number, CVC, expiry, bearer token, cookie, query-string token, hidden API key, masked account number, blocked widget text, response-body secret) appears on the wire.
3. The server ingests the session. The database is read back raw and checked again: no secrets persisted.
4. The dashboard lists the session, replays it in a sandboxed iframe, and shows the `TypeError` right after the successful `POST /api/orders`.
5. A Playwright test is generated from the recording. It uses test ids, roles and labels; masked values become fixture placeholders.
6. The generated test runs against the demo in broken mode and fails for the intended reason.
7. The same test runs against fixed mode and passes.

<!-- results:start -->
Measured with `pnpm bench` on an Apple M5 laptop (16 GB, Node 25). Full methodology and caveats in `docs/BENCHMARKS.md`.

| What | Measured |
| --- | --- |
| SDK script (minified) | 204 kB raw, 66 kB gzip, 45 kB brotli |
| Main-thread cost of recording the demo workflow | 51 ms with the SDK, 31 ms without, so about 20 ms added; no long tasks |
| Recording payload for the demo session (2.8 s) | 2 batches, 6.6 kB on the wire, 35 kB decompressed, 66 events |
| Redaction across the canary corpus | 12 of 12 secrets absent from every outbound batch |
| Ingestion, 16 concurrent clients for 10 s | 625 batches/s (41,000 events/s), p50 24 ms, p95 33 ms, p99 46 ms, no errors |
| Dashboard session page | p50 25 ms to DOM complete, p50 837 ms until the replay is rendered |
| Generated tests across 3 recorded fixtures | 3 of 3 pass in fixed mode, 3 of 3 fail in broken mode |
<!-- results:end -->

## Quick start

```bash
pnpm install && pnpm exec playwright install chromium
docker compose up -d db && pnpm db:migrate && pnpm db:seed
pnpm build && pnpm dev
```

Demo store: http://localhost:4100. Dashboard: http://localhost:3000. Full walkthrough in `docs/QUICKSTART.md`; a ninety-second talk track in `docs/DEMO_SCRIPT.md`.

## How it fits together

```
browser ──SDK (rrweb + capture + redaction)──▶ ingest API ──▶ Postgres ◀── worker (incidents, evidence, runner)
                                                  ▲                            │
                                        dashboard (Next.js) ◀──────────────────┘ runs generated tests against the demo
```

`docs/ARCHITECTURE.md` has the full diagram and the reasons behind each boundary. `docs/LEARNING.md` walks one session through the whole system in plain English.

## Privacy model

Redaction happens inside the SDK before serialisation, and the server re-applies the URL and message rules as defence in depth. Passwords, payment fields, hidden inputs and any field whose name, label, placeholder or autocomplete hints at a secret are masked. Query-string tokens are stripped. Headers, cookies and bodies are never read. Applications mark anything else with `data-repro-mask`, `data-repro-block` or `data-repro-ignore`, or enable strict mode. The tests that prove this inspect the serialised payload, not the rendered UI. What Repro does not protect against is listed just as plainly in `docs/PRIVACY.md`.

## Deterministic generation, optional AI

Recorded events are normalised into actions, then translated into Playwright code with a fixed selector priority: `data-testid`, accessible role and name, label, placeholder, stable attributes, CSS path as a documented fallback. Same input, same output, same hash; the generator is covered by fixtures. An AI investigator exists behind a provider-neutral interface with a deterministic fake for tests. It is off unless configured, it only sees a redacted evidence summary, and its output separates evidence from inference and may abstain.

## Repository

| Path | What |
| --- | --- |
| `apps/web` | dashboard |
| `apps/ingest` | ingestion and internal API |
| `apps/worker` | processing and the restricted reproduction runner |
| `apps/demo` | the intentionally broken store |
| `packages/browser-sdk` | the SDK |
| `packages/contracts` | schemas and normalisation |
| `packages/test-generator` | Playwright generation |
| `packages/diagnostics` | evidence and investigators |
| `packages/db` | Drizzle schema, migrations, jobs |
| `tests/e2e` | the product journey |
| `scripts/bench` | benchmarks |

## Documentation

`docs/QUICKSTART.md`, `docs/DEMO_SCRIPT.md`, `docs/ARCHITECTURE.md`, `docs/SDK.md`, `docs/PRIVACY.md`, `docs/EVENT_SCHEMA.md`, `docs/API.md`, `docs/TEST_GENERATION.md`, `docs/REPRODUCTION_RUNNER.md`, `docs/BENCHMARKS.md`, `docs/LIMITATIONS.md`, `docs/ROADMAP.md`, `CONTRIBUTING.md`.

## Acknowledgements

Session recording is [rrweb](https://github.com/rrweb-io/rrweb) (MIT). Repro does not modify rrweb; it configures it and wraps it.

## License

MIT. See `LICENSE`.
