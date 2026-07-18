#!/usr/bin/env bash
# Schema 迁移三场景验收(IK1W1E)
#
# 用真实 MySQL + 隔离 Compose 栈验证版本化迁移与 Schema 就绪门禁：
#   1. empty   空库初始化：down -v 起空卷，迁移器跑 V1→V2→V3→V4→V5，记账本记录版本，表齐全，
#              游标物理列为非保留字 event_cursor(IK1W1M)。
#   2. upgrade 旧库保数据升级：注入旧库夹具，迁移器补记 V1 且保留既有业务数据；
#              旧库事件/Outbox 的游标值、身份、状态与重试元数据完整保留(IK1W1M)。
#   3. drift   未知漂移失败：注入坏夹具(记账本谎称 V1 但缺表)，迁移失败、业务服务不启动。
#
# 三个场景各自独立 Compose 项目(bw-schema-*)，结束 down -v 清理，可重复执行。
# 复用 deploy/local/docker-compose.yml + .acceptance.yml 基础设施与镜像。
#
# 用法：
#   scripts/run-schema-acceptance.sh              跑全部三个场景
#   scripts/run-schema-acceptance.sh empty        只跑空库场景
#   scripts/run-schema-acceptance.sh upgrade      只跑旧库升级场景
#   scripts/run-schema-acceptance.sh drift        只跑漂移失败场景
#   scripts/run-schema-acceptance.sh --keep-stack 调试：结束后保留最后一个栈
#
# 前置：需先 scripts/run-mvp-acceptance.sh --keep-stack 或 docker build 构建过 :acceptance 镜像。
# 本脚本不重新构建镜像(聚焦验证迁移逻辑，镜像构建由 run-mvp-acceptance.sh 负责)。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE="$ROOT/deploy/local/docker-compose.yml"
COMPOSE_ACC="$ROOT/deploy/local/docker-compose.acceptance.yml"
FIXTURE_DIR="$ROOT/deploy/local/acceptance/schema-migration/fixtures"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_DB="${MYSQL_DB:-blue_whale}"
KEEP_STACK=0
SCENARIOS=()

fail() { echo "❌ schema-acceptance: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Schema 迁移验收(IK1W1E)—— 用法：

  scripts/run-schema-acceptance.sh              全部三个场景
  scripts/run-schema-acceptance.sh empty        空库初始化
  scripts/run-schema-acceptance.sh upgrade      旧库保数据升级
  scripts/run-schema-acceptance.sh drift        未知漂移失败
  scripts/run-schema-acceptance.sh --keep-stack 调试：保留最后一个栈

前置：:acceptance 镜像需已构建(scripts/run-mvp-acceptance.sh 会构建)。
EOF
}

for arg in "$@"; do
  case "$arg" in
    empty|upgrade|drift) SCENARIOS+=("$arg") ;;
    --keep-stack) KEEP_STACK=1 ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage; fail "未知参数：$arg" ;;
  esac
done
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(empty upgrade drift)

command -v docker >/dev/null || fail "未找到 docker"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 不可用"

# 写一个临时 fixture override：给 MySQL 挂载指定夹具到 initdb.d
# 参数：$1 = 夹具绝对路径
write_fixture_override() {
  local fixture="$1"
  cat > "$TMP_OVERRIDE" <<EOF
services:
  mysql:
    volumes:
      - mysql-data:/var/lib/mysql
      - ${fixture}:/docker-entrypoint-initdb.d/01-fixture.sql:ro
EOF
}

# 在指定项目的 MySQL 容器里执行 SQL，返回结果
mysql_exec() {
  local project="$1" sql="$2"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" \
    exec -T mysql mysql -u"$MYSQL_USER" -pblue_whale "$MYSQL_DB" -e "$sql" 2>/dev/null
}

# 启动基础设施（mysql + redis + nacos）并等待健康。
# $1 = project；$2 = 可选额外 override 文件（fixture 挂载用）
start_infra() {
  local project="$1" extra="${2:-}"
  local files=(-f "$COMPOSE_BASE" -f "$COMPOSE_ACC")
  [ -n "$extra" ] && files+=(-f "$extra")
  docker compose -p "$project" "${files[@]}" up -d mysql redis nacos >/dev/null
  for c in bw-acc-mysql bw-acc-redis bw-acc-nacos; do
    for i in $(seq 1 50); do
      [ "$(container_state "$c")" = "healthy" ] && break
      sleep 3
    done
  done
  for c in bw-acc-mysql bw-acc-redis bw-acc-nacos; do
    [ "$(container_state "$c")" = "healthy" ] || fail "基础设施 $c 未健康"
  done
}

