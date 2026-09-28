#!/usr/bin/env bash
# tag 维度回滚：读远端 .image-tag.prev，用 prev tag 的存活镜像 compose up -d --no-build 重建。
# --no-build 关键：直接复用远端存活的 prev tagged 镜像（restart.sh 的 image prune -f 不带 --all，
# 只删 dangling 无 tag 镜像，带 tag 的旧镜像存活），避免用当前（新）二进制重建出错的 tag。
# prev 缺失/为空 → 明确报错退出（不静默回退 latest，回滚必须可追溯）。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
ensure_key

PREV_TAG="$("${SSH[@]}" "cat $REMOTE_DIR/.image-tag.prev 2>/dev/null || true")"
if [ -z "$PREV_TAG" ]; then
  echo "✗ 远端 $REMOTE_DIR/.image-tag.prev 不存在或为空，无 tag 维度回滚目标" >&2
  echo "  （首次部署无 prev；或 restart.sh 时容器不存在未记录）" >&2
  exit 1
fi
PREV_SHORT="${PREV_TAG#blue-whale-api:}"

echo "▶ 回滚到 prev image tag：$PREV_TAG"
"${SSH[@]}" "cd $REMOTE_DIR && NEW_API_IMAGE_TAG=$PREV_SHORT docker compose up -d --no-build"

echo "▶ 验证 http://localhost:$API_PORT/api/status（重试 8×3s）"
"${SSH[@]}" "for i in 1 2 3 4 5 6 7 8; do curl -fsS http://localhost:$API_PORT/api/status >/dev/null && exit 0; sleep 3; done; exit 1" \
  || { echo "  ✗ 验证失败，日志：" >&2; "${SSH[@]}" "docker logs --tail 30 $CONTAINER" >&2 || true; exit 1; }
echo "  ✓ /api/status 200（已回滚到 ${PREV_TAG}）"  # ${PREV_TAG} 界定：紧邻全角），bash 3.2 CJK 边界 bug
