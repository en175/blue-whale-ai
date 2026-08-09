#!/usr/bin/env bash
#
# 目标环境退役门禁（工单 T18 验收配套）
#
# tests/typescript-baseline/no-java-runtime.test.mjs 的运行环境对应物：
# 只查本机运行态（进程 / docker 镜像 / docker 容器 / 端口监听 / 环境变量 /
# PATH 可执行引用），不扫源码。逐项输出脱敏 PASS/FAIL/SKIP 清单。
# 任一项 FAIL 则退出码 1；存在 SKIP 则无法证明零残留，退出码 2（INCONCLUSIVE）。
#
# 可测试性设计：ps / docker / lsof 均以裸命令名调用（不写绝对路径），
# 测试通过 PATH 前置 stub 目录注入伪造输出
# （见 scripts/tests/test_check_target_environment_retirement.py）。
#
set -euo pipefail

SCRIPT_NAME=$(basename -- "$0")
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=${BW_RETIREMENT_ENV_FILE:-"$ROOT/.env"}

# ---------------------------------------------------------------------------
# 旧栈判定特征
# ---------------------------------------------------------------------------

# 旧产品进程特征（对齐工单退役范围与 no-java-runtime.test.mjs 的 forbidden 符号）：
# - java 命令行含 blue_whale_server（旧 blue-whale-*.jar 均位于该树内）
# - python/python3 命令行含 blue_whale_agent_worker
# - node 命令行含 apps/product-api
# - 旧服务名 blue-whale-gateway / blue-whale-user / blue-whale-agent / blue-whale-product
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

# 旧 docker 镜像/容器特征（大小写不敏感子串，同一清单同时过滤镜像行与容器行）。
# 来源 git show 8ac52b7d^:deploy/local/docker-compose.yml（退役提交 8ac52b7d 的前一版本）：
#   镜像：blue-whale-gateway:local / blue-whale-user:local / blue-whale-agent:local /
#         blue-whale-agent-worker:local / nacos/nacos-server:v2.4.3（Java 栈注册中心）
#   容器：bw-gateway / bw-user / bw-agent / bw-agent-worker / bw-schema-migration / bw-nacos
# 另含工单点名的 blue_whale_server / blue-whale-server / blue_whale_agent_worker /
# product-api / blue-whale-product。
# 不误伤现行镜像 blue-whale-typescript-baseline（上述子串均不命中）。
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

# 旧端口清单，权威来源 git show 8ac52b7d^:deploy/local/docker-compose.yml 宿主端口默认值：
#   8686 blue-whale-gateway (GATEWAY_PUBLISH_PORT)
#   8081 blue-whale-user    (USER_PUBLISH_PORT)
#   8082 blue-whale-agent   (AGENT_PUBLISH_PORT)
#   8848 nacos              (NACOS_PUBLISH_PORT)
#   9848/9849 nacos gRPC    (固定映射)
# docs/specs/2026-08-03-java-physical-retirement-plan.md 与
# docs/wayfinder/IK3UWN-prelaunch-typescript-unification-plan.md §7 最小退役清单
# 均未列端口，故按规程从退役前 compose 提取。
# 明确排除（现行在用端口，不视为旧端口）：3000 3001 3101 3306 6379 4001 4002 4330 4311 4312
# —— 3000/3306/6379 虽出现在旧 compose，现行 TS 基线继续使用。
RETIRED_PORTS=(8686 8081 8082 8848 9848 9849)

# 旧环境变量：对齐 no-java-runtime.test.mjs:52-74 的 8 个 forbidden 符号，
# 其中可作为环境变量的仅 GATEWAY_URL（其余为 URL / 路径符号）。
# 输出只打变量名，绝不打值。
OLD_ENV_VARS=(GATEWAY_URL)

# 已退役目录路径片段（PATH 可执行引用检查）
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

# a) 旧产品进程
check_processes() {
  local name="旧产品进程"
  local ps_output hits
  if ! ps_output=$(ps -ax -o pid=,comm=,args= 2>/dev/null); then
    report_skip "$name" "ps 不可用"
    return
  fi
  # 排除：脚本自身命令行、grep/sed/awk 过滤进程自身
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

# b) 旧 docker 镜像
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

# c) 旧 docker 容器
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

# d) 旧端口监听
check_ports() {
  local name="旧端口监听"
  if ! command -v lsof >/dev/null 2>&1; then
    report_skip "$name" "lsof 不可用"
    return
  fi
  local listing hits
  # lsof 无匹配时退出码为 1，属正常空结果
  listing=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null || true)
  hits=$(printf '%s\n' "$listing" | grep -E "$PORT_PATTERN" || true)
  if [ -n "$hits" ]; then
    report_fail "$name" "$hits"
  else
    report_pass "$name"
  fi
}

# e) 旧环境变量（只输出变量名，绝不输出值）
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

# f) 旧可执行 fallback 引用：PATH 目录本身指向已退役目录，
#    或 PATH 目录内存在指向已退役目录的软链
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
