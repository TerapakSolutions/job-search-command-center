#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm lint
pnpm test
pnpm build
