#!/usr/bin/env bash
# 部署公共配置。source 自 build/push/remote-build/restart/deploy。
# 环境变量覆盖：DEPLOY_KEY / DEPLOY_HOST / DEPLOY_USER / REMOTE_DIR

DEPLOY_KEY="${DEPLOY_KEY:-/Users/apple/Downloads/weitian.pem}"
DEPLOY_HOST="${DEPLOY_HOST:-115.190.244.91}"
DEPLOY_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/blue-whale}"

# 服务白名单（本流程仅后端 3 服务）
check_svc() {
  case "$1" in
    gateway|user|agent) ;;
    *) echo "未知服务: $1（可选: gateway|user|agent）" >&2; exit 1 ;;
  esac
}

# 找某服务的 fat jar 路径。$1=svc $2=repo_root。输出路径或空。
find_jar() {
  local svc="$1" root="$2" d
  case "$svc" in
    gateway) d="$root/blue_whale_server/blue-whale-gateway/target" ;;
    user)    d="$root/blue_whale_server/blue-whale-user/blue-whale-user-service/target" ;;
    agent)   d="$root/blue_whale_server/blue-whale-agent/blue-whale-agent-service/target" ;;
    *) return 1 ;;
  esac
  ls "$d"/blue-whale-*.jar 2>/dev/null | grep -vE 'sources|javadoc|plain|original' | head -1
}

ensure_key() {
  [ -f "$DEPLOY_KEY" ] || { echo "密钥不存在: $DEPLOY_KEY" >&2; exit 1; }
  chmod 600 "$DEPLOY_KEY" 2>/dev/null || true
}

SSH_OPTS=(-i "$DEPLOY_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
SSH=(ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST")
SCP=(scp -q "${SSH_OPTS[@]}")
