#!/usr/bin/env bash
# Blue-Whale 本地 MVP 全栈薄入口（IK1NRX）
#
# 转发到 deploy/local/docker-compose.yml 与辅助脚本，对开发者暴露单一命令面：
#   up / down / health / init / ps / logs / build
#
# 用法：
#   scripts/local-mvp.sh up           构建并后台拉起全部 8 个服务
#   scripts/local-mvp.sh down         停止并清理容器（保留数据卷）
#   scripts/local-mvp.sh health       8 服务健康检查，缺失报具体服务名
#   scripts/local-mvp.sh init         重置：down -v 清库后 up（重新跑 SQL 初始化）
#   scripts/local-mvp.sh ps           列出服务状态
#   scripts/local-mvp.sh logs [svc]   跟随日志；svc 可选
#   scripts/local-mvp.sh build        仅构建镜像，不启动

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT/deploy/local"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/.env"
ENV_EXAMPLE="$DEPLOY_DIR/.env.example"

# IK1W1E 构建身份：构建期注入当前 checkout 的 commit 与时间，供镜像 LABEL / 启动日志核对。
# git 不可用或非 git 目录时回退 unknown，不阻断启动。
export GIT_COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

fail() {
  echo "❌ local-mvp: $*" >&2
  exit 1
}

# Compose 子命令统一通过此函数，注入 --env-file 与 -f
dc() {
  if [ -f "$ENV_FILE" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    return
  fi
  docker compose -f "$COMPOSE_FILE" "$@"
}

usage() {
  cat <<'EOF'
Blue-Whale 本地 MVP（IK1NRX）—— 用法：

  scripts/local-mvp.sh up           构建并后台拉起全部服务
  scripts/local-mvp.sh down         停止并清理容器（保留数据卷）
  scripts/local-mvp.sh health       健康检查（缺哪个服务报哪个）
  scripts/local-mvp.sh init         重置：down -v 清库后 up
  scripts/local-mvp.sh ps           列出服务状态
  scripts/local-mvp.sh logs [svc]   跟随日志（svc 省略看全部）
  scripts/local-mvp.sh build        仅构建镜像

首次运行前先：cp deploy/local/.env.example deploy/local/.env
EOF
}

require_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  未找到 ${ENV_FILE}，使用 .env.example 的默认值继续。" >&2
    echo "   如需自定义端口或密码：cp $ENV_EXAMPLE $ENV_FILE" >&2
  fi
}

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "未找到 docker 命令"
  docker compose version >/dev/null 2>&1 || fail "docker compose v2 不可用"
}

case "${1:-}" in
  up)
    require_docker
    require_env
    echo "🚀 构建并拉起 Blue-Whale 本地 MVP（首次构建约 5–10 分钟）..."
    dc up -d --build
    echo
    echo "等待服务就绪（运行 health 复核）：scripts/local-mvp.sh health"
    ;;
  down)
    require_docker
    echo "🛑 停止并清理容器（数据卷保留）..."
    dc down
    ;;
  init)
    require_docker
    require_env
    echo "♻️  完全重置：down -v 清库后 up（重新执行 SQL 初始化）..."
    dc down -v
    dc up -d --build
    echo
    echo "等待服务就绪（运行 health 复核）：scripts/local-mvp.sh health"
    ;;
  health)
    require_docker
    # healthcheck.sh 通过 docker inspect 读容器 Health 状态，无需外部 env
    bash "$DEPLOY_DIR/scripts/healthcheck.sh"
    ;;
  ps)
    require_docker
    dc ps
    ;;
  logs)
    require_docker
    shift || true
    dc logs -f "${1:-}"
    ;;
  build)
    require_docker
    require_env
    echo "🔨 仅构建镜像..."
    dc build
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    fail "未知命令：$1（运行 scripts/local-mvp.sh help 查看用法）"
    ;;
esac