container_exit_code() {
  docker inspect -f '{{.State.ExitCode}}' "$1" 2>/dev/null || echo "-1"
}

container_state() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo "missing"
}

# 等待 migration 容器到达终态(exited)，返回其退出码
wait_migration_done() {
  local cname="$1" deadline=180 elapsed=0
  while [ "$elapsed" -lt "$deadline" ]; do
    local st; st="$(container_state "$cname")"
    case "$st" in
      exited) echo "$(container_exit_code "$cname")"; return 0 ;;
    esac
    sleep 3; elapsed=$((elapsed + 3))
  done
  echo "timeout"; return 1
}

TMP_OVERRIDE="$(mktemp /tmp/schema-acc-override.XXXXXX.yml)"
trap 'rm -f "$TMP_OVERRIDE"' EXIT

# ───────────── 场景 1：空库初始化 ─────────────
scenario_empty() {
  local project="bw-schema-empty"
  echo "🧪 [1/3] 空库初始化(project=$project)"
  echo "   down -v 起空卷 → 迁移器应跑 V1→V2→V3→V4→V5，记账本记录版本，表齐全"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" down -v --remove-orphans >/dev/null 2>&1 || true

  start_infra "$project"

  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up blue-whale-schema-migration >/dev/null 2>&1 &
  local mig_pid=$!
  local code; code="$(wait_migration_done bw-acc-schema-migration)"

  if [ "$code" != "0" ]; then
    echo "❌ 空库迁移失败(exit=$code)"; docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs blue-whale-schema-migration 2>&1 | tail -30
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "空库场景失败"
  fi

  # 断言：记账本含 V1、V2、V3、V4、V5；project 表存在；
  # IK1W1M：游标物理列为非保留字 event_cursor，保留字 cursor 列不存在
  local versions; versions="$(mysql_exec "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations' 2>/dev/null | tail -1)"
  local has_project; has_project="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_DB' AND table_name='project'" 2>/dev/null | tail -1)"
  local event_cursor_cols; event_cursor_cols="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$MYSQL_DB' AND table_name IN ('project_events','outbox_messages') AND column_name='event_cursor'" 2>/dev/null | tail -1)"
  local reserved_cols; reserved_cols="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$MYSQL_DB' AND table_name IN ('project_events','outbox_messages') AND column_name='cursor'" 2>/dev/null | tail -1)"

  echo "   记账本版本: $versions"
  echo "   project 表存在: $has_project"
  echo "   event_cursor 列数(期望 2): ${event_cursor_cols}；保留字 cursor 列数(期望 0): $reserved_cols"

  [ "$versions" = "1,2,3,4,5" ] || fail "空库：记账本应为 1,2,3,4,5，实际 $versions"
  [ "$has_project" = "1" ] || fail "空库：project 表应存在"
  [ "$event_cursor_cols" = "2" ] || fail "空库：project_events/outbox_messages 应有 event_cursor 列"
  [ "$reserved_cols" = "0" ] || fail "空库：不应残留保留字 cursor 列"

  echo "✅ [1/3] 空库初始化通过"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 2：旧库保数据升级 ─────────────
