# Repro: orientation for Claude Code sessions

Owner: Michael Ku. This repository is a portfolio project; every decision should stay explainable in plain language.

## What this is

Privacy-first browser session replay plus automated bug reproduction. A browser SDK records a failing session with secrets masked in the browser, the server ingests it, the dashboard replays it, and a deterministic generator turns it into a Playwright test that fails on the broken demo app and passes on the fixed one.

## Where to look

- `docs/ARCHITECTURE.md` for the four services and the request flow.
- `docs/API.md` is the contract between `apps/ingest` and `apps/web`.
- `packages/contracts/src` defines every event, DTO and normalisation rule. Change contracts first, then consumers.
- `docs/PRIVACY.md` lists every protection and every gap. A privacy change needs a payload-level test.
- `docs/TEST_GENERATION.md` explains selector priority and determinism.
- `docs/REPRODUCTION_RUNNER.md` explains what the worker will and will not execute.
- `CHECKLIST.md` is the build checklist for the first release.

## Commands

```bash
pnpm install && docker compose up -d db && pnpm db:migrate && pnpm db:seed
pnpm build && pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e
pnpm bench
pnpm verify        # everything, from a clean clone
```

## Conventions

- pnpm workspaces, ESM, TypeScript strict, Zod 4, Vitest 4, Playwright 1.63, Next 16, Fastify 5, Drizzle.
- No em dashes anywhere (docs, UI copy, comments).
- Commits are authored by Michael. Do not add co-author trailers. Do not push.
- Do not mock the database in integration tests. Do not weaken a privacy test to make it pass.
- Keep the demo app small; it exists to prove the vertical slice.

## Explaining the project

When asked to explain the codebase, start from `docs/LEARNING.md`, which walks the journey of one session from keystroke to generated test, then point at the specific files for each step.
