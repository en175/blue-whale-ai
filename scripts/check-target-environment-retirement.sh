#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME=$(basename -- "$0")
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=${BW_RETIREMENT_ENV_FILE:-"$ROOT/.env"}


PROCESS_PATTERNS=(
  'blue_whale_server'
  'blue_whale_agent_worker'
  'apps/product-api'
  'blue-whale-server'
  'blue-whale-agent-worker'
  'blue-whale-gateway'
  'blue-whale-user'
  'blue-whale-agent'
  'blue-whale-product'
)

STACK_PATTERNS=(
  'blue_whale_server'
  'blue-whale-server'
  'blue_whale_agent_worker'
  'blue-whale-agent-worker'
  'blue-whale-gateway'
  'blue-whale-user'
  'blue-whale-agent'
  'blue-whale-product'
  'product-api'
  'nacos'
  'bw-gateway'
  'bw-user'
  'bw-agent'
  'bw-schema-migration'
  'bw-nacos'
)

RETIRED_PORTS=(8686 8081 8082 8848 9848 9849)

OLD_ENV_VARS=(GATEWAY_URL)

RETIRED_PATH_FRAGMENTS=('blue_whale_server' 'blue_whale_agent_worker' 'apps/product-api')

join_pattern() {
  local IFS='|'
  printf '%s' "$*"
}

PROCESS_PATTERN=$(join_pattern "${PROCESS_PATTERNS[@]}")
STACK_PATTERN=$(join_pattern "${STACK_PATTERNS[@]}")
PORT_PATTERN=":($(join_pattern "${RETIRED_PORTS[@]}"))([^0-9]|\$)"

pass_count=0
fail_count=0
skip_count=0

report_pass() {
  pass_count=$((pass_count + 1))
  printf 'PASS %s: 无残留\n' "$1"
}

report_skip() {
  skip_count=$((skip_count + 1))
  printf 'SKIP %s: %s\n' "$1" "$2"
}

report_fail() {
  local name="$1" details="$2"
  local count
  count=$(printf '%s\n' "$details" | grep -c . || true)
  fail_count=$((fail_count + 1))
  printf 'FAIL %s: 发现 %s 项\n' "$name" "$count"
  printf '%s\n' "$details" | grep . | sed 's/^/  /'
}

check_processes() {
  local name="旧产品进程"
  local ps_output hits
  if ! ps_output=$(ps -ax -o pid=,comm=,args= 2>/dev/null); then
    report_skip "$name" "ps 不可用"
    return
  fi
  hits=$(printf '%s\n' "$ps_output" \
    | grep -Ei "$PROCESS_PATTERN" \
    | grep -vF "$SCRIPT_NAME" \
    | grep -Ev '^[[:space:]]*[0-9]+[[:space:]]+(grep|sed|awk)([[:space:]]|$)' \
    || true)
  if [ -n "$hits" ]; then
    report_fail "$name" "$hits"
  else
    report_pass "$name"
  fi
}

check_docker_images() {
  local name="旧docker镜像"
  if ! command -v docker >/dev/null 2>&1; then
    report_skip "$name" "docker 命令不可用"
    return
  fi
  local listing hits
  if ! listing=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null); then
    report_skip "$name" "docker daemon 不可用"
    return
  fi
  hits=$(printf '%s\n' "$listing" | grep -Ei "$STACK_PATTERN" || true)
  if [ -n "$hits" ]; then
    report_fail "$name" "$hits"
  else
    report_pass "$name"
  fi
}

check_docker_containers() {
  local name="旧docker容器"
  if ! command -v docker >/dev/null 2>&1; then
    report_skip "$name" "docker 命令不可用"
    return
  fi
  local listing hits
  if ! listing=$(docker ps -a --format '{{.Names}} {{.Image}}' 2>/dev/null); then
    report_skip "$name" "docker daemon 不可用"
    return
  fi
  hits=$(printf '%s\n' "$listing" | grep -Ei "$STACK_PATTERN" || true)
  if [ -n "$hits" ]; then
    report_fail "$name" "$hits"
  else
    report_pass "$name"
  fi
}

check_ports() {
  local name="旧端口监听"
  if ! command -v lsof >/dev/null 2>&1; then
    report_skip "$name" "lsof 不可用"
    return
  fi
  local listing hits
  listing=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null || true)
  hits=$(printf '%s\n' "$listing" | grep -E "$PORT_PATTERN" || true)
  if [ -n "$hits" ]; then
    report_fail "$name" "$hits"
  else
    report_pass "$name"
  fi
}

check_env_vars() {
  local name="旧环境变量"
  local hits="" var
  for var in "${OLD_ENV_VARS[@]}"; do
    if [ -n "${!var+x}" ]; then
      hits+="${var}"$'\n'
    fi
    if [ -f "$ENV_FILE" ] && grep -Eq "^[[:space:]]*${var}[[:space:]]*=" "$ENV_FILE"; then
      hits+="${var}"$'\n'
    fi
  done
  if [ -n "$hits" ]; then
    report_fail "$name" "$hits"
  else
    report_pass "$name"
  fi
}

check_path_refs() {
  local name="旧可执行引用"
  local hits="" entry frag link target
  local -a entries=()
  IFS=':' read -r -a entries <<< "${PATH:-}"
  for entry in "${entries[@]}"; do
    [ -n "$entry" ] || continue
    for frag in "${RETIRED_PATH_FRAGMENTS[@]}"; do
      case "$entry" in
        *"$frag"*)
          hits+="PATH 目录 ${entry}"$'\n'
          break
          ;;
      esac
    done
    [ -d "$entry" ] || continue
    for link in "$entry"/*; do
      [ -L "$link" ] || continue
      target=$(readlink "$link") || continue
      for frag in "${RETIRED_PATH_FRAGMENTS[@]}"; do
        case "$target" in
          *"$frag"*)
            hits+="${link} -> ${target}"$'\n'
            break
            ;;
        esac
      done
    done
  done
  if [ -n "$hits" ]; then
    report_fail "$name" "$hits"
  else
    report_pass "$name"
  fi
}

main() {
  check_processes
  check_docker_images
  check_docker_containers
  check_ports
  check_env_vars
  check_path_refs
  if [ "$fail_count" -gt 0 ]; then
    printf '目标环境退役门禁: FAIL (PASS %d, FAIL %d, SKIP %d)\n' \
      "$pass_count" "$fail_count" "$skip_count"
    exit 1
  fi
  if [ "$skip_count" -gt 0 ]; then
    printf '目标环境退役门禁: INCONCLUSIVE (PASS %d, FAIL %d, SKIP %d)\n' \
      "$pass_count" "$fail_count" "$skip_count"
    exit 2
  fi
  printf '目标环境退役门禁: PASS (PASS %d, FAIL %d, SKIP %d)\n' \
    "$pass_count" "$fail_count" "$skip_count"
  exit 0
}

main "$@"
