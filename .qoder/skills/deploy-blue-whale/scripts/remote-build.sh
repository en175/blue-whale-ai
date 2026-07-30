#!/usr/bin/env bash
# 远程用 jars/ 里的 jar + Dockerfile.* build 镜像。
# 用法: remote-build.sh [gateway|user|agent ...]   默认全部
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
ensure_key

SERVICES=("$@")
if [ ${#SERVICES[@]} -eq 0 ]; then SERVICES=(gateway user agent web); fi
for s in "${SERVICES[@]}"; do check_svc "$s"; done

for svc in "${SERVICES[@]}"; do
  echo "▶ 远程 build blue-whale-$svc:latest"
  "${SSH[@]}" "cd $REMOTE_DIR && docker build -q -t blue-whale-$svc:latest -f Dockerfile.$svc ." \
    || { echo "✗ 远程 build $svc 失败（后端可能拉不到 eclipse-temurin:21-jre，前端可能拉不到 node:22-alpine；给远程 docker 配 mirror）" >&2; exit 1; }
done
echo "✓ remote build 完成"
