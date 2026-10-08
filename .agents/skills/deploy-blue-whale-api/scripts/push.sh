#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ensure_key

BIN="$SKILL_DIR/.build/$BIN_NAME"
[ -f "$BIN" ] || { echo "✗ 二进制不存在，先跑 build.sh" >&2; exit 1; }

IMAGE_TAG="$(resolve_image_tag)"
IMAGE_SHORT="${IMAGE_TAG#blue-whale-api:}"
echo "▶ push image tag：$IMAGE_TAG"

"${SSH[@]}" "mkdir -p $REMOTE_DIR"

echo "▶ scp 二进制（$(du -h "$BIN" | cut -f1)）"
"${SCP[@]}" "$BIN" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/$BIN_NAME"

echo "▶ scp Dockerfile + compose"
"${SCP[@]}" "$SKILL_DIR/docker/Dockerfile" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/Dockerfile"
"${SCP[@]}" "$SKILL_DIR/docker/docker-compose.yml" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR/docker-compose.yml"

echo "▶ 远程生成 .env（SESSION_SECRET = openssl rand 远程生成）"
"${SSH[@]}" "SECRET=\$(openssl rand -hex 32) && cat > $REMOTE_DIR/.env <<EOF
SQL_DSN=$MYSQL_DSN
REDIS_CONN_STRING=$REDIS_DSN
SESSION_SECRET=\$SECRET
TZ=Asia/Shanghai
NEW_API_IMAGE_TAG=$IMAGE_SHORT
EOF
chmod 600 $REMOTE_DIR/.env && echo '  → .env 写入 + chmod 600'"

echo "✓ push 完成"
