# Contributing to Repro

Thanks for looking. This is a first release, so the most useful contributions are bug reports with a recorded session, privacy findings, and generator improvements backed by fixtures.

## Setup

```bash
pnpm install
docker compose up -d db
pnpm db:migrate && pnpm db:seed
pnpm exec playwright install chromium
pnpm dev
```

See `docs/QUICKSTART.md` for the five-minute walkthrough.

## Before opening a pull request

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration   # needs Postgres
pnpm test:e2e           # needs Postgres and Playwright Chromium; starts every service itself
pnpm secrets:scan
```

`pnpm verify` runs all of that from a clean clone.

## Ground rules

- Privacy changes need a payload-level test. Testing the rendered dashboard is not enough; the assertion must inspect the serialised outbound batch or the persisted chunk.
- Generator changes need a fixture in `packages/test-generator/test/fixtures` and must keep the determinism test green.
- Contract changes go through `packages/contracts` and bump nothing silently: add a test, update `docs/EVENT_SCHEMA.md`.
- No new dependency without a sentence in the PR explaining why the standard library or an existing dependency does not cover it.
- Keep the demo application small. It exists to prove the vertical slice, not to become a product.
- Writing style for docs and UI copy: plain sentences, no em dashes.

## Project structure

`docs/ARCHITECTURE.md` explains the packages and the request flow. Each app and package has its own README with the local commands.

## License

By contributing you agree that your contributions are licensed under the MIT license in `LICENSE`.
