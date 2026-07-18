#!/usr/bin/env bash
# Schema 迁移四场景验收(IK1W1E + IK1W1L)
#
# 用真实 MySQL + 隔离 Compose 栈验证版本化迁移与 Schema 就绪门禁：
#   1. empty              空库初始化：down -v 起空卷，迁移器跑 V1+V2+V3，记账本记录版本，表齐全。
#   2. upgrade            旧库保数据升级：注入旧库夹具，迁移器补记 V1 且保留既有业务数据。
#   3. drift              未知漂移失败：注入坏夹具(记账本谎称 V1 但缺表)，迁移失败、业务服务不启动。
#   4. upgrade-generation 生成域旧库升级(IK1W1L)：注入 pre-ik10i6 形态 generation 域旧库，
#                         V3 原地建缺表/补缺列/幂等回填，既有 Job/Asset/Canvas 关联保留。
#
# 各场景独立 Compose 项目(bw-schema-*)，结束 down -v 清理，可重复执行。
# 复用 deploy/local/docker-compose.yml + .acceptance.yml 基础设施与镜像。
#
# 用法：
#   scripts/run-schema-acceptance.sh                      跑全部四个场景
#   scripts/run-schema-acceptance.sh empty                只跑空库场景
#   scripts/run-schema-acceptance.sh upgrade              只跑旧库升级场景
#   scripts/run-schema-acceptance.sh drift                只跑漂移失败场景
#   scripts/run-schema-acceptance.sh upgrade-generation   只跑生成域旧库升级场景
#   scripts/run-schema-acceptance.sh --keep-stack         调试：结束后保留最后一个栈
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
Schema 迁移验收(IK1W1E + IK1W1L)—— 用法：

  scripts/run-schema-acceptance.sh                      全部四个场景
  scripts/run-schema-acceptance.sh empty                空库初始化
  scripts/run-schema-acceptance.sh upgrade              旧库保数据升级
  scripts/run-schema-acceptance.sh drift                未知漂移失败
  scripts/run-schema-acceptance.sh upgrade-generation   生成域旧库升级(IK1W1L)
  scripts/run-schema-acceptance.sh --keep-stack         调试：保留最后一个栈

前置：:acceptance 镜像需已构建(scripts/run-mvp-acceptance.sh 会构建)。
EOF
}

for arg in "$@"; do
  case "$arg" in
    empty|upgrade|drift|upgrade-generation) SCENARIOS+=("$arg") ;;
    --keep-stack) KEEP_STACK=1 ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage; fail "未知参数：$arg" ;;
  esac
done
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(empty upgrade drift upgrade-generation)

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
  echo "🧪 [1/4] 空库初始化(project=$project)"
  echo "   down -v 起空卷 → 迁移器应跑 V1+V2+V3，记账本记录版本，表齐全"
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

  # 断言：记账本含 V1、V2、V3；project 表存在
  local versions; versions="$(mysql_exec "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations' 2>/dev/null | tail -1)"
  local has_project; has_project="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_DB' AND table_name='project'" 2>/dev/null | tail -1)"

  echo "   记账本版本: $versions"
  echo "   project 表存在: $has_project"

  [ "$versions" = "1,2,3" ] || fail "空库：记账本应为 1,2,3，实际 $versions"
  [ "$has_project" = "1" ] || fail "空库：project 表应存在"

  echo "✅ [1/4] 空库初始化通过"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 2：旧库保数据升级 ─────────────
