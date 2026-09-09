# Five-minute quick start

Prerequisites: Node 22 or newer, pnpm 10 or newer, Docker (for Postgres). About 400 MB of downloads the first time (dependencies and Playwright Chromium).

```bash
git clone <this repository> repro && cd repro
pnpm install
pnpm exec playwright install chromium
docker compose up -d db
pnpm db:migrate
pnpm db:seed          # creates the local user, the "demo" project and an ingestion key in .env
pnpm build            # builds the shared packages once
pnpm dev              # starts ingest (4000), worker (4200), demo (4100) and web (3000)
```

Then:

1. Open the demo store at http://localhost:4100 and sign in with any email and any password of 8 or more characters. Fill the checkout and press "Place order". The button sticks on "Placing order…" and the page throws. That is the bug.
2. Open the dashboard at http://localhost:3000. The session is listed under Sessions with one error. Open it.
3. Watch the replay, press "Jump to first error", and read the timeline: the `POST /api/orders` request succeeded and a `TypeError` followed it.
4. Open the Test tab, add a "visible" expectation for the test id `order-confirmation`, and generate the test.
5. Open the Runs tab. Run against demo (broken): the test fails because the confirmation never appears and an uncaught error was recorded. Run against demo (fixed): it passes.

To run the same journey as an automated test:

```bash
pnpm test:e2e
```

To run every check from a clean clone (install, migrate, build, lint, typecheck, unit, integration, secret scan, E2E):

```bash
pnpm verify
```

## Common problems

- **Port already in use.** Change `WEB_PORT`, `INGEST_PORT`, `DEMO_PORT` or `WORKER_PORT` in `.env`.
- **Dashboard says Disconnected.** The ingest service is not running or `INGEST_URL` in `.env` is wrong. Start it with `pnpm --filter @repro/ingest dev`.
- **Runs stay queued.** The worker is not running. Start it with `pnpm --filter @repro/worker dev`.
- **Runs fail with a browser error.** Run `pnpm exec playwright install chromium`.
- **The demo does not record.** `DEMO_PROJECT_KEY` is empty in `.env`. Run `pnpm db:seed` again, or create a key under Settings in the dashboard and paste it in.
