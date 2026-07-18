#!/usr/bin/env bash
# Blue-Whale MVP 全栈验收单一命令（IK1NS2）
#
# 从干净环境启动隔离的完整 Docker Compose（Web/Gateway/User/Agent/Worker/MySQL/Redis/Nacos，
# Fake 编排 + Fake 图片生成 + 测试 ContentReview），等待全部服务健康后执行全栈 Playwright，
# 成功或失败都 down -v 清理本轮创建的容器、网络、卷与合成测试数据。
#
# 隔离：独立项目名 bw-mvp-acceptance + bw-acc-* 容器名 + :acceptance 镜像 tag + 专用端口
# （web 3100 / gateway 8786），与开发者 blue-whale-local 栈互不影响，可并发共存。
#
# 用法：
#   scripts/run-mvp-acceptance.sh              完整验收（先预清本项目资源，结束清理）
#   scripts/run-mvp-acceptance.sh --keep-stack 调试模式：结束后保留栈与数据
#
# 失败取证：Playwright trace/截图在 blue_whale_web/test-results/fullstack/；
# 脱敏后的服务日志在 blue_whale_web/test-results/fullstack/service-logs/
# （不含凭据、Token 或原始敏感内容）。
# 退出码如实反映验收成功（0）或失败（非 0）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT/blue_whale_web"
COMPOSE_BASE="$ROOT/deploy/local/docker-compose.yml"
COMPOSE_OVERRIDE="$ROOT/deploy/local/docker-compose.acceptance.yml"
PROJECT="bw-mvp-acceptance"
WEB_PORT=3100
LOG_DIR="$WEB_DIR/test-results/fullstack/service-logs"
SANITIZER="$ROOT/scripts/lib/sanitize_acceptance_logs.py"
KEEP_STACK=0

# 等待健康的服务（docker 健康检查）与仅要求 running 的服务
HEALTHY_CONTAINERS="bw-acc-mysql bw-acc-redis bw-acc-nacos bw-acc-gateway bw-acc-user bw-acc-agent bw-acc-web"
RUNNING_CONTAINERS="bw-acc-agent-worker"
ALL_SERVICES="mysql redis nacos blue-whale-gateway blue-whale-user blue-whale-agent blue-whale-agent-worker blue-whale-web"
WAIT_DEADLINE_S=720
WAIT_INTERVAL_S=5

fail() {
  echo "❌ mvp-acceptance: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Blue-Whale MVP 全栈验收（IK1NS2）—— 用法：

  scripts/run-mvp-acceptance.sh               完整验收（结束后清理本轮全部资源）
  scripts/run-mvp-acceptance.sh --keep-stack  调试模式：结束后保留栈与数据

产物：blue_whale_web/test-results/fullstack/（trace/截图；失败时另有 service-logs/ 脱敏日志）
EOF
}

dc() {
  docker compose -p "$PROJECT" -f "$COMPOSE_BASE" -f "$COMPOSE_OVERRIDE" "$@"
}

collect_logs() {
  echo "🧾 采集脱敏服务日志 → $LOG_DIR"
  mkdir -p "$LOG_DIR"
  for svc in $ALL_SERVICES; do
    dc logs --no-color --tail=500 "$svc" 2>&1 | python3 "$SANITIZER" > "$LOG_DIR/$svc.log" || true
  done
}

cleanup() {
  if [ "$KEEP_STACK" = "1" ]; then
    echo "⚠️  --keep-stack：保留 $PROJECT 栈与数据（手动清理：docker compose -p $PROJECT -f $COMPOSE_BASE -f $COMPOSE_OVERRIDE down -v）"
    return
  fi
  echo "🧹 清理本轮 Compose 资源（down -v --remove-orphans）..."
  dc down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

container_state() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo "missing"
}

wait_healthy() {
  echo "⏳ 等待全部服务健康（MySQL 首次初始化可能需 3–5 分钟）..."
  local elapsed=0
  while [ "$elapsed" -lt "$WAIT_DEADLINE_S" ]; do
    local pending=""
    local failed=""
    for c in $HEALTHY_CONTAINERS; do
      case "$(container_state "$c")" in
        healthy) ;;
        exited|dead) failed="$failed $c" ;;
        *) pending="$pending $c" ;;
      esac
    done
    for c in $RUNNING_CONTAINERS; do
      case "$(container_state "$c")" in
        running) ;;
        exited|dead) failed="$failed $c" ;;
        *) pending="$pending $c" ;;
      esac
    done
    if [ -n "$failed" ]; then
      echo "❌ 容器异常退出:$failed" >&2
      collect_logs
      fail "服务启动失败（日志已落盘）"
    fi
    if [ -z "$pending" ]; then
      echo "✅ 全部服务就绪（耗时 ${elapsed}s）"
      return 0
    fi
    sleep "$WAIT_INTERVAL_S"
    elapsed=$((elapsed + WAIT_INTERVAL_S))
  done
  echo "❌ 等待健康超时（${WAIT_DEADLINE_S}s）" >&2
  collect_logs
  fail "服务未在时限内就绪（日志已落盘）"
}

for arg in "$@"; do
  case "$arg" in
    --keep-stack) KEEP_STACK=1 ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage; fail "未知参数：$arg" ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail "未找到 docker 命令"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 不可用"
docker info >/dev/null 2>&1 || fail "Docker daemon 未运行"

# Web 侧依赖（Playwright + chromium）：缺失时安装，已安装则秒过
if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "📦 安装 blue_whale_web 依赖（首次）..."
  (cd "$WEB_DIR" && npm install)
fi
(cd "$WEB_DIR" && npx playwright install chromium >/dev/null 2>&1) || true

# 预清：保证重放干净——相同命令重复执行不累积副作用（只清本项目资源）
echo "🧹 预清 $PROJECT 历史资源..."
dc down -v --remove-orphans >/dev/null 2>&1 || true

echo "🚀 启动隔离验收栈（项目 ${PROJECT}，首次构建约 5–10 分钟）..."
dc up -d --build

wait_healthy

echo "🎭 执行全栈 Playwright 验收..."
set +e
(
  cd "$WEB_DIR" && \
  BW_ACCEPTANCE_BASE_URL="http://localhost:$WEB_PORT" \
    npx playwright test --config playwright.fullstack.config.ts
)
PW_EXIT=$?
set -e

if [ "$PW_EXIT" -ne 0 ]; then
  collect_logs
  echo "❌ 验收失败（退出码 ${PW_EXIT}）。诊断证据："
  echo "   - Playwright trace/截图：$WEB_DIR/test-results/fullstack/"
  echo "   - 脱敏服务日志：$LOG_DIR/"
  exit "$PW_EXIT"
fi

echo "✅ 全栈验收通过"
