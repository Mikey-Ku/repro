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

The ingestion suite needs the per-key rate limit raised, otherwise most requests are answered with 429 and the numbers measure the limiter, not ingestion. The published run used `INGEST_RATE_LIMIT_PER_MINUTE=1000000` on the ingest service; the bench reports the error count so a limited run is visible.

Caveats: this is one developer laptop with other processes running, a single Postgres container, and services started from source with `tsx` or `next start`. Treat the numbers as an order of magnitude, not a guarantee.

## Results

<!-- bench:start -->

### Environment

- machine: Apple M5, 10 cores, 16 GB
- platform: Darwin 25.6.0 (arm64)
- node: v25.8.2
- date: 2026-09-10T02:51:35.807Z

### Results

| Metric | Value |
| --- | --- |
| SDK bundle (IIFE, minified) | 204.3 kB raw, 66.1 kB gzip, 44.7 kB brotli |
| SDK bundle (ESM, unminified) | 439.8 kB raw |
| Main-thread task time, demo workflow, median of 5 | 53 ms with SDK, 32 ms without, +21 ms added |
| Long tasks (>50 ms) during workflow | 0 with SDK, 0 without |
| Recording payload, one demo session (2.8 s) | 2 batches, 6.6 kB on the wire, 35.0 kB decompressed, 67 events (47 rrweb) |
| Redaction across the canary corpus | 12/12 canaries absent from every outbound batch |
| Ingestion throughput (16 concurrent clients, 10 s, 67 events and 6.5 kB gzip per batch) | 290 batches/s, 19400 events/s, 0 errors |
| Ingestion latency | p50 54.2 ms, p95 71.8 ms, p99 86.7 ms |
| Dashboard session page load (10 loads) | p50 26 ms, p95 33 ms to DOM complete; p50 841 ms, p95 880 ms until replay is rendered |
| Session list page load | p50 28 ms, p95 58 ms |
| Timeline API (events decode + evidence) | p50 9.4 ms, p95 11.7 ms |
| Generated-test success across committed fixtures | 3/3 generated, 2/3 pass in fixed mode, 2/3 fail in broken mode |

### Generator fixtures

| Fixture | Fixed mode | Broken mode |
| --- | --- | --- |
| checkout-enter-key-login | passed | failed |
| checkout-express-promo | passed | failed |
| checkout-standard | timeout | timeout |

<!-- bench:end -->
