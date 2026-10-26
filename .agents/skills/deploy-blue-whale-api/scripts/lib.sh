#!/usr/bin/env bash

DEPLOY_KEY="${DEPLOY_KEY:-/Users/apple/Downloads/weitian.pem}"
DEPLOY_HOST="${DEPLOY_HOST:-115.190.244.91}"
DEPLOY_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/blue-whale-api}"
API_PORT="${API_PORT:-3001}"
CONTAINER="blue-whale-api"
BIN_NAME="new-api"

MYSQL_DSN="${MYSQL_DSN:-root:b3f9b3c44dda7225a88c90903df84c5818d964ce23c56be5@tcp($DEPLOY_HOST:3306)/new-api?parseTime=true}"
REDIS_DSN="${REDIS_DSN:-redis://:9b119316892237613fa8dddfa3d2b5cc8274bac99edbbb45@$DEPLOY_HOST:6379/1}"

MIRRORS=(docker.m.daocloud.io docker.1ms.run dockerproxy.cn dockerhub.icu)
ALPINE_PAK_MIRROR="${ALPINE_PAK_MIRROR:-mirrors.aliyun.com}"

BUN="${BUN:-$HOME/bun-install/node_modules/.bin/bun}"

resolve_image_tag() {
  local lib_dir skill_dir tag_file
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  skill_dir="$(cd "$lib_dir/.." && pwd)"
  tag_file="$skill_dir/.build/image-tag"
  if [ -f "$tag_file" ]; then
    cat "$tag_file"
  else
    echo "blue-whale-api:latest"
  fi
}

ensure_key() {
  [ -f "$DEPLOY_KEY" ] || { echo "密钥不存在: $DEPLOY_KEY" >&2; exit 1; }
  chmod 600 "$DEPLOY_KEY" 2>/dev/null || true
}

SSH_OPTS=(-i "$DEPLOY_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
SSH=(ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST")
SCP=(scp -q "${SSH_OPTS[@]}")
