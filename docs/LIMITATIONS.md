# Known limitations

Honest list for the first release. Items marked (roadmap) have a planned direction in `docs/ROADMAP.md`.

## Product

- **Reproduction runs only target the bundled demo application.** The runner refuses any URL outside `DEMO_URL`. Running generated tests against your own application means copying the file into your own Playwright project. (roadmap)
- **Expected success state is partly manual.** The recording captures a failure, so the intended outcome is not in the data. By default the generated test asserts "no uncaught errors and the last request succeeded"; a visible-element or URL expectation must be added by the engineer in the Test tab.
- **Single local user, shared internal token.** There is no login, no roles, no audit log. Do not expose the dashboard or the internal API beyond localhost.
- **Incidents are per session.** The same bug in ten sessions is ten incidents with the same fingerprint, not one grouped issue. (roadmap)
- **No source maps.** Stack traces show bundled file positions.
- **The AI investigator is unproven.** It is wired, tested with a fake model, and off by default. Its output quality has not been evaluated.

## SDK

- Values typed into unmasked fields are in the rrweb stream even if later deleted.
- Path segments of URLs are not redacted, only query strings and fragments.
- Text rendered on the page is captured unless masked with `data-repro-mask`, blocked with `data-repro-block`, or covered by `strict` mode plus `maskSelector`.
- Canvas, WebGL, video and cross-origin iframes are not recorded.
- Shadow DOM interactions produce descriptors for the host element only, so generated selectors may miss.
- `sendBeacon` uploads on page unload are not compressed and are best effort. A tab closed mid-batch can lose the final events; the worker marks such sessions expired after 30 minutes and processes what arrived.
- The SDK patches `fetch`, `XMLHttpRequest`, `history` and `console`. Other libraries that patch the same objects (some analytics or error tools) may interact badly.

## Server

- Chunks live in Postgres as gzip `bytea`. Fine for local use and small teams; move to object storage for volume. (roadmap)
- Rate limiting is per process and in memory.
- Run artifacts on disk are not deleted by session retention. Delete `apps/worker/artifacts/<runId>` manually or clear the directory.
- Migrations are forward-only; there is no down migration.

## Dashboard

- Replay requires all rrweb events for a session in memory in the browser. Very long sessions (tens of thousands of events) will be slow to load.
- Timeline search is by kind only; there is no text search.
- Light theme is not provided; the UI is dark only, with AA contrast.

## Testing and measurement

- The E2E suite drives one browser (Chromium). Firefox and WebKit are not exercised.
- Benchmarks were run on one laptop. See `docs/BENCHMARKS.md` for the exact environment.
- The generated-test success rate is measured across the committed fixtures only, all of which come from the demo application.
