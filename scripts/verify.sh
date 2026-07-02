#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Typecheck first so type errors fail fast before the (slower) Jest suite runs.
# `set -e` preserves stop-on-first-failure, so a type error exits before tests.
# `pnpm build` still runs its own typecheck; that is intentional (build behavior
# is left unchanged), the leading typecheck only moves the failure earlier.
pnpm typecheck
pnpm lint
pnpm test
pnpm build
