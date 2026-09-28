#!/usr/bin/env bash
# run-testsite-sql.sh —— 测试站手工/应急 SQL 标准执行通道（IKIJ41 / 父单 IKIJ3K）。
#
# 与 tunnel-testsite-db.sh 同层维护，是 ADR-0064「补记（2026-09-25，IKIJ3K）」的配套脚本。
#
# 背景：09-25 恢复 SQL 经默认 latin1 字符集的 mysql 客户端连接执行，UTF-8 字节被按
# CP1252 解码后双重编码存入数据库，造成画布中文乱码（连续第二次恢复链路事故）。
# 本脚本把应急 SQL 执行通道固化：默认强制 utf8mb4，字符集参数由脚本硬编码注入，
# 不提供任何让调用方省略或改掉该参数的开关。
#
# 原则：经 SSH 在测试站服务器上以 mysql 客户端连本机 MySQL，凭据沿用服务器侧
# 机制（如 ~/.my.cnf），不进脚本、不进仓库。
#
# 用法：
#   scripts/run-testsite-sql.sh <文件.sql>        # 执行 SQL 文件（经 SSH stdin 传入，服务器不落盘）
#   scripts/run-testsite-sql.sh --interactive     # 交互执行 mysql（无参数时默认）
#   scripts/run-testsite-sql.sh --dry-run ...     # 只打印将执行的完整命令，不执行
# 环境变量覆盖：BW_TESTSITE_HOST / BW_TESTSITE_USER / BW_TESTSITE_MYSQL_ARGS

set -euo pipefail

HOST="${BW_TESTSITE_HOST:-115.190.244.91}"
USER_NAME="${BW_TESTSITE_USER:-root}"
DB_NAME=blue_whale
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306

usage() {
  cat >&2 <<USAGE
用法: scripts/run-testsite-sql.sh [--dry-run] <SQL文件>
       scripts/run-testsite-sql.sh [--dry-run] --interactive

  <SQL文件>       在测试站执行该 SQL 文件（经 SSH stdin 传入，服务器不落盘）
  --interactive   交互执行 mysql（不带任何参数时默认进入交互）
  --dry-run       只打印将执行的完整命令，不实际执行
  -h | --help     显示本帮助

环境变量:
  BW_TESTSITE_HOST         测试站地址（默认 115.190.244.91）
  BW_TESTSITE_USER         SSH 用户（默认 root）
  BW_TESTSITE_MYSQL_ARGS   附加 mysql 连接参数（如 “-u <账号> -p”）；
                           凭据默认沿用服务器侧 ~/.my.cnf，不进脚本、不进仓库

字符集纪律（IKIJ41 / ADR-0064 补记）:
  mysql 始终以 --default-character-set=utf8mb4 执行：参数由脚本硬编码注入并排在
  调用方参数之后；调用方参数中出现 --default-character-set 或 --charset 会被
  直接拒绝（fail closed），不存在省略或覆盖路径。
USAGE
  exit 2
}

DRY_RUN=0
INTERACTIVE=0
SQL_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --interactive) INTERACTIVE=1; shift ;;
    -h|--help) usage ;;
    -*) echo "❌ 未知参数：$1" >&2; usage ;;
    *)
      [ -z "$SQL_FILE" ] || { echo "❌ 只接受一个 SQL 文件参数：$1" >&2; exit 2; }
      SQL_FILE="$1"; shift ;;
  esac
done

if [ "$INTERACTIVE" -eq 1 ] && [ -n "$SQL_FILE" ]; then
  echo "❌ --interactive 与 SQL 文件参数互斥，二选一" >&2
  exit 2
fi
# 无参数默认进入交互形态
if [ -z "$SQL_FILE" ]; then
  INTERACTIVE=1
fi

if [ -n "$SQL_FILE" ]; then
  [ -f "$SQL_FILE" ] || { echo "❌ SQL 文件不存在：$SQL_FILE" >&2; exit 1; }
  [ -r "$SQL_FILE" ] || { echo "❌ SQL 文件不可读：$SQL_FILE" >&2; exit 1; }
fi

# 组装 mysql 参数：连接目标 → 调用方附加参数 → 脚本强制字符集（始终最后注入）。
mysql_args=(-h "$MYSQL_HOST" -P "$MYSQL_PORT")

extra_args=()
if [ -n "${BW_TESTSITE_MYSQL_ARGS:-}" ]; then
  read -r -a extra_args <<< "$BW_TESTSITE_MYSQL_ARGS" || true
fi
if [ "${#extra_args[@]}" -gt 0 ]; then
  # Fail closed：调用方不得自带字符集参数——唯一合法字符集 utf8mb4 由脚本注入。
  # 全名及其变体按前缀拦截；--charset 不带通配，避免误伤 --character-sets-dir。
  # mysql 的唯一前缀缩写形态（如 --def=latin1）无法穷举拦截，实际防护依赖
  # 注入参数排在调用方参数之后——mysql 对重复选项取最后出现的值。
  for arg in "${extra_args[@]}"; do
    case "$arg" in
      --default-character-set*|--charset|--charset=*)
        echo "❌ 调用方参数不得指定字符集（检测到：${arg}）；utf8mb4 由脚本强制注入（IKIJ41 / ADR-0064 补记）" >&2
        exit 1 ;;
    esac
  done
  mysql_args+=("${extra_args[@]}")
fi

# 字符集参数硬编码内建，排在调用方参数之后（mysql 后出现的同名参数生效）。
mysql_args+=(--default-character-set=utf8mb4 "$DB_NAME")

# 远端命令整体 %q 转义后交给远端 shell，避免附加参数中的特殊字符被二次解析。
REMOTE_MYSQL_CMD=$(printf ' %q' mysql "${mysql_args[@]}")

command -v ssh >/dev/null 2>&1 || { echo "❌ 未找到 ssh 命令" >&2; exit 1; }

if [ "$DRY_RUN" -eq 1 ]; then
  if [ "$INTERACTIVE" -eq 1 ]; then
    echo "[dry-run] 将执行（交互）："
    printf 'ssh -t %s@%s "%s"\n' "$USER_NAME" "$HOST" "${REMOTE_MYSQL_CMD# }"
  else
    echo "[dry-run] 将执行（文件 $SQL_FILE 经 stdin 传入）："
    printf 'ssh %s@%s "%s" < %s\n' "$USER_NAME" "$HOST" "${REMOTE_MYSQL_CMD# }" "$SQL_FILE"
  fi
  echo "[dry-run] 未实际连接测试站。"
  exit 0
fi

if [ "$INTERACTIVE" -eq 1 ]; then
  echo "🔗 交互会话：${USER_NAME}@${HOST} → mysql ${DB_NAME}（utf8mb4 强制，ADR-0064 补记）"
  exec ssh -t "$USER_NAME@$HOST" "$REMOTE_MYSQL_CMD"
else
  echo "🔗 执行：$SQL_FILE → ${USER_NAME}@${HOST} mysql ${DB_NAME}（utf8mb4 强制，ADR-0064 补记）"
  ssh "$USER_NAME@$HOST" "$REMOTE_MYSQL_CMD" < "$SQL_FILE"
  echo "✅ 执行完毕；回读校验按恢复 runbook（提取 → 校验 → utf8mb4 执行 → 回读）继续。"
fi
