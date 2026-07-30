#!/usr/bin/env bash
# 一键全流程：build jar → push → remote build image → restart。
# 用法: deploy.sh [gateway|user|agent ...]   默认全部
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

SERVICES=("$@")
if [ ${#SERVICES[@]} -eq 0 ]; then SERVICES=(gateway user agent web); fi
for s in "${SERVICES[@]}"; do check_svc "$s"; done

echo "==== 1/4 build jar ===="
"$SCRIPT_DIR/build.sh" "${SERVICES[@]}"
echo "==== 2/4 push jar + Dockerfile ===="
"$SCRIPT_DIR/push.sh" "${SERVICES[@]}"
echo "==== 3/4 remote build image ===="
"$SCRIPT_DIR/remote-build.sh" "${SERVICES[@]}"
echo "==== 4/4 restart ===="
"$SCRIPT_DIR/restart.sh" "${SERVICES[@]}"

echo ""
echo "✓✓ 部署完成  网关: http://$DEPLOY_HOST:8686  前端: http://$DEPLOY_HOST:3000"
