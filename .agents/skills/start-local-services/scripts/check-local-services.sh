#!/usr/bin/env bash
set -uo pipefail

status=0
media=0
backend_pid=""
mq_args=()
while (( $# )); do
  case "$1" in
    --media) media=1; shift ;;
    --timeout-ms|--mq-ssh|--mq-forward) media=1; mq_args+=("$1" "${2:-}"); shift; (( $# )) && shift ;;
    *) echo "用法：check-local-services.sh [--media] [--timeout-ms 20000] [--mq-ssh SSH别名 --mq-forward 本地地址=远端地址]" >&2; exit 2 ;;
  esac
done

env_of() {
  ps eww "$1" 2>/dev/null | tr ' ' '\n' | sed -n "s/^$2=//p" | head -1
}

db_host_of() {
  printf '%s' "$1" | sed -n 's|^mysql://[^@]*@\([^/]*\)/.*|\1|p'
}

judge_db() {
  if [[ -z "$1" ]]; then
    echo "  DATABASE_URL: 未设置"
  elif [[ "$1" == 127.0.0.1* || "$1" == localhost* ]]; then
    echo "  DATABASE_URL → 本地库 ($1)   ⚠️ 本地库没有团队账号，登录会报「账号密码错误」；要用测试站账号走形态 B"
  else
    echo "  DATABASE_URL → 远程库 ($1)"
  fi
}

judge_gateway() {
  if [[ -z "$1" ]]; then
    echo "  NEW_API_BASE_URL: 未设置"
  elif [[ "$1" == *127.0.0.1* || "$1" == *localhost* ]]; then
    echo "  NEW_API_BASE_URL → 本地网关 ($1)   ⚠️ 本地网关账户库没有团队账号，登录会失败"
  else
    echo "  NEW_API_BASE_URL → 远程网关 ($1)"
  fi
}

probe_port() {
  local pid code
  pid=$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [[ -z "$pid" ]]; then
    echo "[$2 :$1] 未监听"
    status=1
    return
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$1/api/health" 2>/dev/null)
  if [[ "$code" == "000" ]]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$1/" 2>/dev/null)
  fi
  [[ "$code" == "200" ]] || status=1
  echo "[$2 :$1] pid=$pid 探活=$code"
  echo "  代码目录: $(lsof -p "$pid" 2>/dev/null | awk '/cwd/{print $NF}')"
  if [[ "$2" == "backend" ]]; then
    backend_pid="$pid"
    judge_db "$(db_host_of "$(env_of "$pid" DATABASE_URL)")"
    judge_gateway "$(env_of "$pid" NEW_API_BASE_URL)"
  fi
}

probe_port 3000 web
probe_port 3100 backend

if node -e 'const r = require("node:child_process").spawnSync("redis-cli", ["-h", "127.0.0.1", "-p", "6379", "ping"], { encoding: "utf8", timeout: 3000 }); process.exit(r.status === 0 && r.stdout.trim() === "PONG" ? 0 : 1)' 2>/dev/null; then
  echo "[redis :6379] PONG"
else
  status=1
  echo "[redis :6379] 不可达   ⚠️ 后端会话接口会全 503（「会话服务不可用」）；修法：docker start blue-whale-dev-redis"
fi

if (( media )); then
  if [[ -n "$backend_pid" ]]; then
    node "$(cd "$(dirname "$0")" && pwd)/check-mq.mjs" --backend-pid "$backend_pid" ${mq_args[@]+"${mq_args[@]}"} || status=1
  else
    echo "[MQ 配置] FAIL 后端未监听；先启动后端再执行 --media。"
    status=1
  fi
fi
if (( status == 0 )); then
  if (( media )); then
    echo "[就绪] 页面基础检查与 MQ 连接通过；真实任务验收尚未执行。"
  else
    echo "[就绪] 页面基础检查通过；MQ 未检查，媒体测试前执行 --media。"
  fi
fi
exit "$status"
