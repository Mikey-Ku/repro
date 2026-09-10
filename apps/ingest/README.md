# @repro/ingest

Fastify 5 service with two surfaces, both specified in `docs/API.md`:

- **Public ingestion API** under `/v1`: the browser SDK posts event batches here, authenticated by a project ingestion key.
- **Internal application API** under `/api`: the dashboard calls this from the server side with the shared `REPRO_INTERNAL_TOKEN`. Never exposed to browsers.

## Run

```bash
pnpm --filter @repro/ingest dev     # tsx watch src/main.ts
pnpm --filter @repro/ingest start   # node dist/main.js after pnpm build
```

Reads the repository root `.env` without overriding variables already set in the shell.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | Postgres connection string |
| `REPRO_INTERNAL_TOKEN` | required | shared secret for `/api` routes |
| `INGEST_HOST`, `INGEST_PORT` | `0.0.0.0`, `4000` | listen address |
| `INGEST_MAX_BATCH_BYTES` | `2000000` | cap on the decompressed batch size |
| `INGEST_RATE_LIMIT_PER_MINUTE` | `600` | ingestion requests per minute per key |
| `REPRO_ARTIFACTS_DIR` | `<repo>/.repro/artifacts` | fallback base for relative artifact paths |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | dashboard URL written into generated tests |
| `LOG_LEVEL` | `info` | pino level |

## How ingestion works

1. `plugins/auth.ts` reads `x-repro-key` (or `?key=` for `sendBeacon`), looks the key up by prefix and verifies it against the stored SHA-256 hash with a constant-time compare (`packages/db/src/keys.ts`). Revoked keys are refused. Plaintext keys are never stored or logged; only the prefix is.
2. `plugins/body.ts` reads the body as a buffer, gunzips when `content-encoding: gzip` is set, and rejects bodies over the cap with 413 or unknown encodings with 415. `application/json` and `text/plain` are accepted, the latter for beacon uploads.
3. `routes/ingest.ts` validates the batch with `IngestBatchSchema` from `@repro/contracts` (400 with Zod issues on failure), re-sanitises URLs, messages, rrweb URLs, identify traits and annotations in `services/sanitize.ts`, then `services/sessions.ts` upserts the session and inserts one `event_chunks` row per batch inside a transaction. The unique index on `(session_id, batch_seq)` makes retries idempotent; a repeat answers `duplicate: true`.
4. A batch with `final: true` marks the session completed and enqueues a `process_session` job for the worker.

## Rate limiting

`plugins/rate-limit.ts` uses `@fastify/rate-limit` in memory, keyed by ingestion key (or client IP when there is no key), only on `/v1` routes. Counts live in this process and reset on restart. This is the documented local substitute for a shared limiter.

## Logs

Structured JSON via pino. Each request logs `reqId`, `method`, `url`, `statusCode`, `responseTime`, and `projectId` when known. Errors are logged with their stack on the server; clients only ever receive the `{ ok: false, error: { code, message, details } }` shape from `plugins/errors.ts`.

## Tests

```bash
pnpm --filter @repro/ingest test               # unit: body parsing, keys, errors, mappers, cursors
pnpm --filter @repro/ingest test:integration   # real Postgres from DATABASE_URL
```

Integration files (each creates and deletes its own project rows): `ingest` (happy path, ordering, out-of-order batches, idempotency), `malformed` (schema violations, size cap, encodings, bad keys), `isolation` (cross-project access is 403 or 404), `sessions-list` (filters, facets, cursor), `tests` (generation, versioning, code download), `runs` (job queueing, artifacts), `diagnostics` (timeline, evidence, investigate), `privacy` (server-side scrubbing verified by reading raw chunks back), `projects` (keys), `health`.

## Where things live

| Path | Responsibility |
| --- | --- |
| `src/app.ts` | builds the Fastify instance with injectable options |
| `src/plugins/` | auth, body parsing, CORS, error shape, rate limit |
| `src/routes/` | one file per resource |
| `src/services/` | database access and business rules |
| `src/mappers.ts` | rows to the DTOs in `@repro/contracts` |
