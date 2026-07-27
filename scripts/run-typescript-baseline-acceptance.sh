#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/deploy/typescript-baseline/docker-compose.acceptance.yml"
PROJECT="${BW_TS_COMPOSE_PROJECT:-bw-ts-baseline-acceptance}"

dc() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"
}

# Invoked indirectly by the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
  dc down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

GIT_COMMIT="$(git -C "$ROOT" rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export GIT_COMMIT BUILD_TIME
export BW_TS_COMPOSE_FILE="$COMPOSE_FILE"
export BW_TS_COMPOSE_PROJECT="$PROJECT"

"$ROOT/scripts/init-typescript-baseline-db.sh"
dc up -d --build product-api agent-worker generation-worker web

deadline=$((SECONDS + 180))
while [ "$SECONDS" -lt "$deadline" ]; do
  pending=0
  for service in product-api agent-worker generation-worker web; do
    container_id="$(dc ps -q "$service")"
    if [ -z "$container_id" ] || [ "$(docker inspect -f '{{.State.Health.Status}}' "$container_id")" != "healthy" ]; then
      pending=1
    fi
  done
  if [ "$pending" -eq 0 ]; then
    node --test "$ROOT/tests/typescript-baseline/fullstack.test.mjs"
    exit 0
  fi
  sleep 2
done

dc ps >&2
dc logs --no-color --tail=200 >&2
echo "TypeScript baseline stack did not become ready" >&2
exit 1
