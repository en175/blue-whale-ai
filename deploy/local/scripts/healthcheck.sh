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

# IK1W1E：Schema 迁移容器是一次性任务（跑完 exit），单独检查其退出码。
# exit 0 = 迁移成功完成；非 0 = 迁移失败（fail-closed，user/agent 不会启动）。
printf -- "---------------- migration ----------------\n"
mig_state=$(docker inspect --format '{{.State.Status}}' "bw-schema-migration" 2>/dev/null || echo "not-found")
if [ "$mig_state" = "not-found" ]; then
  printf "  %s?%s %-14s — 容器不存在（旧栈？迁移器 IK1W1E 后引入）\n" "$RED" "$RESET" "Schema Migration"
elif [ "$mig_state" = "exited" ]; then
  mig_code=$(docker inspect --format '{{.State.ExitCode}}' "bw-schema-migration" 2>/dev/null || echo "-1")
  if [ "$mig_code" = "0" ]; then
    printf "  %s✓%s %-14s — 迁移已完成（exit 0）\n" "$GREEN" "$RESET" "Schema Migration"
  else
    printf "  %s✗%s %-14s — 迁移失败（exit %s，查 logs: docker logs bw-schema-migration）\n" "$RED" "$RESET" "Schema Migration" "$mig_code"
    failures=$((failures+1))
  fi
else
  printf "  %s⏳%s %-14s — %s（迁移进行中？）\n" "$RED" "$RESET" "Schema Migration" "$mig_state"
  failures=$((failures+1))
fi

echo "============================"
if [ "$failures" -eq 0 ]; then
  printf "%s全部服务就绪%s\n" "$GREEN" "$RESET"
  exit 0
else
  printf "%s有 %d 个服务未就绪%s（见上方 ✗ / ⏳ 行）\n" "$RED" "$failures" "$RESET"
  exit 1
fi
