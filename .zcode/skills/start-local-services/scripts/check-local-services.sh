#!/usr/bin/env bash
# 只读体检本地开发服务：3000/3100 端口背后跑的是什么。
# 输出 PID、代码所在目录、后端 DATABASE_URL / NEW_API_BASE_URL 指向（只显示主机与判定，不回显凭据）、Redis 与探活。
# 用法：bash .claude/skills/start-local-services/scripts/check-local-services.sh
# 用途：接管既有服务前核对配置（端口活着 != 配置正确，本地库后端没有团队账号，登录会报「账号密码错误」）。
set -uo pipefail

# 从进程环境提取变量值（macOS ps eww 空格分隔 KEY=VALUE）
env_of() { # $1=pid $2=变量名
  ps eww "$1" 2>/dev/null | tr ' ' '\n' | sed -n "s/^$2=//p" | head -1
}

# 只取 mysql://...@host:port/db 的 host:port 部分，不回显用户名密码
db_host_of() { # $1=连接串
  printf '%s' "$1" | sed -n 's|^mysql://[^@]*@\([^/]*\)/.*|\1|p'
}

judge_db() { # $1=host:port
  if [[ -z "$1" ]]; then
    echo "  DATABASE_URL: 未设置"
  elif [[ "$1" == 127.0.0.1* || "$1" == localhost* ]]; then
    echo "  DATABASE_URL → 本地库 ($1)   ⚠️ 本地库没有团队账号，登录会报「账号密码错误」；要用测试站账号走形态 B"
  else
    echo "  DATABASE_URL → 远程库 ($1)"
  fi
}

judge_gateway() { # $1=url
  if [[ -z "$1" ]]; then
    echo "  NEW_API_BASE_URL: 未设置"
  elif [[ "$1" == *127.0.0.1* || "$1" == *localhost* ]]; then
    echo "  NEW_API_BASE_URL → 本地网关 ($1)   ⚠️ 本地网关账户库没有团队账号，登录会失败"
  else
    echo "  NEW_API_BASE_URL → 远程网关 ($1)"
  fi
}

probe_port() { # $1=端口 $2=名称
  local pid code
  pid=$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [[ -z "$pid" ]]; then
    echo "[$2 :$1] 未监听"
    return
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$1/api/health" 2>/dev/null)
  if [[ "$code" == "000" ]]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$1/" 2>/dev/null)
  fi
  echo "[$2 :$1] pid=$pid 探活=$code"
  echo "  代码目录: $(lsof -p "$pid" 2>/dev/null | awk '/cwd/{print $NF}')"
  if [[ "$2" == "backend" ]]; then
    judge_db "$(db_host_of "$(env_of "$pid" DATABASE_URL)")"
    judge_gateway "$(env_of "$pid" NEW_API_BASE_URL)"
  fi
}

probe_port 3000 web
probe_port 3100 backend

# Redis：本地容器 blue-whale-dev-redis
if command -v redis-cli > /dev/null 2>&1 && redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; then
  echo "[redis :6379] PONG"
else
  echo "[redis :6379] 不可达   ⚠️ 后端会话接口会全 503（「会话服务不可用」）；修法：docker start blue-whale-dev-redis"
fi
