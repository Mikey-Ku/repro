# @repro/web

The Repro dashboard: Next.js 16 App Router, React 19, Tailwind 4.

## Routes

| Route | Page |
| --- | --- |
| `/` | redirects to the first project |
| `/projects/[slug]` | overview: stat tiles, recent sessions, open incidents, getting-started snippet |
| `/projects/[slug]/sessions` | session list with filters (status, release, route, browser, errors, time) and cursor pagination |
| `/projects/[slug]/sessions/[id]` | replay, unified timeline, evidence, generated tests, reproduction runs, investigation |
| `/projects/[slug]/incidents` and `/incidents/[id]` | incident list and detail with a link into the replay at the error |
| `/projects/[slug]/settings` | ingestion keys and the SDK snippet |
| `/api/health` | dashboard health plus the ingest ping |

## Run

```bash
pnpm --filter @repro/web dev
pnpm --filter @repro/web build && pnpm --filter @repro/web start
```

Environment (read on the server only, from the repository root `.env` when the variable is not already set): `INGEST_URL` (default `http://localhost:4000`), `REPRO_INTERNAL_TOKEN`, `WEB_PORT`.

## The internal token never reaches the browser

`src/lib/api.ts` is marked `server-only` and is the only module that knows the token. Server components call it directly. Mutations (generate a test, create a run, investigate, create or revoke keys, resolve an incident) are server actions in `src/lib/actions.ts`. Client components that need data on a timer, such as the run poller and the replay loader, call route handlers under `src/app/api/projects/[slug]/...`, which proxy to the ingest API on the server. Anyone who can reach the dashboard port has the same access as the token, which is the intended single-user local model for this release.

## Replay sandbox

`src/components/session/ReplayPlayer.tsx` loads rrweb events through the proxy route and mounts `rrweb-player`. rrweb rebuilds the recorded DOM inside an iframe whose `sandbox` attribute is exactly `allow-same-origin`, with no `allow-scripts`, and rrweb-snapshot serialises `<script>` elements as inert placeholders. The component asserts the sandbox list after mount. Every other recorded value (console output, error messages, URLs, element names) is rendered through React's default escaping; the only `dangerouslySetInnerHTML` is shiki's highlighted output of generator-produced code.

## Connectivity

The project layout pings `GET /health` on the ingest service with a 1.5 second timeout on every request and renders a status dot. When the ping fails, pages render `src/components/layout/Disconnected.tsx` with the configured URL and the command to start the service instead of crashing.

## Tests

```bash
pnpm --filter @repro/web test
```

Vitest with jsdom and Testing Library: `Tabs.test.tsx` (keyboard navigation), `TimelinePanel.test.tsx` (rows, seeking, XSS-shaped content rendered as text), `EvidencePanel.test.tsx` (gaps and refs), `filters.test.ts`, `format.test.ts`.

## Where things live

| Path | Responsibility |
| --- | --- |
| `src/app/` | routes, layouts, loading and error boundaries, proxy route handlers |
| `src/components/session/` | player, timeline, evidence, test, runs and investigate panels |
| `src/components/ui/` | Badge, Button, Card, Tabs, Disclosure, Table, StatTile and friends |
| `src/lib/api.ts` | typed server-only client over the internal API |
| `src/lib/actions.ts` | server actions |
| `src/lib/highlight.ts` | shiki highlighting |