scenario_upgrade() {
  local project="bw-schema-upgrade"
  echo "🧪 [2/3] 旧库保数据升级(project=$project)"
  echo "   注入旧库夹具 → 迁移器补记 V1，既有业务数据保留"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true

  write_fixture_override "$FIXTURE_DIR/old-baseline.sql"
  # 用 fixture override 起基础设施（空卷首次启动执行夹具 SQL 造旧库）
  start_infra "$project" "$TMP_OVERRIDE"

  # 旧库已注入：project 表有 2 行既有数据，无 schema_migrations
  local old_rows; old_rows="$(mysql_exec "$project" 'SELECT COUNT(*) FROM project' 2>/dev/null | tail -1)"
  echo "   旧库 project 行数(升级前): $old_rows"
  [ "$old_rows" = "2" ] || fail "夹具未正确注入旧库数据(期望 2 行，实际 $old_rows)"

  # 跑迁移（不带 fixture override，避免重复挂载；用基础+acceptance 配置）
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up blue-whale-schema-migration >/dev/null 2>&1 &
  local code; code="$(wait_migration_done bw-acc-schema-migration)"

  if [ "$code" != "0" ]; then
    echo "❌ 旧库升级迁移失败(exit=$code)"
    docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs blue-whale-schema-migration 2>&1 | tail -30
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "旧库升级场景失败"
  fi

  # 断言：记账本含 V1、V2、V3、V4、V5(补记 V1 + 跑 V2/V3/V4/V5)；既有 2 行数据保留；V2 seed 追加；
  # IK1W1M：旧库事件/Outbox 的游标值、身份、状态与重试元数据完整保留，顺序不变
  local versions; versions="$(mysql_exec "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations' 2>/dev/null | tail -1)"
  local preserved; preserved="$(mysql_exec "$project" 'SELECT COUNT(*) FROM project WHERE id IN (9001,9002)' 2>/dev/null | tail -1)"
  local total; total="$(mysql_exec "$project" 'SELECT COUNT(*) FROM project' 2>/dev/null | tail -1)"
  local events; events="$(mysql_exec "$project" "SELECT GROUP_CONCAT(CONCAT(event_id,'/',event_cursor) ORDER BY project_id, event_cursor) FROM project_events WHERE project_id=9001" 2>/dev/null | tail -1)"
  local outbox; outbox="$(mysql_exec "$project" "SELECT GROUP_CONCAT(CONCAT_WS('/',message_id,event_cursor,status,attempt_count,IFNULL(next_attempt_at,'null')) ORDER BY project_id, event_cursor) FROM outbox_messages WHERE project_id=9001" 2>/dev/null | tail -1)"
  local reserved_cols; reserved_cols="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$MYSQL_DB' AND table_name IN ('project_events','outbox_messages') AND column_name='cursor'" 2>/dev/null | tail -1)"

  echo "   记账本版本: $versions"
  echo "   既有数据(id 9001,9002)保留: $preserved 行"
  echo "   project 总行数(含 V2 seed): $total"
  # 模板数据（V5 seed）不在本脚本断言范围，见 run-template-acceptance.sh
  echo "   事件(event_id/游标,按序): $events"
  echo "   Outbox(message_id/游标/状态/重试/下次重试,按序): $outbox"
  echo "   保留字 cursor 列数(期望 0): $reserved_cols"

  [ "$versions" = "1,2,3,4,5" ] || fail "旧库：记账本应为 1,2,3,4,5(补记 V1+V2/V3/V4/V5)，实际 $versions"
  [ "$preserved" = "2" ] || fail "旧库：既有数据未保留(期望 2 行，实际 $preserved)"
  [ "$events" = "evt_old_1/1,evt_old_2/2,evt_old_3/3" ] || fail "旧库：事件游标值或顺序未保留，实际 $events"
  [ "$outbox" = "evt_old_1/1/pending/2/2030-01-02 03:04:05,evt_old_2/2/published/0/null,evt_old_3/3/pending/1/2030-02-03 04:05:06" ] \
    || fail "旧库：Outbox 身份/状态/重试元数据未保留，实际 $outbox"
  [ "$reserved_cols" = "0" ] || fail "旧库：不应残留保留字 cursor 列"

  echo "✅ [2/3] 旧库保数据升级通过"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 3：未知漂移失败 ─────────────
scenario_drift() {
  local project="bw-schema-drift"
  echo "🧪 [3/3] 未知漂移失败(project=$project)"
  echo "   注入坏夹具(记账本谎称 V1 但缺 project 表)→ 迁移失败、业务服务不启动"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true

  write_fixture_override "$FIXTURE_DIR/drift.sql"
  start_infra "$project" "$TMP_OVERRIDE"

  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up blue-whale-schema-migration >/dev/null 2>&1 &
  local code; code="$(wait_migration_done bw-acc-schema-migration)"

  if [ "$code" = "0" ]; then
    echo "❌ 漂移场景：迁移本应失败但 exit=0"
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "漂移场景：迁移应 fail-closed 但成功了"
  fi

  echo "   迁移容器 exit=$code(期望非 0)✓"

  # 断言：user/agent 因 depends_on 门禁从未启动
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up -d blue-whale-user blue-whale-agent >/dev/null 2>&1 || true
  sleep 5
  local user_st; user_st="$(container_state bw-acc-user)"
  local agent_st; agent_st="$(container_state bw-acc-agent)"
  echo "   user 容器状态: $user_st(期望非 running/healthy)"
  echo "   agent 容器状态: $agent_st(期望非 running/healthy)"

  case "$user_st" in running|healthy) fail "漂移：user 不应启动但状态=$user_st" ;; esac
  case "$agent_st" in running|healthy) fail "漂移：agent 不应启动但状态=$agent_st" ;; esac

  echo "✅ [3/3] 未知漂移失败通过(fail-closed 门禁生效)"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 执行 ─────────────
echo "🚀 Schema 迁移验收(场景: ${SCENARIOS[*]})"
for s in "${SCENARIOS[@]}"; do
  case "$s" in
    empty) scenario_empty ;;
    upgrade) scenario_upgrade ;;
    drift) scenario_drift ;;
  esac
done

echo ""
echo "✅ Schema 迁移验收全部通过(${#SCENARIOS[@]} 个场景)"
