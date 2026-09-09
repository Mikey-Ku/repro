# Repro build checklist

Running checklist for the first release. Updated as work lands.

## 1. Architecture, contracts, acceptance tests
- [x] Toolchain: pnpm, Docker Compose plugin, Postgres image
- [x] Monorepo skeleton (pnpm workspaces, turbo, shared config)
- [ ] Event contracts and Zod schemas (`packages/contracts`)
- [ ] Normalisation and timeline model
- [ ] Acceptance test plan written (`tests/e2e`)

## 2. Local environment
- [ ] docker-compose Postgres
- [ ] Drizzle schema, migrations, seed (`packages/db`)
- [ ] `.env.example` with placeholders only

## 3. Demo application
- [ ] Login and checkout workflow, broken/fixed mode switch
- [ ] Canary secrets seeded (password, card, token, header, cookie, query string, hidden input, masked text, blocked region, response body)
- [ ] Failing E2E scenario

## 4. Browser SDK
- [ ] Public API: init, start, stop, captureException, identify, annotate, flush
- [ ] rrweb recording with masking defaults and strict mode
- [ ] Interaction capture with element descriptors (no rrweb node ids)
- [ ] Navigation, errors, rejections, console, fetch/XHR capture
- [ ] URL sanitisation, no headers, no bodies, no cookies
- [ ] Batching, gzip, bounded retry
- [ ] Payload-level privacy tests with canary corpus

## 5. Ingestion and persistence
- [ ] Project-scoped hashed keys
- [ ] Validated, size-limited, gzip-aware ingest endpoint
- [ ] Idempotent batches, chunk ordering, duplicate handling
- [ ] Session creation and completion, job enqueue
- [ ] Internal API for the dashboard
- [ ] Health endpoints, structured logs, clear errors
- [ ] Integration tests (idempotency, isolation, malformed rejection)

## 6. Dashboard
- [ ] Project overview, session list with filters
- [ ] Session detail: rrweb player, unified timeline, jump to error
- [ ] Evidence panel, generated test panel (highlighting, copy, download)
- [ ] Incident list and detail
- [ ] Empty, loading, error, disconnected states
- [ ] Keyboard access and responsive layout

## 7. Deterministic test generation
- [ ] Selector strategy (testid, role+name, label, stable attrs, css)
- [ ] Action translation (navigate, click, fill, select, check, submit, wait, expect)
- [ ] Sanitised literals, redacted secrets as fixture placeholders
- [ ] Omitted-event explanations and metadata header
- [ ] Fixture-based tests, determinism test

## 8. Reproduction runner
- [ ] Worker job queue
- [ ] Restricted Playwright runner (demo only, timeouts, no shell)
- [ ] Result, logs, trace, screenshot stored and shown

## 9. Diagnostics
- [ ] Deterministic evidence summary
- [ ] Investigator interface, fake provider, optional AI SDK adapter

## 10. Reviews and verification
- [ ] Security, accessibility, TypeScript, React reviews
- [ ] Clean-checkout verification script
- [ ] Lint, typecheck, unit, integration, E2E, production builds green

## 11. Measurement and docs
- [ ] Benchmark command and measured results
- [ ] README, architecture, quick start, demo script, SDK guide, privacy, schema, generation design, limitations, roadmap, contributing
