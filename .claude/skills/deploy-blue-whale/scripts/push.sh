#!/usr/bin/env bash
# scp jar + Dockerfile + compose 到远程。
# 用法: push.sh [gateway|user|agent ...]   默认全部
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
ensure_key

SERVICES=("$@")
if [ ${#SERVICES[@]} -eq 0 ]; then SERVICES=(gateway user agent web); fi
for s in "${SERVICES[@]}"; do check_svc "$s"; done

"${SSH[@]}" "mkdir -p $REMOTE_DIR/jars"

for svc in "${SERVICES[@]}"; do
  if [ "$svc" = web ]; then
    echo "▶ 打包 + scp web standalone 产物"
    tar_args=(-C "$REPO_ROOT/blue_whale_web/.next" standalone -C "$REPO_ROOT/blue_whale_web/.next" static)
    [ -d "$REPO_ROOT/blue_whale_web/public" ] && tar_args+=(-C "$REPO_ROOT/blue_whale_web" public)
    tar -czf /tmp/bw-web.tar.gz "${tar_args[@]}"
    "${SCP[@]}" /tmp/bw-web.tar.gz "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/bw-web.tar.gz"
    "${SSH[@]}" "cd $REMOTE_DIR && rm -rf web && mkdir -p web/public && tar -xzf bw-web.tar.gz -C web && rm bw-web.tar.gz"
    rm -f /tmp/bw-web.tar.gz
    continue
  fi
  jar=$(find_jar "$svc" "$REPO_ROOT")
  [ -n "$jar" ] || { echo "✗ $svc jar 不存在，先跑 build.sh" >&2; exit 1; }
  echo "▶ scp $svc → $REMOTE_DIR/jars/blue-whale-$svc.jar"
  "${SCP[@]}" "$jar" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/jars/blue-whale-$svc.jar"
  # gateway 外置依赖打包（瘦 jar + lib/ + config/），额外传依赖与配置到 build context
  if [ "$svc" = "gateway" ]; then
    gw_target="$REPO_ROOT/blue_whale_server/blue-whale-gateway/target"
    echo "▶ scp gateway lib/ + config/（外置依赖 ~50MB）"
    "${SSH[@]}" "rm -rf $REMOTE_DIR/lib $REMOTE_DIR/config && mkdir -p $REMOTE_DIR/lib $REMOTE_DIR/config"
    "${SCP[@]}" -r "$gw_target/lib/." "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/lib/"
    "${SCP[@]}" -r "$gw_target/config/." "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/config/"
  fi
done

echo "▶ scp Dockerfile.* + compose"
"${SCP[@]}" "$SKILL_DIR/docker/Dockerfile.gateway" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/Dockerfile.gateway"
"${SCP[@]}" "$SKILL_DIR/docker/Dockerfile.user"    "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/Dockerfile.user"
"${SCP[@]}" "$SKILL_DIR/docker/Dockerfile.agent"   "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/Dockerfile.agent"
"${SCP[@]}" "$SKILL_DIR/docker/Dockerfile.web"     "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/Dockerfile.web"
"${SCP[@]}" "$SKILL_DIR/docker/docker-compose.remote.yml" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/docker-compose.yml"
echo "✓ push 完成"
