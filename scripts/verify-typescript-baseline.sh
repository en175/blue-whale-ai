#!/usr/bin/env bash

set -euo pipefail

[ "$(node --version)" = "v24.18.0" ] || { echo "Node.js 24.18.0 is required" >&2; exit 1; }
[ "$(pnpm --version)" = "11.17.0" ] || { echo "pnpm 11.17.0 is required" >&2; exit 1; }

if [ -n "${BW_VERIFICATION_STAGE_LOG:-}" ]; then
  : >"$BW_VERIFICATION_STAGE_LOG"
fi

run_stage() {
  local name="$1"
  local started_ms exit_code finished_ms
  shift
  started_ms="$(node -p 'Date.now()')"
  if "$@"; then
    exit_code=0
  else
    exit_code="$?"
  fi
  finished_ms="$(node -p 'Date.now()')"
  if [ -n "${BW_VERIFICATION_STAGE_LOG:-}" ]; then
    printf '{"name":"%s","exitCode":%s,"durationMs":%s}\n' \
      "$name" "$exit_code" "$((finished_ms - started_ms))" \
      >>"$BW_VERIFICATION_STAGE_LOG"
  fi
  return "$exit_code"
}

run_stage typecheck pnpm typecheck
run_stage build:node pnpm build:node
run_stage test pnpm test