scenario_upgrade() {
  local project="bw-schema-upgrade"
  echo "🧪 [2/4] 旧库保数据升级(project=$project)"
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

  # 断言：记账本含 V1、V2、V3(补记 V1 + 跑 V2/V3)；既有 2 行数据保留；V2 seed 追加
  local versions; versions="$(mysql_exec "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations' 2>/dev/null | tail -1)"
  local preserved; preserved="$(mysql_exec "$project" 'SELECT COUNT(*) FROM project WHERE id IN (9001,9002)' 2>/dev/null | tail -1)"
  local total; total="$(mysql_exec "$project" 'SELECT COUNT(*) FROM project' 2>/dev/null | tail -1)"

  echo "   记账本版本: $versions"
  echo "   既有数据(id 9001,9002)保留: $preserved 行"
  echo "   project 总行数(含 V2 seed): $total"

  [ "$versions" = "1,2,3" ] || fail "旧库：记账本应为 1,2,3(补记 V1+V2+V3)，实际 $versions"
  [ "$preserved" = "2" ] || fail "旧库：既有数据未保留(期望 2 行，实际 $preserved)"

  echo "✅ [2/4] 旧库保数据升级通过"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 3：未知漂移失败 ─────────────
scenario_drift() {
  local project="bw-schema-drift"
  echo "🧪 [3/4] 未知漂移失败(project=$project)"
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

  echo "✅ [3/4] 未知漂移失败通过(fail-closed 门禁生效)"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 4：生成域旧库升级（IK1W1L） ─────────────
scenario_upgrade_generation() {
  local project="bw-schema-upgrade-generation"
  echo "🧪 [4/4] 生成域旧库升级(project=$project)"
  echo "   注入 pre-ik10i6 形态 generation 域夹具 → V3 建缺表/补缺列/幂等回填，既有事实保留"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true

  write_fixture_override "$FIXTURE_DIR/old-generation-schema.sql"
  start_infra "$project" "$TMP_OVERRIDE"

  # 升级前：generation_job_outputs 等表不存在，generation_jobs 缺后加列
  local pre_outputs; pre_outputs="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_DB' AND table_name='generation_job_outputs'" 2>/dev/null | tail -1)"
  local pre_col; pre_col="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$MYSQL_DB' AND table_name='generation_jobs' AND column_name='strategy_version'" 2>/dev/null | tail -1)"
  echo "   升级前 generation_job_outputs 表存在: $pre_outputs(期望 0)"
  echo "   升级前 generation_jobs.strategy_version 列存在: $pre_col(期望 0)"
  [ "$pre_outputs" = "0" ] || fail "夹具异常：generation_job_outputs 不应存在"
  [ "$pre_col" = "0" ] || fail "夹具异常：strategy_version 列不应存在"

  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up blue-whale-schema-migration >/dev/null 2>&1 &
  local code; code="$(wait_migration_done bw-acc-schema-migration)"

  if [ "$code" != "0" ]; then
    echo "❌ 生成域旧库升级迁移失败(exit=$code)"
    docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs blue-whale-schema-migration 2>&1 | tail -30
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "生成域旧库升级场景失败"
  fi

  # 断言：记账本 1,2,3；缺表建出；缺列补齐；既有事实与关联保留；输出槽回填
  local versions; versions="$(mysql_exec "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations' 2>/dev/null | tail -1)"
  local outputs_table; outputs_table="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_DB' AND table_name='generation_job_outputs'" 2>/dev/null | tail -1)"
  local col_ok; col_ok="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$MYSQL_DB' AND table_name='generation_jobs' AND column_name='strategy_version'" 2>/dev/null | tail -1)"
  local job_version; job_version="$(mysql_exec "$project" 'SELECT version FROM generation_jobs WHERE id=6001' 2>/dev/null | tail -1)"
  local job_status; job_status="$(mysql_exec "$project" 'SELECT status FROM generation_jobs WHERE id=6001' 2>/dev/null | tail -1)"
  local asset_ok; asset_ok="$(mysql_exec "$project" "SELECT COUNT(*) FROM assets WHERE id=7001 AND storage_key='legacy/acc-7001.png'" 2>/dev/null | tail -1)"
  local canvas_link; canvas_link="$(mysql_exec "$project" "SELECT COUNT(*) FROM canvas WHERE id=8001 AND JSON_CONTAINS(nodes_json, '7001', '\$[0].data.assetId')" 2>/dev/null | tail -1)"
  local backfill; backfill="$(mysql_exec "$project" "SELECT COUNT(*) FROM generation_job_outputs WHERE generation_job_id=6001 AND slot_index=0 AND status='succeeded'" 2>/dev/null | tail -1)"

  echo "   记账本版本: $versions"
  echo "   generation_job_outputs 建出: $outputs_table  strategy_version 补齐: $col_ok"
  echo "   既有 Job 6001: version=$job_version status=$job_status  既有 Asset 7001: $asset_ok"
  echo "   Canvas→Asset 引用保持: $canvas_link  输出槽回填: $backfill"

  [ "$versions" = "1,2,3" ] || fail "生成域旧库：记账本应为 1,2,3，实际 $versions"
  [ "$outputs_table" = "1" ] || fail "生成域旧库：generation_job_outputs 应建出"
  [ "$col_ok" = "1" ] || fail "生成域旧库：strategy_version 列应补齐"
  [ "$job_version" = "3" ] || fail "生成域旧库：既有 Job 聚合版本应保留(期望 3，实际 $job_version)"
  [ "$job_status" = "succeeded" ] || fail "生成域旧库：既有 Job 状态应保留(期望 succeeded，实际 $job_status)"
  [ "$asset_ok" = "1" ] || fail "生成域旧库：既有 Asset 未保留"
  [ "$canvas_link" = "1" ] || fail "生成域旧库：Canvas→Asset 引用未保持"
  [ "$backfill" = "1" ] || fail "生成域旧库：输出槽应回填 succeeded 行"

  # 幂等：再跑一次迁移容器，exit 0 且数据不重复、版本号不变
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up blue-whale-schema-migration >/dev/null 2>&1 &
  local code2; code2="$(wait_migration_done bw-acc-schema-migration)"
  local outputs_count; outputs_count="$(mysql_exec "$project" 'SELECT COUNT(*) FROM generation_job_outputs' 2>/dev/null | tail -1)"
  local job_version2; job_version2="$(mysql_exec "$project" 'SELECT version FROM generation_jobs WHERE id=6001' 2>/dev/null | tail -1)"
  echo "   重复迁移 exit=$code2  输出行数=$outputs_count  Job version=$job_version2"
  [ "$code2" = "0" ] || fail "生成域旧库：重复迁移应 exit 0，实际 $code2"
  [ "$outputs_count" = "1" ] || fail "生成域旧库：重复迁移不应重复回填(期望 1 行，实际 $outputs_count)"
  [ "$job_version2" = "3" ] || fail "生成域旧库：重复迁移不应改变版本号(期望 3，实际 $job_version2)"

  echo "✅ [4/4] 生成域旧库升级通过"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 执行 ─────────────
echo "🚀 Schema 迁移验收(场景: ${SCENARIOS[*]})"
for s in "${SCENARIOS[@]}"; do
  case "$s" in
    empty) scenario_empty ;;
    upgrade) scenario_upgrade ;;
    drift) scenario_drift ;;
    upgrade-generation) scenario_upgrade_generation ;;
  esac
done

echo ""
echo "✅ Schema 迁移验收全部通过(${#SCENARIOS[@]} 个场景)"
