# Repro API

Two surfaces live in `apps/ingest`:

1. **Public ingestion API** under `/v1`. Called by the browser SDK from end-user browsers. Authenticated by a project ingestion key.
2. **Internal application API** under `/api`. Called by the dashboard server (never from the browser). Authenticated by the shared `REPRO_INTERNAL_TOKEN`.

Every response is JSON. Errors use one shape:

```json
{ "ok": false, "error": { "code": "validation_failed", "message": "...", "details": {} } }
```

Error codes: `unauthorized`, `forbidden`, `not_found`, `validation_failed`, `payload_too_large`, `unsupported_encoding`, `rate_limited`, `conflict`, `internal`.

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Process liveness. `{ ok, service, version, uptimeSeconds }` |
| GET | `/ready` | Runs `SELECT 1`. 503 when the database is unreachable. |

## Public ingestion

### `POST /v1/ingest`

Headers:

- `x-repro-key: rp_...` (required). Also accepted as `?key=` for `sendBeacon` uploads.
- `content-type: application/json`
- `content-encoding: gzip` (optional). Bodies are decompressed before validation. Decompressed size is capped by `INGEST_MAX_BATCH_BYTES`.

Body: `IngestBatch` from `@repro/contracts`. Validation failures return 400 with Zod issues in `details`.

Semantics:

- The first batch for a `sessionId` creates the session. It must carry `meta`.
- `(sessionId, batchSeq)` is unique. A repeat returns 200 with `duplicate: true` and is not stored again.
- Chunks are stored gzip-compressed with `firstSeq` and `lastSeq`; reads order by `batchSeq`.
- `final: true` marks the session `completed`, sets `endedAt`, and enqueues a `process_session` job.
- A session that belongs to another project (key mismatch) is rejected with 403.
- Sessions with no batches for 30 minutes are marked `expired` by the worker.

Response: `IngestResponse`.

CORS: `*` for `/v1/*` only, methods `POST, OPTIONS`, headers `content-type, content-encoding, x-repro-key`.

Rate limiting: `@fastify/rate-limit`, in-memory, keyed by ingestion key, default 600 requests per minute per key. This is the documented local substitute for a shared limiter.

## Internal API

All routes require `x-repro-internal-token`. All resources are scoped by project in the path. A resource that exists but belongs to another project returns 404, never 403, so the response does not confirm existence.

### Me and projects

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/me` | `{ user: { id, email, name }, projects: Project[] }` |
| GET | `/api/projects` | `Project[]` |
| POST | `/api/projects` | body `{ name, slug }` → `Project` |
| GET | `/api/projects/:projectId` | `Project & { stats: ProjectStats }` |
| GET | `/api/projects/by-slug/:slug` | `Project & { stats: ProjectStats }` |
| GET | `/api/projects/:projectId/keys` | `IngestionKey[]` |
| POST | `/api/projects/:projectId/keys` | body `{ label }` → `IngestionKey & { key: string }` (plaintext once) |
| DELETE | `/api/projects/:projectId/keys/:keyId` | revokes → `{ ok: true }` |

### Sessions

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/projects/:projectId/sessions` | query `SessionFilters` → `SessionListResponse` |
| GET | `/api/projects/:projectId/sessions/:sessionId` | `{ session: SessionSummary, incidents: Incident[], tests: GeneratedTest[], findings: DiagnosticFinding[] }` |
| GET | `/api/projects/:projectId/sessions/:sessionId/events` | query `?types=rrweb,click` (optional) → `{ events: RecordedEvent[], meta: SessionMeta }` ordered by `seq`, deduplicated |
| GET | `/api/projects/:projectId/sessions/:sessionId/timeline` | `{ entries: TimelineEntry[], evidence: EvidenceSummary }` |
| DELETE | `/api/projects/:projectId/sessions/:sessionId` | `{ ok: true }` |

Cursor pagination: `nextCursor` is an opaque base64 of `startedAt|id`. Sorting is `startedAt desc, id desc`.

Filter semantics: `status` exact; `release` exact; `route` matches `initialRoute` or any entry of `routes`; `browser` matches `browserName`; `hasErrors=true` means `errorCount > 0`; `from` and `to` bound `startedAt`.

### Incidents

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/projects/:projectId/incidents` | query `?status=open&limit=50` → `{ items: Incident[] }` |
| GET | `/api/projects/:projectId/incidents/groups` | query `?status=open&limit=50` → `{ items: IncidentGroup[] }` |
| GET | `/api/projects/:projectId/incidents/:incidentId` | `{ incident: Incident, session: SessionSummary, tests: GeneratedTest[] }` |
| PATCH | `/api/projects/:projectId/incidents/:incidentId` | body `{ status }` → `Incident` |

Incidents are one row per fingerprint per session. `/incidents/groups` folds them across sessions: one `IncidentGroup` per fingerprint with `sessionCount`, `firstSeen`, `lastSeen`, distinct `releases` and `routes`, `openCount`, and `latestIncidentId` and `latestSessionId` (the newest incident by `firstTs`, whose `kind`, `title` and `message` label the group). Ordered by `lastSeen desc`. It is one grouped query over `incidents`; there is no groups table.

Group status is derived: `status=open` returns groups with at least one open incident, `status=resolved` returns groups whose incidents are all resolved. Counts always cover the whole group regardless of the filter. `ProjectStats.openIncidentGroups` is the number of groups that `status=open` would return.

### Generated tests

| Method | Path | Response |
| --- | --- | --- |
| POST | `/api/projects/:projectId/sessions/:sessionId/tests` | body `GenerateTestRequest` → `GeneratedTest` (synchronous, deterministic) |
| GET | `/api/projects/:projectId/sessions/:sessionId/tests` | `GeneratedTest[]` newest first |
| GET | `/api/projects/:projectId/tests/:testId` | `GeneratedTest` |
| GET | `/api/projects/:projectId/tests/:testId/code` | `text/plain` body, `content-disposition: attachment; filename="repro-<sessionId8>.spec.ts"` |

Generation is versioned per session: each call stores a new row with `version = previous + 1`, unless the `sourceHash` and expectations match the latest version, in which case the latest row is returned unchanged.

### Reproduction runs

| Method | Path | Response |
| --- | --- | --- |
| POST | `/api/projects/:projectId/tests/:testId/runs` | body `CreateRunRequest` → `ReproductionRun` with status `queued` |
| GET | `/api/projects/:projectId/tests/:testId/runs` | `ReproductionRun[]` newest first |
| GET | `/api/projects/:projectId/runs/:runId` | `ReproductionRun` |
| GET | `/api/projects/:projectId/runs/:runId/artifacts/:name` | binary artifact (`screenshot.png`, `trace.zip`, `report.json`) |

Runs execute only against the bundled demo application. See `docs/REPRODUCTION_RUNNER.md`.

### Diagnostics

| Method | Path | Response |
| --- | --- | --- |
| POST | `/api/projects/:projectId/sessions/:sessionId/investigate` | runs the configured investigator (fake by default) → `DiagnosticFinding` |
| GET | `/api/projects/:projectId/sessions/:sessionId/findings` | `DiagnosticFinding[]` |

## Logging

Structured JSON logs via pino. Every request log carries `reqId`, `method`, `url`, `statusCode`, `responseTime`, and `projectId` when known. Ingestion keys are never logged; only the key prefix is.
