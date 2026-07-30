#!/usr/bin/env bash
# 本地 mvn package 打 fat jar（不碰 docker）。
# 用法: build.sh [gateway|user|agent ...]   默认全部
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
SERVER_DIR="$REPO_ROOT/blue_whale_server"

SERVICES=("$@")
if [ ${#SERVICES[@]} -eq 0 ]; then SERVICES=(gateway user agent web); fi

build_one() {
  local svc="$1"
  if [ "$svc" = web ]; then
    echo "▶ npm run build (next standalone)"
    (cd "$REPO_ROOT/blue_whale_web" && NEXT_TELEMETRY_DISABLED=1 npm run build)
    [ -d "$REPO_ROOT/blue_whale_web/.next/standalone" ] || { echo "✗ 未找到 standalone 产物" >&2; exit 1; }
    echo "  → .next/standalone"
    return
  fi
  echo "▶ mvn package $svc"
  (cd "$SERVER_DIR" && case "$svc" in
    gateway)
      ./mvnw -q -f blue-whale-parent/pom.xml install -Dmaven.test.skip=true -B
      ./mvnw -q -f blue-whale-gateway/pom.xml package -Dmaven.test.skip=true -B ;;
    user)
      ./mvnw -q -f blue-whale-parent/pom.xml install -Dmaven.test.skip=true -B
      ./mvnw -q -f blue-whale-user/blue-whale-user-api/pom.xml install -Dmaven.test.skip=true -B
      ./mvnw -q -f blue-whale-user/blue-whale-user-service/pom.xml package -Dmaven.test.skip=true -B ;;
    agent)
      ./mvnw -q -f blue-whale-parent/pom.xml install -Dmaven.test.skip=true -B
      ./mvnw -q -f blue-whale-agent/blue-whale-agent-api/pom.xml install -Dmaven.test.skip=true -B
      ./mvnw -q -f blue-whale-agent/blue-whale-agent-service/pom.xml package -Dmaven.test.skip=true -B ;;
  esac)
  local jar; jar=$(find_jar "$svc" "$REPO_ROOT")
  [ -n "$jar" ] || { echo "✗ 未找到 $svc fat jar" >&2; exit 1; }
  echo "  → $(basename "$jar")"
}

for s in "${SERVICES[@]}"; do check_svc "$s"; build_one "$s"; done
echo "✓ build jar 完成"
