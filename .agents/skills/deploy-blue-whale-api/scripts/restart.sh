#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ensure_key

echo "▶ 备份当前二进制 → $BIN_NAME.prev（回滚用）"
"${SSH[@]}" "cd $REMOTE_DIR && [ -f $BIN_NAME ] && cp -a $BIN_NAME $BIN_NAME.prev || true"

echo "▶ 记录当前 image tag → .image-tag.prev（tag 维度回滚用）"
"${SSH[@]}" "prev=\$(docker inspect --format '{{.Config.Image}}' $CONTAINER 2>/dev/null || true); if [ -n \"\$prev\" ]; then printf '%s\n' \"\$prev\" > $REMOTE_DIR/.image-tag.prev; else rm -f $REMOTE_DIR/.image-tag.prev; fi"

running=$("${SSH[@]}" "docker ps -a --format '{{.Names}}' | grep -qx '$CONTAINER' && echo yes || echo no" 2>/dev/null || echo no)
if [ "$running" = yes ]; then
  echo "▶ $CONTAINER 在跑 → rm -f 重建"
  "${SSH[@]}" "docker rm -f $CONTAINER" >/dev/null 2>&1 || true
else
  echo "▶ $CONTAINER 不存在 → 新建"
fi

echo "▶ docker compose up -d"
"${SSH[@]}" "cd $REMOTE_DIR && docker compose up -d"

echo "▶ 验证 http://localhost:$API_PORT/api/status（重试 8×3s）"
"${SSH[@]}" "for i in 1 2 3 4 5 6 7 8; do curl -fsS http://localhost:$API_PORT/api/status >/dev/null && exit 0; sleep 3; done; exit 1" \
  || { echo "  ✗ 验证失败，日志：" >&2; "${SSH[@]}" "docker logs --tail 30 $CONTAINER" >&2 || true; exit 1; }
echo "  ✓ /api/status 200"

echo ""
"${SSH[@]}" "cd $REMOTE_DIR && docker compose ps"
"${SSH[@]}" "docker image prune -f" >/dev/null 2>&1 || true
RUNNING_TAG="$(resolve_image_tag)"
SOURCE_COMMIT="$(cat "$SKILL_DIR/.build/source-commit" 2>/dev/null || echo unknown)"
echo ""
echo "▶ 运行 image：$RUNNING_TAG ｜ source：${SOURCE_COMMIT:0:12}"
echo "⚠️  外部访问需云安全组放行 TCP $API_PORT"
echo "✓ restart 完成 → 宿主内 http://localhost:$API_PORT ｜ 外部 http://$DEPLOY_HOST:${API_PORT}（放行后）"
echo "回滚：bash scripts/rollback.sh（用远端 .image-tag.prev 的 tag 重建，--no-build 复用存活镜像）"
