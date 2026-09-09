#!/usr/bin/env bash
# Full verification from a clean checkout. Mirrors what CI would do.
#
#   pnpm verify                     clone HEAD into a temp dir and run everything there
#   VERIFY_IN_PLACE=1 pnpm verify   run in the current working tree instead
#
# Requires: Docker (for Postgres), Node >= 22, pnpm, Playwright Chromium.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${VERIFY_IN_PLACE:-0}" == "1" ]]; then
  WORK="$ROOT"
else
  WORK="$(mktemp -d /tmp/repro-verify.XXXXXX)"
  echo "==> Cloning HEAD into $WORK"
  git clone -q "$ROOT" "$WORK"
fi
cd "$WORK"

step() { echo; echo "==> $*"; }

step "Install from lockfile"
pnpm install --frozen-lockfile

step "Start Postgres"
docker compose up -d db
for i in $(seq 1 30); do
  docker exec repro-db pg_isready -U repro -d repro >/dev/null 2>&1 && break
  sleep 1
done

export DATABASE_URL="${DATABASE_URL:-postgres://repro:repro@localhost:5432/repro}"
export DEMO_PROJECT_KEY="${DEMO_PROJECT_KEY:-rp_verify_demo_key_0123456789abcdefgh}"
export REPRO_INTERNAL_TOKEN="${REPRO_INTERNAL_TOKEN:-verify-internal-token}"
[[ -f .env ]] || cp .env.example .env

step "Apply migrations and seed"
pnpm db:migrate
pnpm db:seed

step "Build every workspace"
pnpm build

step "Lint"
pnpm lint

step "Typecheck"
pnpm typecheck

step "Unit tests"
pnpm test

step "Integration tests"
pnpm test:integration

step "Secret scan"
pnpm secrets:scan

step "End-to-end product journey"
pnpm test:e2e

echo
echo "==> Verification passed in $WORK"
