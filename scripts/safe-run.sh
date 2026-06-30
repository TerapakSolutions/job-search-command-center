#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/safe-run.sh \"<command>\"" >&2
  exit 1
fi

cmd="$1"
allowed_pattern='^(pnpm (test|lint|typecheck|build)|prettier|node |tsx )'

if [[ ! "$cmd" =~ $allowed_pattern ]]; then
  echo "Blocked command (not in allowlist): $cmd" >&2
  exit 1
fi

exec bash -lc "$cmd"
