# Benchmarks

Every number in this file was produced by `pnpm bench` on the machine described in the environment block. Nothing here is estimated. Re-run the command to regenerate the results section; the methodology section is maintained by hand.

## Methodology

`scripts/bench/run.ts` runs five suites against the locally running stack (`pnpm dev`, Postgres in Docker, Playwright Chromium).

| Suite | What is measured | How |
| --- | --- | --- |
| bundle | SDK size | Byte length of `packages/browser-sdk/dist/repro.iife.js` raw, gzip (level 9) and brotli, plus the unminified ESM build |
| workflow | Added main-thread time and recording payload | Playwright drives the demo login and checkout (the same steps as the E2E suite, including the canary secrets) 5 times with the SDK and 5 times with the SDK script replaced by a no-op stub, after one warm-up of each. Main-thread cost is Chrome DevTools Protocol `Performance.getMetrics` `TaskDuration` at the end of the workflow; long tasks come from a `PerformanceObserver`. Payload size is the sum of intercepted `POST /v1/ingest` bodies (compressed as sent, and decompressed). Redaction is checked by searching every decompressed body for every canary in `apps/demo/canaries.json`. |
| ingest | Ingestion throughput and latency | 16 concurrent clients post the first recorded batch of the workflow session (with fresh session ids) as gzip for 10 seconds to a throwaway project that is deleted afterwards. Latency is measured per request from the client; p50, p95 and p99 are reported. |
| dashboard | Dashboard session-load latency | After one warm-up, 10 loads each of the session detail page (`domComplete` from Navigation Timing, and wall time until the rrweb replay iframe has rendered content), the session list page, and the timeline API call. |
| generator | Generated-test success rate | For each fixture in `scripts/bench/fixtures`, the recorded events are ingested as a new session, a test is generated through the API, and a reproduction run is executed in fixed mode (expected to pass) and in broken mode (expected to fail). |

Caveats: this is one developer laptop with other processes running, a single Postgres container, and services started from source with `tsx` or `next start`. Treat the numbers as an order of magnitude, not a guarantee.

## Results

<!-- bench:start -->

Not yet measured. Run `pnpm bench --write-docs`.

<!-- bench:end -->
