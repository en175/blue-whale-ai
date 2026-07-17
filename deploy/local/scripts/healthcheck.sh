#!/bin/bash
# 本地 MVP 健康检查：以 docker compose 的容器 Health 状态为权威。
# 缺哪个服务报哪个，缺失时 exit 1。
#
# 用法：./deploy/local/scripts/healthcheck.sh
# 或：  scripts/local-mvp.sh health

set -u

GREEN=$'\033[32m'
RED=$'\033[31m'
RESET=$'\033[0m'

# 8 个必需服务（容器名 → 人类可读名）
declare -a SERVICES=(
  "bw-web|Web(Next)"
  "bw-gateway|Gateway"
  "bw-user|User Service"
  "bw-agent|Agent Service"
  "bw-mysql|MySQL"
  "bw-redis|Redis"
  "bw-nacos|Nacos"
  "bw-agent-worker|Agent Worker"
)

# 取容器健康状态：healthy / unhealthy / starting / no-healthcheck / not-found
# 注意：未配置 healthcheck 的容器（如 worker）其 .State.Health 为 nil，
# 此时 '{{.State.Health.Status}}' Go 模板会输出 "<no value>" 且 exit 0，
# 不会触发 || 分支；必须显式探测 .State.Health 是否存在。
container_health() {
  local out
  out=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$1" 2>/dev/null) || echo "not-found"
  echo "$out"
}

failures=0

echo "Blue-Whale 本地 MVP 健康检查"
echo "============================"

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r cname label <<< "$entry"
  health=$(container_health "$cname")
  case "$health" in
    healthy)
      printf "  %s✓%s %-14s — healthy\n" "$GREEN" "$RESET" "$label"
      ;;
    starting)
      printf "  %s⏳%s %-14s — 启动中，稍后再查\n" "$RED" "$RESET" "$label"
      failures=$((failures+1))
      ;;
    unhealthy)
      printf "  %s✗%s %-14s — unhealthy（查 logs: docker logs %s）\n" "$RED" "$RESET" "$label" "$cname"
      failures=$((failures+1))
      ;;
    no-healthcheck)
      # 无 healthcheck 的容器（如 worker）改看运行状态
      state=$(docker inspect --format '{{.State.Status}}' "$cname" 2>/dev/null || echo "not-found")
      if [ "$state" = "running" ]; then
        printf "  %s✓%s %-14s — running（无 healthcheck）\n" "$GREEN" "$RESET" "$label"
      else
        printf "  %s✗%s %-14s — %s\n" "$RED" "$RESET" "$label" "$state"
        failures=$((failures+1))
      fi
      ;;
    not-found)
      printf "  %s✗%s %-14s — 容器不存在（未启动？）\n" "$RED" "$RESET" "$label"
      failures=$((failures+1))
      ;;
    *)
      printf "  %s?%s %-14s — %s\n" "$RED" "$RESET" "$label" "$health"
      failures=$((failures+1))
      ;;
  esac
done

echo "============================"
if [ "$failures" -eq 0 ]; then
  printf "%s全部 8 个服务就绪%s\n" "$GREEN" "$RESET"
  exit 0
else
  printf "%s有 %d 个服务未就绪%s（见上方 ✗ / ⏳ 行）\n" "$RED" "$failures" "$RESET"
  exit 1
fi
