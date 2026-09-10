# Repro build checklist

Running checklist for the first release. Updated as work lands.

## 1. Architecture, contracts, acceptance tests
- [x] Toolchain: pnpm, Docker Compose plugin, Postgres image
- [x] Monorepo skeleton (pnpm workspaces, turbo, shared config)
- [x] Event contracts and Zod schemas (`packages/contracts`)
- [x] Normalisation and timeline model
- [x] Acceptance test plan written (`tests/e2e`)

## 2. Local environment
- [x] docker-compose Postgres
- [x] Drizzle schema, migrations, seed (`packages/db`)
- [x] `.env.example` with placeholders only

## 3. Demo application
- [x] Login and checkout workflow, broken/fixed mode switch
- [x] Canary secrets seeded (password, card, token, header, cookie, query string, hidden input, masked text, blocked region, response body)
- [x] Failing E2E scenario

## 4. Browser SDK
- [x] Public API: init, start, stop, captureException, identify, annotate, flush
- [x] rrweb recording with masking defaults and strict mode
- [x] Interaction capture with element descriptors (no rrweb node ids)
- [x] Navigation, errors, rejections, console, fetch/XHR capture
- [x] URL sanitisation, no headers, no bodies, no cookies
- [x] Batching, gzip, bounded retry
- [x] Payload-level privacy tests with canary corpus

## 5. Ingestion and persistence
- [x] Project-scoped hashed keys
- [x] Validated, size-limited, gzip-aware ingest endpoint
- [x] Idempotent batches, chunk ordering, duplicate handling
- [x] Session creation and completion, job enqueue
- [x] Internal API for the dashboard
- [x] Health endpoints, structured logs, clear errors
- [x] Integration tests (idempotency, isolation, malformed rejection)

## 6. Dashboard
- [x] Project overview, session list with filters
- [x] Session detail: rrweb player, unified timeline, jump to error
- [x] Evidence panel, generated test panel (highlighting, copy, download)
- [x] Incident list and detail
- [x] Empty, loading, error, disconnected states
- [x] Keyboard access and responsive layout

## 7. Deterministic test generation
- [x] Selector strategy (testid, role+name, label, stable attrs, css)
- [x] Action translation (navigate, click, fill, select, check, submit, wait, expect)
- [x] Sanitised literals, redacted secrets as fixture placeholders
- [x] Omitted-event explanations and metadata header
- [x] Fixture-based tests, determinism test

## 8. Reproduction runner
- [x] Worker job queue
- [x] Restricted Playwright runner (demo only, timeouts, no shell)
- [x] Result, logs, trace, screenshot stored and shown

## 9. Diagnostics
- [x] Deterministic evidence summary
- [x] Investigator interface, fake provider, optional AI SDK adapter

## 10. Reviews and verification
- [x] Security, accessibility, TypeScript, React reviews
- [ ] Clean-checkout verification script run from a clean clone
- [x] Lint, typecheck, unit, integration, E2E, production builds green

## 11. Measurement and docs
- [x] Benchmark command and measured results
- [x] README results section filled from measured benchmarks
