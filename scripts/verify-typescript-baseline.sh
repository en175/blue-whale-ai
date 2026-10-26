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

if [ ! -d backend/libs/contracts/gen/billing ]; then
  echo "契约产物 backend/libs/contracts/gen/ 缺失：请先在 contracts/ 目录执行 buf generate；若 buf.build 远端插件不可达，用 HTTPS_PROXY=http://127.0.0.1:7897 重试" >&2
  exit 1
fi

run_stage typecheck pnpm typecheck
run_stage build:node pnpm build:node
run_stage test pnpm test
