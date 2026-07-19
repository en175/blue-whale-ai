#!/usr/bin/env bash
# Schema 迁移验收(IK1W1E / IK1W1J)
#
# 用真实 MySQL + 隔离 Compose 栈验证版本化迁移与 Schema 就绪门禁：
#   1. empty      空库初始化：迁移器跑 V1→V2→V3→V4→V5→V6，表齐全，游标物理列为
#                 非保留字 event_cursor(IK1W1M)；随后验证完整 Agent 运行业务链路
#                 （公开 Conversation 接口 → Worker claim/commit →
#                 RuntimeCheckpoint 持久化 → 中断后租约接管恢复）与迁移幂等重跑。
#   2. upgrade    旧库保数据升级（迁移器引入前的完整库）：补记 V1，V6 幂等 no-op，
#                 既有业务数据保留；旧库事件/Outbox 的游标值、身份、状态与重试元数据
#                 完整保留(IK1W1M)。
#   3. pre-agent  pre-Agent 旧库升级（IK1W1J）：缺全部 Agent 运行表的已知旧库，
#                 V6 建出七张表，users/project/canvas 既有事实保留，业务链路可用。
#   4. partial    部分历史 Agent 一次性迁移库升级（IK1W1J）：ik10i5/ik10pt 历史形态，
#                 V6 幂等补齐缺失列并放宽旧 NOT NULL 约束，既有运行数据不丢不重。
#   5. drift      未知漂移失败：注入坏夹具(记账本谎称 V1 但缺表)，迁移失败、业务服务不启动。
#   6. drift-agent Agent 结构未知漂移（IK1W1J）：七表齐全但列类型/可空性不符合受支持形态，
#                 V6 契约断言失败并输出具体结构原因，业务服务不启动。
#
# 六个场景各自独立 Compose 项目(bw-schema-*)，结束 down -v 清理，可重复执行。
# 复用 deploy/local/docker-compose.yml + .acceptance.yml 基础设施与镜像。
#
# 用法：
#   scripts/run-schema-acceptance.sh              跑全部场景
#   scripts/run-schema-acceptance.sh empty        只跑空库场景
#   scripts/run-schema-acceptance.sh upgrade      只跑旧库升级场景
#   scripts/run-schema-acceptance.sh pre-agent    只跑 pre-Agent 旧库场景
#   scripts/run-schema-acceptance.sh partial      只跑部分历史 Agent 库场景
#   scripts/run-schema-acceptance.sh drift        只跑漂移失败场景
#   scripts/run-schema-acceptance.sh --keep-stack 调试：结束后保留最后一个栈
#
# 前置：需先 scripts/run-mvp-acceptance.sh --keep-stack 或 docker build 构建过 :acceptance 镜像。
# 本脚本不重新构建镜像(聚焦验证迁移逻辑，镜像构建由 run-mvp-acceptance.sh 负责)。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE="$ROOT/deploy/local/docker-compose.yml"
# 并行工单隔离（IK1W1J）：存在专属 override 副本时优先使用——
# acceptance 基座的容器名 bw-acc-* 硬编码全局唯一，多工单并行跑验收互踩；
# 专属副本用独立容器名前缀与镜像 tag，构建命令：
#   docker compose -p bw-ik1w1j -f deploy/local/docker-compose.yml \
#     -f deploy/local/docker-compose.acceptance-ik1w1j.yml build blue-whale-agent
if [ -f "$ROOT/deploy/local/docker-compose.acceptance-ik1w1j.yml" ]; then
  COMPOSE_ACC="$ROOT/deploy/local/docker-compose.acceptance-ik1w1j.yml"
  CTR_PREFIX="bw-j1j"
else
  COMPOSE_ACC="$ROOT/deploy/local/docker-compose.acceptance.yml"
  CTR_PREFIX="bw-acc"
fi
FIXTURE_DIR="$ROOT/deploy/local/acceptance/schema-migration/fixtures"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_DB="${MYSQL_DB:-blue_whale}"
KEEP_STACK=0
SCENARIOS=()

# Agent 运行持久化七张表（IK1W1J 契约）
AGENT_TABLES="'conversations','agent_runs','runtime_checkpoints','run_commits','user_input_requests','conversation_messages','command_idempotency'"
# 迁移账本期望版本（V1 基线 + V2 seed + V3 游标去保留字 + V4 生成资产 + V5 模板 + V6 Agent 运行持久化）
# 从迁移目录动态派生版本集，加新版本无需改脚本。
# sort -n 防止 V10+ 字典序排到 V2 前；sed 只取 V 与 __ 之间的数字，slug 含数字不误读。
MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/resources/db/migrations"
EXPECTED_VERSIONS=$(ls "$MIGRATIONS_DIR"/V*__*.sql \
    | sed 's#.*/V\([0-9]*\)__[[:alnum:]_-]*\.sql#\1#' \
    | sort -n | paste -sd, -)
# Worker claim 租约秒数（与 AgentRunWorkerService 一致），接管验证需等待租约过期
LEASE_SECONDS=31

fail() { echo "❌ schema-acceptance: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Schema 迁移验收(IK1W1E/IK1W1J)—— 用法：

  scripts/run-schema-acceptance.sh              全部场景
  scripts/run-schema-acceptance.sh empty        空库初始化 + 业务链路 + 中断恢复
  scripts/run-schema-acceptance.sh upgrade      旧库保数据升级（V6 幂等 no-op）
  scripts/run-schema-acceptance.sh pre-agent    pre-Agent 旧库补齐 Agent 表
  scripts/run-schema-acceptance.sh partial      部分历史 Agent 库收敛
  scripts/run-schema-acceptance.sh drift        未知漂移失败
  scripts/run-schema-acceptance.sh drift-agent  Agent 结构未知漂移失败（V6 契约断言）
  scripts/run-schema-acceptance.sh --keep-stack 调试：保留最后一个栈

前置：镜像需已构建。默认用 :acceptance（scripts/run-mvp-acceptance.sh 会构建）；
存在 deploy/local/docker-compose.acceptance-ik1w1j.yml 时用 :acc-ik1w1j，构建：
  docker compose -p bw-ik1w1j -f deploy/local/docker-compose.yml \
    -f deploy/local/docker-compose.acceptance-ik1w1j.yml build blue-whale-agent
EOF
}

for arg in "$@"; do
  case "$arg" in
    empty|upgrade|pre-agent|partial|drift|drift-agent) SCENARIOS+=("$arg") ;;
    --keep-stack) KEEP_STACK=1 ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage; fail "未知参数：$arg" ;;
  esac
done
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(empty upgrade pre-agent partial drift drift-agent)

command -v docker >/dev/null || fail "未找到 docker"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 不可用"
command -v python3 >/dev/null || fail "未找到 python3(JSON 断言需要)"

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

# 在指定项目的 Agent 容器里调用 Agent HTTP 接口（容器网络内 localhost:8082）。
# 参数：$1=compose project $2=HTTP method $3=path；后续参数原样透传给 curl(-H/-d 等)
agent_curl() {
  local project="$1" method="$2" path="$3"; shift 3
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" \
    exec -T blue-whale-agent curl -sS -X "$method" "$@" \
    "http://localhost:8082${path}" 2>/dev/null
}

# 从 JSON 取点路径字段；None 输出空串。$1=json $2=点路径(如 data.agent_run_id)
json_get() {
  python3 -c "
import sys, json
try:
    cur = json.loads(sys.argv[1])
    for k in sys.argv[2].split('.'):
        cur = cur[k] if not isinstance(cur, list) else cur[int(k)]
    print('' if cur is None else cur)
except Exception:
    print('')
" "$1" "$2"
}

# 启动基础设施（mysql + redis + nacos）并等待健康。
# $1 = project；$2 = 可选额外 override 文件（fixture 挂载用）
start_infra() {
  local project="$1" extra="${2:-}"
  local files=(-f "$COMPOSE_BASE" -f "$COMPOSE_ACC")
  [ -n "$extra" ] && files+=(-f "$extra")
  docker compose -p "$project" "${files[@]}" up -d mysql redis nacos >/dev/null
  for c in ${CTR_PREFIX}-mysql ${CTR_PREFIX}-redis ${CTR_PREFIX}-nacos; do
    for i in $(seq 1 50); do
      [ "$(container_state "$c")" = "healthy" ] && break
      sleep 3
    done
  done
  for c in ${CTR_PREFIX}-mysql ${CTR_PREFIX}-redis ${CTR_PREFIX}-nacos; do
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

# 跑一次迁移容器并断言 exit 0。$1=project $2=场景名(日志用)
run_migration_ok() {
  local project="$1" scene="$2"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up blue-whale-schema-migration >/dev/null 2>&1 &
  local code; code="$(wait_migration_done ${CTR_PREFIX}-schema-migration)"
  if [ "$code" != "0" ]; then
    echo "❌ ${scene}迁移失败(exit=${code})"
    docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs blue-whale-schema-migration 2>&1 | tail -30
    return 1
  fi
  echo "   迁移容器 exit=0 ✓"
}

# 断言：记账本版本齐全 + 七张 Agent 表存在。$1=project
assert_migration_baseline() {
  local project="$1"
  local versions; versions="$(mysql_exec "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations' | tail -1)"
  local agent_tables; agent_tables="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${MYSQL_DB}' AND table_name IN (${AGENT_TABLES})" | tail -1)"
  echo "   记账本版本: ${versions}"
  echo "   Agent 运行表数(期望 7): ${agent_tables}"
  [ "$versions" = "$EXPECTED_VERSIONS" ] || fail "记账本应为 ${EXPECTED_VERSIONS}，实际 ${versions}"
  [ "$agent_tables" = "7" ] || fail "Agent 运行表应为 7 张，实际 ${agent_tables}"
}

# 启动 Agent 服务并等健康（迁移已成功后调用）。$1=project
start_agent() {
  local project="$1"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up -d blue-whale-agent >/dev/null
  for i in $(seq 1 60); do
    [ "$(container_state ${CTR_PREFIX}-agent)" = "healthy" ] && { echo "   agent 服务 healthy ✓"; return 0; }
    sleep 3
  done
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs blue-whale-agent 2>&1 | tail -20
  fail "agent 服务未在时限内 healthy"
}

# 公开 Conversation 接口发消息，输出 agent_run_id。
# $1=project $2=project_id $3=user_id $4=幂等键/消息 id 前缀
post_conversation_message() {
  local project="$1" pid="$2" uid="$3" tag="$4"
  local resp; resp="$(agent_curl "$project" POST "/api/projects/${pid}/conversation/messages" \
      -H "Content-Type: application/json" \
      -H "X-User-Id: ${uid}" \
      -H "Idempotency-Key: ${tag}-msg-1" \
      -d "{\"client_message_id\":\"${tag}-cm-1\",\"content\":\"生成一张蓝鲸图片\"}")"
  local code; code="$(json_get "$resp" code)"
  local run_id; run_id="$(json_get "$resp" data.agent_run_id)"
  [ "$code" = "200" ] || fail "公开 Conversation 接口应 code=200，实际响应: ${resp}"
  [ -n "$run_id" ] || fail "公开 Conversation 接口未返回 agent_run_id: ${resp}"
  echo "$run_id"
}

# Worker claim 认领 run。输出 claim 响应 JSON。$1=project $2=worker_id
probe_claim() {
  local project="$1" worker="$2"
  agent_curl "$project" POST "/internal/agent-runs/claim" \
      -H "X-Worker-Id: ${worker}" -H "X-Orchestrator-Engine: fake" \
      -H "Content-Type: application/json" -d '{}'
}

# Worker commit 提交可见文本 + 不可变 RuntimeCheckpoint + 一个 fake 生图动作。
# $1=project $2=run_id $3=worker_id $4=claim响应JSON $5=动作唯一标记
probe_commit() {
  local project="$1" run_id="$2" worker="$3" claim_json="$4" tag="$5"
  local run_version fencing engine_version adapter_version project_id user_id
  run_version="$(json_get "$claim_json" data.run_version)"
  fencing="$(json_get "$claim_json" data.fencing_token)"
  engine_version="$(json_get "$claim_json" data.engine_version)"
  adapter_version="$(json_get "$claim_json" data.adapter_schema_version)"
  project_id="$(json_get "$claim_json" data.project_id)"
  user_id="$(json_get "$claim_json" data.user_id)"
  [ -n "$run_version" ] && [ -n "$fencing" ] || fail "claim 响应缺 run_version/fencing_token: ${claim_json}"
  local body; body="$(python3 -c "
import json, sys
print(json.dumps({
    'commit_id': '${tag}-commit-1',
    'project_id': int('${project_id}'),
    'user_id': int('${user_id}'),
    'expected_run_version': int('${run_version}'),
    'fencing_token': int('${fencing}'),
    'engine': 'fake',
    'engine_version': '${engine_version}',
    'adapter_schema_version': int('${adapter_version}'),
    'visible_text': '已接纳，正在生成图片。',
    'checkpoint': {'opaque_payload': {'step': 'image_proposed', 'prompt': '蓝鲸'}},
    'actions': [{'action_id': '${tag}-action-1', 'action_type': 'generate_image',
                 'arguments': {'prompt': '蓝鲸', 'aspect_ratio': '1:1'}}],
    'usage': {'input_units': 0, 'output_units': 0},
}))")"
  local resp; resp="$(agent_curl "$project" POST "/internal/agent-runs/${run_id}/commits" \
      -H "Content-Type: application/json" -H "X-Worker-Id: ${worker}" -d "$body")"
  local code; code="$(json_get "$resp" code)"
  [ "$code" = "200" ] || fail "Worker commit 应 code=200，实际响应: ${resp}"
  echo "$resp"
}

# Worker commit 提交创作澄清提议（与动作互斥）：checkpoint 标记 clarification_proposed，
# user_input_request=creation_clarification。输出 commit 响应 JSON。
# $1=project $2=run_id $3=worker_id $4=claim响应JSON $5=唯一标记
probe_commit_clarification() {
  local project="$1" run_id="$2" worker="$3" claim_json="$4" tag="$5"
  local run_version fencing engine_version adapter_version project_id user_id
  run_version="$(json_get "$claim_json" data.run_version)"
  fencing="$(json_get "$claim_json" data.fencing_token)"
  engine_version="$(json_get "$claim_json" data.engine_version)"
  adapter_version="$(json_get "$claim_json" data.adapter_schema_version)"
  project_id="$(json_get "$claim_json" data.project_id)"
  user_id="$(json_get "$claim_json" data.user_id)"
  [ -n "$run_version" ] && [ -n "$fencing" ] || fail "claim 响应缺 run_version/fencing_token: ${claim_json}"
  local body; body="$(python3 -c "
import json, sys
print(json.dumps({
    'commit_id': '${tag}-commit-1',
    'project_id': int('${project_id}'),
    'user_id': int('${user_id}'),
    'expected_run_version': int('${run_version}'),
    'fencing_token': int('${fencing}'),
    'engine': 'fake',
    'engine_version': '${engine_version}',
    'adapter_schema_version': int('${adapter_version}'),
    'visible_text': '请补充你希望生成的「蓝鲸」的具体风格或细节。',
    'checkpoint': {'opaque_payload': {'step': 'clarification_proposed', 'topic': '蓝鲸'}},
    'actions': [],
    'user_input_request': {'request_type': 'creation_clarification',
                           'question': '请补充你希望生成的「蓝鲸」的具体风格或细节。'},
    'usage': {'input_units': 0, 'output_units': 0},
}))")"
  local resp; resp="$(agent_curl "$project" POST "/internal/agent-runs/${run_id}/commits" \
      -H "Content-Type: application/json" -H "X-Worker-Id: ${worker}" -d "$body")"
  local code; code="$(json_get "$resp" code)"
  [ "$code" = "200" ] || fail "澄清 commit 应 code=200，实际响应: ${resp}"
  echo "$resp"
}

# 等 run 关联的最新 GenerationJob 到达 succeeded（fake 生图由 agent 内嵌 Worker 完成）。
# $1=project $2=run_id；超时 150s
wait_job_succeeded() {
  local project="$1" run_id="$2" elapsed=0 row=""
  while [ "$elapsed" -lt 150 ]; do
    row="$(mysql_exec "$project" "SELECT status FROM generation_jobs WHERE agent_run_id=${run_id} ORDER BY id DESC LIMIT 1" | tail -1)"
    [ "$row" = "succeeded" ] && { echo "$row"; return 0; }
    sleep 5; elapsed=$((elapsed + 5))
  done
  fail "run ${run_id} 的 GenerationJob 未在时限内 succeeded，最后状态: ${row:-查询失败}"
}

# 完整业务链路：消息 → 首次 claim(fencing=1, 无 checkpoint) → commit(生图动作) →
# 等 GenerationJob succeeded。诊断输出走 stderr，stdout 只返回 run_id。
# $1=project $2=project_id $3=user_id $4=唯一标记
business_flow_first_round() {
  local project="$1" pid="$2" uid="$3" tag="$4"
  local run_id; run_id="$(post_conversation_message "$project" "$pid" "$uid" "$tag")"
  echo "   公开接口已接纳消息，agent_run_id=${run_id}" >&2

  local claim; claim="$(probe_claim "$project" "${tag}-worker-a")"
  local claimed_run; claimed_run="$(json_get "$claim" data.agent_run_id)"
  local fencing; fencing="$(json_get "$claim" data.fencing_token)"
  local ckpt; ckpt="$(json_get "$claim" data.checkpoint.checkpoint_id)"
  [ "$claimed_run" = "$run_id" ] || fail "首次 claim 应认领 run ${run_id}，实际: ${claim}"
  [ "$fencing" = "1" ] || fail "首次 claim fencing_token 应为 1，实际 ${fencing}"
  [ -z "$ckpt" ] || fail "首轮 claim 不应返回 checkpoint，实际: ${claim}"
  echo "   首次 claim ✓ (fencing=1, 无 checkpoint)" >&2

  probe_commit "$project" "$run_id" "${tag}-worker-a" "$claim" "$tag" >/dev/null
  echo "   首次 commit ✓ (RuntimeCheckpoint + assistant 消息 + fake 生图动作已接纳)" >&2

  wait_job_succeeded "$project" "$run_id" >/dev/null
  echo "   GenerationJob succeeded ✓ (fake 生图闭环)" >&2
  echo "$run_id"
}

TMP_OVERRIDE="$(mktemp /tmp/schema-acc-override.XXXXXX.yml)"
# 当前场景项目名：场景函数入口登记，EXIT trap 兜底清理。
# 覆盖 fail 与 set -e 静默中断两类路径，避免残留栈占用 bw-acc-* 硬编码容器名。
CURRENT_PROJECT=""
cleanup_on_exit() {
  rm -f "$TMP_OVERRIDE"
  if [ "$KEEP_STACK" != "1" ] && [ -n "$CURRENT_PROJECT" ]; then
    docker compose -p "$CURRENT_PROJECT" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" \
      down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup_on_exit EXIT

# ───────────── 场景 1：空库初始化 + 完整业务链路 + 中断恢复 ─────────────
scenario_empty() {
  local project="bw-schema-empty"
  CURRENT_PROJECT="$project"
  echo "🧪 [empty] 空库初始化 + Agent 运行业务链路(project=$project)"
  echo "   down -v 起空卷 → 迁移器应跑 V1→V2→V3→V4→V5→V6，记账本记录版本，表齐全"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" down -v --remove-orphans >/dev/null 2>&1 || true

  start_infra "$project"

  run_migration_ok "$project" "空库" || {
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "空库场景失败"
  }
  assert_migration_baseline "$project"

  # 断言：记账本含 V1、V2、V3、V4、V5、V6；project 表存在；
  # IK1W1M：游标物理列为非保留字 event_cursor，保留字 cursor 列不存在
  local versions; versions="$(mysql_exec "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations' 2>/dev/null | tail -1)"
  local has_project; has_project="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$MYSQL_DB' AND table_name='project'" 2>/dev/null | tail -1)"
  local event_cursor_cols; event_cursor_cols="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$MYSQL_DB' AND table_name IN ('project_events','outbox_messages') AND column_name='event_cursor'" 2>/dev/null | tail -1)"
  local reserved_cols; reserved_cols="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$MYSQL_DB' AND table_name IN ('project_events','outbox_messages') AND column_name='cursor'" 2>/dev/null | tail -1)"

  echo "   记账本版本: $versions"
  echo "   project 表存在: $has_project"
  echo "   event_cursor 列数(期望 2): ${event_cursor_cols}；保留字 cursor 列数(期望 0): $reserved_cols"

  [ "$versions" = "$EXPECTED_VERSIONS" ] || fail "空库：记账本应为 ${EXPECTED_VERSIONS}，实际 $versions"
  [ "$has_project" = "1" ] || fail "空库：project 表应存在"
  [ "$event_cursor_cols" = "2" ] || fail "空库：project_events/outbox_messages 应有 event_cursor 列"
  [ "$reserved_cols" = "0" ] || fail "空库：不应残留保留字 cursor 列"

  # 业务链路：起 agent，经公开接口建 project + 消息，Worker claim/commit
  start_agent "$project"
  local proj_resp; proj_resp="$(agent_curl "$project" POST "/api/projects" \
      -H "Content-Type: application/json" -H "X-User-Id: 1" \
      -d '{"name":"schema-acc-empty"}')"
  local pid; pid="$(json_get "$proj_resp" data.id)"
  [ -n "$pid" ] || fail "创建 project 失败: ${proj_resp}"
  echo "   已通过公开接口创建 project id=${pid}"

  # 第一轮：消息 → claim(f=1) → commit → GenerationJob succeeded（创建与持久化闭环）
  local run_id; run_id="$(business_flow_first_round "$project" "$pid" 1 empty)"

  # 第二轮：创作澄清 → 确认回答 → resumed run 携带来源 checkpoint 恢复
  local run2; run2="$(post_conversation_message "$project" "$pid" 1 empty-clarify)"
  echo "   澄清消息已接纳，agent_run_id=${run2}"
  local claim2; claim2="$(probe_claim "$project" "empty-worker-b")"
  local run2_claimed; run2_claimed="$(json_get "$claim2" data.agent_run_id)"
  [ "$run2_claimed" = "$run2" ] || fail "应认领澄清 run ${run2}，实际: ${claim2}"
  local commit2; commit2="$(probe_commit_clarification "$project" "$run2" "empty-worker-b" "$claim2" "empty-b")"
  local input_request_id; input_request_id="$(json_get "$commit2" data.input_request_id)"
  [ -n "$input_request_id" ] || fail "澄清 commit 未返回 input_request_id: ${commit2}"
  local run2_status; run2_status="$(mysql_exec "$project" "SELECT status FROM agent_runs WHERE id=${run2}" | tail -1)"
  [ "$run2_status" = "awaiting_input" ] || fail "澄清后 run2 应 awaiting_input，实际 ${run2_status}"
  echo "   澄清提议已接纳(input_request_id=${input_request_id})，run2 等待输入 ✓"

  # 用户回答（绑定澄清请求）→ 创建 resumed run3（继承引擎身份）
  local ans_resp; ans_resp="$(agent_curl "$project" POST "/api/projects/${pid}/conversation/messages" \
      -H "Content-Type: application/json" \
      -H "X-User-Id: 1" \
      -H "Idempotency-Key: empty-answer-1" \
      -d "{\"client_message_id\":\"empty-answer-cm-1\",\"content\":\"水彩风格\",\"reply_to_input_request_id\":${input_request_id}}")"
  local run3; run3="$(json_get "$ans_resp" data.agent_run_id)"
  [ -n "$run3" ] || fail "回答消息未创建 resumed run: ${ans_resp}"
  echo "   回答已接纳，resumed run id=${run3}"

  # probe-c claim resumed run：应携带来源流程已接纳的兼容 checkpoint
  local claim3; claim3="$(probe_claim "$project" "empty-worker-c")"
  local run3_claimed; run3_claimed="$(json_get "$claim3" data.agent_run_id)"
  local fencing3; fencing3="$(json_get "$claim3" data.fencing_token)"
  local ckpt3_engine; ckpt3_engine="$(json_get "$claim3" data.checkpoint.engine)"
  local ckpt3_step; ckpt3_step="$(json_get "$claim3" data.checkpoint.opaque_payload.step)"
  [ "$run3_claimed" = "$run3" ] || fail "应认领 resumed run ${run3}，实际: ${claim3}"
  [ "$fencing3" = "1" ] || fail "resumed run 首次 claim fencing 应为 1，实际 ${fencing3}"
  [ "$ckpt3_engine" = "fake" ] || fail "resumed claim 应返回兼容 checkpoint(engine=fake)，实际: ${claim3}"
  [ "$ckpt3_step" = "clarification_proposed" ] || fail "resumed claim 应携带来源 checkpoint(clarification_proposed)，实际: ${claim3}"
  echo "   resumed claim ✓ (携带来源兼容 checkpoint)"

  # 中断恢复：probe-c 中断(不 commit)，租约过期后 probe-d 接管，fencing 递增且 checkpoint 兼容
  echo "   等待租约过期(${LEASE_SECONDS}s)模拟 Worker 中断..."
  sleep "$LEASE_SECONDS"
  local claim4; claim4="$(probe_claim "$project" "empty-worker-d")"
  local run4_claimed; run4_claimed="$(json_get "$claim4" data.agent_run_id)"
  local fencing4; fencing4="$(json_get "$claim4" data.fencing_token)"
  local ckpt4_step; ckpt4_step="$(json_get "$claim4" data.checkpoint.opaque_payload.step)"
  [ "$run4_claimed" = "$run3" ] || fail "接管 claim 应取得同一 run ${run3}，实际: ${claim4}"
  [ "$fencing4" = "2" ] || fail "接管后 fencing_token 应递增为 2，实际 ${fencing4}"
  [ "$ckpt4_step" = "clarification_proposed" ] || fail "接管后应返回同一兼容 checkpoint，实际: ${claim4}"
  echo "   租约接管 ✓ (fencing=2, checkpoint 兼容一致)"
  probe_commit "$project" "$run3" "empty-worker-d" "$claim4" "empty-d" >/dev/null
  wait_job_succeeded "$project" "$run3" >/dev/null
  echo "   接管后 commit ✓ GenerationJob succeeded ✓"

  # 持久化断言：run/checkpoint/提交/消息/幂等/输入请求事实齐全且一致
  local run_total ckpt_dist commit_count msg_counts idem_count uir_row asset_count
  run_total="$(mysql_exec "$project" "SELECT COUNT(*) FROM agent_runs" | tail -1)"
  ckpt_dist="$(mysql_exec "$project" "SELECT GROUP_CONCAT(agent_run_id ORDER BY agent_run_id) FROM runtime_checkpoints" | tail -1)"
  commit_count="$(mysql_exec "$project" "SELECT COUNT(*) FROM run_commits" | tail -1)"
  msg_counts="$(mysql_exec "$project" "SELECT CONCAT(SUM(role='user'), '/', SUM(role='assistant')) FROM conversation_messages" | tail -1)"
  idem_count="$(mysql_exec "$project" "SELECT COUNT(*) FROM command_idempotency" | tail -1)"
  uir_row="$(mysql_exec "$project" "SELECT CONCAT(request_type, ':', status, ':', COALESCE(resumed_agent_run_id, 0)) FROM user_input_requests WHERE id=${input_request_id}" | tail -1)"
  asset_count="$(mysql_exec "$project" "SELECT COUNT(*) FROM assets" | tail -1)"
  echo "   事实: runs=${run_total} checkpoints(run分布)=${ckpt_dist} commits=${commit_count} 消息(u/a)=${msg_counts} 幂等=${idem_count} 输入请求=${uir_row} assets=${asset_count}"
  [ "$run_total" = "3" ] || fail "应有 3 个 AgentRun(首轮/澄清/恢复)，实际 ${run_total}"
  [ "$ckpt_dist" = "${run_id},${run2},${run3}" ] || fail "三个 run 应各有 1 条 checkpoint，实际分布 ${ckpt_dist}"
  [ "$commit_count" = "3" ] || fail "应有 3 条 RunCommit，实际 ${commit_count}"
  [ "$msg_counts" = "3/3" ] || fail "消息应为 3 user + 3 assistant，实际 ${msg_counts}"
  [ "$idem_count" = "3" ] || fail "应有 3 条幂等接纳记录，实际 ${idem_count}"
  [ "$uir_row" = "creation_clarification:consumed:${run3}" ] || fail "输入请求应已消费并绑定 resumed run，实际 ${uir_row}"
  [ "$asset_count" -ge 1 ] || fail "fake 生图应产出 asset，实际 ${asset_count}"

  # 公开读取（Snapshot）观察一致状态
  local snap; snap="$(agent_curl "$project" GET "/api/projects/${pid}/snapshot" -H "X-User-Id: 1")"
  local snap_code; snap_code="$(json_get "$snap" code)"
  [ "$snap_code" = "200" ] || fail "Snapshot 公开读取应 code=200，实际: ${snap}"
  echo "   Snapshot 公开读取一致 ✓"

  # 迁移幂等重跑：不新增版本、不改运行数据
  run_migration_ok "$project" "空库幂等重跑" || fail "空库幂等重跑迁移失败"
  local versions2 ckpt2
  versions2="$(mysql_exec "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations' | tail -1)"
  ckpt2="$(mysql_exec "$project" "SELECT COUNT(*) FROM runtime_checkpoints" | tail -1)"
  [ "$versions2" = "$EXPECTED_VERSIONS" ] || fail "重跑后记账本应仍为 ${EXPECTED_VERSIONS}，实际 ${versions2}"
  [ "$ckpt2" = "3" ] || fail "重跑后 checkpoint 数不应变化，实际 ${ckpt2}"
  echo "   迁移幂等重跑 ✓ (版本与运行数据不变)"

  # 负路径（IK1W1J AC4）：checkpoint 与 Run 引擎身份不兼容时 fail-closed，
  # 不得自动回退旧 checkpoint。篡改来源 run 的 checkpoint 版本号后，
  # resumed run 的 claim 必须被拒绝且 run 被隔离。
  local run5; run5="$(post_conversation_message "$project" "$pid" 1 empty-neg)"
  local claim5; claim5="$(probe_claim "$project" "empty-worker-e")"
  probe_commit_clarification "$project" "$run5" "empty-worker-e" "$claim5" "empty-e" >/dev/null
  mysql_exec "$project" "UPDATE runtime_checkpoints SET engine_version='broken-9.9' WHERE agent_run_id=${run5}" >/dev/null
  local ir5; ir5="$(mysql_exec "$project" "SELECT id FROM user_input_requests WHERE source_agent_run_id=${run5}" | tail -1)"
  local ans5; ans5="$(agent_curl "$project" POST "/api/projects/${pid}/conversation/messages" \
      -H "Content-Type: application/json" \
      -H "X-User-Id: 1" \
      -H "Idempotency-Key: empty-neg-answer-1" \
      -d "{\"client_message_id\":\"empty-neg-answer-cm-1\",\"content\":\"水彩风格\",\"reply_to_input_request_id\":${ir5}}")"
  local run6; run6="$(json_get "$ans5" data.agent_run_id)"
  [ -n "$run6" ] || fail "负路径：回答消息未创建 resumed run: ${ans5}"
  local claim6; claim6="$(probe_claim "$project" "empty-worker-f")"
  local code6; code6="$(json_get "$claim6" code)"
  local run6_status; run6_status="$(mysql_exec "$project" "SELECT status FROM agent_runs WHERE id=${run6}" | tail -1)"
  [ "$code6" != "200" ] || fail "负路径：不兼容 checkpoint 的 claim 应被拒绝，实际: ${claim6}"
  [ "$run6_status" = "recovery_failed" ] || fail "负路径：run 应被隔离为 recovery_failed，实际 ${run6_status}"
  echo "   负路径：不兼容 checkpoint fail-closed ✓ (claim 拒绝 + run 隔离，不回退旧 checkpoint)"

  echo "✅ [empty] 空库初始化 + 业务链路 + 中断恢复通过"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 2：旧库保数据升级（迁移器引入前的完整库，V6 幂等 no-op） ─────────────
scenario_upgrade() {
  local project="bw-schema-upgrade"
  CURRENT_PROJECT="$project"
  echo "🧪 [upgrade] 旧库保数据升级(project=$project)"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true

  write_fixture_override "$FIXTURE_DIR/old-baseline.sql"
  start_infra "$project" "$TMP_OVERRIDE"

  local old_rows; old_rows="$(mysql_exec "$project" 'SELECT COUNT(*) FROM project' | tail -1)"
  echo "   旧库 project 行数(升级前): $old_rows"
  [ "$old_rows" = "2" ] || fail "夹具未正确注入旧库数据(期望 2 行，实际 $old_rows)"

  run_migration_ok "$project" "旧库升级" || {
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "旧库升级场景失败"
  }
  assert_migration_baseline "$project"

  # 断言：记账本含 V1、V2、V3、V4、V5、V6(补记 V1 + 跑 V2/V3/V4/V5/V6)；既有 2 行数据保留；V2 seed 追加；
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

  [ "$versions" = "$EXPECTED_VERSIONS" ] || fail "旧库：记账本应为 ${EXPECTED_VERSIONS}(补记 V1+V2/V3/V4/V5/V6)，实际 $versions"
  [ "$preserved" = "2" ] || fail "旧库：既有数据未保留(期望 2 行，实际 $preserved)"
  [ "$events" = "evt_old_1/1,evt_old_2/2,evt_old_3/3" ] || fail "旧库：事件游标值或顺序未保留，实际 $events"
  [ "$outbox" = "evt_old_1/1/pending/2/2030-01-02 03:04:05,evt_old_2/2/published/0/null,evt_old_3/3/pending/1/2030-02-03 04:05:06" ] \
    || fail "旧库：Outbox 身份/状态/重试元数据未保留，实际 $outbox"
  [ "$reserved_cols" = "0" ] || fail "旧库：不应残留保留字 cursor 列"

  echo "✅ [upgrade] 旧库保数据升级通过(V6 幂等 no-op)"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 3：pre-Agent 旧库补齐 Agent 运行表（IK1W1J） ─────────────
scenario_pre_agent() {
  local project="bw-schema-pre-agent"
  CURRENT_PROJECT="$project"
  echo "🧪 [pre-agent] pre-Agent 旧库升级补齐 Agent 表(project=$project)"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true

  write_fixture_override "$FIXTURE_DIR/pre-agent-baseline.sql"
  start_infra "$project" "$TMP_OVERRIDE"

  # 升级前确认：缺全部 Agent 表，无记账本
  local before_tables; before_tables="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${MYSQL_DB}' AND table_name IN (${AGENT_TABLES})" | tail -1)"
  echo "   升级前 Agent 运行表数(期望 0): ${before_tables}"
  [ "$before_tables" = "0" ] || fail "pre-Agent 夹具不应含 Agent 表，实际 ${before_tables}"

  run_migration_ok "$project" "pre-Agent 旧库" || {
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "pre-Agent 旧库场景失败"
  }
  assert_migration_baseline "$project"

  # 既有 users / project / canvas 数据保留
  local users_kept proj_kept canvas_kept
  users_kept="$(mysql_exec "$project" "SELECT COUNT(*) FROM users WHERE id=8001 AND username='验收旧用户'" | tail -1)"
  proj_kept="$(mysql_exec "$project" "SELECT COUNT(*) FROM project WHERE id IN (9001,9002) AND owner_id=8001" | tail -1)"
  canvas_kept="$(mysql_exec "$project" "SELECT COUNT(*) FROM canvas WHERE id IN (9001,9002)" | tail -1)"
  echo "   既有事实保留: users=${users_kept} project=${proj_kept} canvas=${canvas_kept}"
  [ "$users_kept" = "1" ] && [ "$proj_kept" = "2" ] && [ "$canvas_kept" = "2" ] \
    || fail "既有 User/Project/Canvas 数据未完整保留(${users_kept}/${proj_kept}/${canvas_kept})"

  # 升级后业务链路可用（IK1W1J 核心验收）
  start_agent "$project"
  local run_id; run_id="$(business_flow_first_round "$project" 9001 8001 preagent)"

  # 公开读取（Snapshot）观察一致状态
  local snap; snap="$(agent_curl "$project" GET "/api/projects/9001/snapshot" -H "X-User-Id: 8001")"
  local snap_code; snap_code="$(json_get "$snap" code)"
  [ "$snap_code" = "200" ] || fail "Snapshot 公开读取应 code=200，实际: ${snap}"
  echo "   Snapshot 公开读取一致 ✓"

  # 迁移幂等重跑：不新增版本、不改运行数据、不动当前检查点指针
  local ckpt_before; ckpt_before="$(mysql_exec "$project" "SELECT current_checkpoint_id FROM agent_runs WHERE id=${run_id}" | tail -1)"
  run_migration_ok "$project" "pre-Agent 幂等重跑" || fail "pre-Agent 幂等重跑迁移失败"
  local versions2 rows_after ckpt_after
  versions2="$(mysql_exec "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations' | tail -1)"
  rows_after="$(mysql_exec "$project" "SELECT CONCAT((SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM project),(SELECT COUNT(*) FROM conversation_messages))" | tail -1)"
  ckpt_after="$(mysql_exec "$project" "SELECT current_checkpoint_id FROM agent_runs WHERE id=${run_id}" | tail -1)"
  [ "$versions2" = "$EXPECTED_VERSIONS" ] || fail "重跑后记账本应仍为 ${EXPECTED_VERSIONS}，实际 ${versions2}"
  [ "$rows_after" = "122" ] || fail "重跑后业务行数不应变化(users1+project2+消息2)，实际 ${rows_after}"
  [ "$ckpt_after" = "$ckpt_before" ] || fail "重跑后当前检查点指针不应变化(${ckpt_before}→${ckpt_after})"
  echo "   迁移幂等重跑 ✓ (版本/数据/检查点指针不变)"

  echo "✅ [pre-agent] pre-Agent 旧库升级通过"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 4：部分历史 Agent 一次性迁移库收敛（IK1W1J） ─────────────
scenario_partial() {
  local project="bw-schema-partial"
  CURRENT_PROJECT="$project"
  echo "🧪 [partial] 部分历史 Agent 库升级收敛(project=$project)"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true

  write_fixture_override "$FIXTURE_DIR/partial-agent.sql"
  start_infra "$project" "$TMP_OVERRIDE"

  # 升级前确认历史形态：缺 confirmed_input_request_id 等列
  local missing_col; missing_col="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${MYSQL_DB}' AND TABLE_NAME='agent_runs' AND COLUMN_NAME='confirmed_input_request_id'" | tail -1)"
  echo "   升级前 agent_runs.confirmed_input_request_id 存在(期望 0): ${missing_col}"
  [ "$missing_col" = "0" ] || fail "partial 夹具应为历史形态(缺列)"

  run_migration_ok "$project" "部分历史 Agent 库" || {
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "部分历史 Agent 库场景失败"
  }
  assert_migration_baseline "$project"

  # 收敛断言：缺列补齐、旧 NOT NULL 放宽、request_type 默认值回填
  local col_added job_nullable idem_nullable uir_row
  col_added="$(mysql_exec "$project" "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${MYSQL_DB}' AND TABLE_NAME='agent_runs' AND COLUMN_NAME='confirmed_input_request_id'" | tail -1)"
  job_nullable="$(mysql_exec "$project" "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${MYSQL_DB}' AND TABLE_NAME='run_commits' AND COLUMN_NAME='generation_job_id'" | tail -1)"
  idem_nullable="$(mysql_exec "$project" "SELECT GROUP_CONCAT(IS_NULLABLE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${MYSQL_DB}' AND TABLE_NAME='command_idempotency' AND COLUMN_NAME IN ('message_id','agent_run_id')" | tail -1)"
  uir_row="$(mysql_exec "$project" "SELECT CONCAT(id, ':', status, ':', request_type) FROM user_input_requests WHERE id=9701" | tail -1)"
  echo "   收敛: confirmed_input_request_id=${col_added} generation_job_id可空=${job_nullable} 幂等两列可空=${idem_nullable} 输入请求=${uir_row}"
  [ "$col_added" = "1" ] || fail "agent_runs.confirmed_input_request_id 未补齐"
  [ "$job_nullable" = "YES" ] || fail "run_commits.generation_job_id 未放宽为可空"
  [ "$idem_nullable" = "YES,YES" ] || fail "command_idempotency.message_id/agent_run_id 未放宽为可空"
  [ "$uir_row" = "9701:consumed:cost_confirmation" ] || fail "既有输入请求被改动或未回填 request_type: ${uir_row}"

  # 既有运行数据不丢不重：逐行核对标识与关键值
  local run_row ckpt_row commit_row msg_ids idem_row
  run_row="$(mysql_exec "$project" "SELECT CONCAT(id, ',', status, ',', current_checkpoint_id, ',', fencing_token, ',', version) FROM agent_runs WHERE id=9101" | tail -1)"
  ckpt_row="$(mysql_exec "$project" "SELECT CONCAT(id, ',', agent_run_id, ',', payload_digest) FROM runtime_checkpoints WHERE id=9201" | tail -1)"
  commit_row="$(mysql_exec "$project" "SELECT CONCAT(id, ',', commit_id, ',', generation_job_id) FROM run_commits WHERE id=9301" | tail -1)"
  msg_ids="$(mysql_exec "$project" "SELECT GROUP_CONCAT(id ORDER BY id) FROM conversation_messages WHERE id IN (9601,9602)" | tail -1)"
  idem_row="$(mysql_exec "$project" "SELECT CONCAT(id, ',', idempotency_key) FROM command_idempotency WHERE id=9501" | tail -1)"
  echo "   既有运行数据: run[${run_row}] ckpt[${ckpt_row}] commit[${commit_row}] msg[${msg_ids}] idem[${idem_row}]"
  [ "$run_row" = "9101,completed,9201,2,5" ] || fail "既有 AgentRun 被改动: ${run_row}"
  [ "$ckpt_row" = "9201,9101,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ] || fail "既有 Checkpoint 被改动: ${ckpt_row}"
  [ "$commit_row" = "9301,legacy-commit-1,9401" ] || fail "既有 RunCommit 被改动: ${commit_row}"
  [ "$msg_ids" = "9601,9602" ] || fail "既有消息被改动: ${msg_ids}"
  [ "$idem_row" = "9501,legacy-key-1" ] || fail "既有幂等记录被改动: ${idem_row}"

  # 升级后业务链路可用
  start_agent "$project"
  business_flow_first_round "$project" 9001 8001 partial >/dev/null
  echo "   升级后业务链路(消息→claim→commit→重新入队) ✓"

  echo "✅ [partial] 部分历史 Agent 库升级收敛通过"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 5：未知漂移失败 ─────────────
scenario_drift() {
  local project="bw-schema-drift"
  CURRENT_PROJECT="$project"
  echo "🧪 [drift] 未知漂移失败(project=$project)"
  echo "   注入坏夹具(记账本谎称 V1 但缺 project 表)→ 迁移失败、业务服务不启动"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true

  write_fixture_override "$FIXTURE_DIR/drift.sql"
  start_infra "$project" "$TMP_OVERRIDE"

  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up blue-whale-schema-migration >/dev/null 2>&1 &
  local code; code="$(wait_migration_done ${CTR_PREFIX}-schema-migration)"

  if [ "$code" = "0" ]; then
    echo "❌ 漂移场景：迁移本应失败但 exit=0"
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "漂移场景：迁移应 fail-closed 但成功了"
  fi

  echo "   迁移容器 exit=$code(期望非 0)✓"

  # 断言：user/agent 因 depends_on 门禁从未启动
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up -d blue-whale-user blue-whale-agent >/dev/null 2>&1 || true
  sleep 5
  local user_st; user_st="$(container_state ${CTR_PREFIX}-user)"
  local agent_st; agent_st="$(container_state ${CTR_PREFIX}-agent)"
  echo "   user 容器状态: $user_st(期望非 running/healthy)"
  echo "   agent 容器状态: $agent_st(期望非 running/healthy)"

  case "$user_st" in running|healthy) fail "漂移：user 不应启动但状态=$user_st" ;; esac
  case "$agent_st" in running|healthy) fail "漂移：agent 不应启动但状态=$agent_st" ;; esac

  echo "✅ [drift] 未知漂移失败通过(fail-closed 门禁生效)"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 场景 6：Agent 结构未知漂移失败（IK1W1J） ─────────────
scenario_drift_agent() {
  local project="bw-schema-drift-agent"
  CURRENT_PROJECT="$project"
  echo "🧪 [drift-agent] Agent 结构未知漂移失败(project=$project)"
  echo "   注入漂移夹具(agent_runs.id 类型漂移 + fencing_token 可空性漂移)→ V6 契约断言失败并输出结构原因"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true

  write_fixture_override "$FIXTURE_DIR/agent-drift.sql"
  start_infra "$project" "$TMP_OVERRIDE"

  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up blue-whale-schema-migration >/dev/null 2>&1 &
  local code; code="$(wait_migration_done ${CTR_PREFIX}-schema-migration)"

  if [ "$code" = "0" ]; then
    echo "❌ drift-agent：迁移本应失败但 exit=0"
    [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
    fail "drift-agent：迁移应 fail-closed 但成功了"
  fi
  echo "   迁移容器 exit=$code(期望非 0)✓"

  # 断言：日志输出具体结构原因（V6 契约断言违规详情），记账本记录 V6 failed
  local mig_logs; mig_logs="$(docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs blue-whale-schema-migration 2>&1)"
  echo "$mig_logs" | grep -q "V6_CONTRACT_VIOLATION" \
    || { echo "$mig_logs" | tail -15; fail "迁移日志应含 V6_CONTRACT_VIOLATION 结构原因"; }
  echo "$mig_logs" | grep -o "V6_CONTRACT_VIOLATION \[[^]]*" | head -1 | sed 's/^/   结构原因: /'
  local v6_status; v6_status="$(mysql_exec "$project" 'SELECT status FROM schema_migrations WHERE version=6' | tail -1)"
  [ "$v6_status" = "0" ] || fail "记账本 V6 应记录 failed(status=0)，实际 ${v6_status}"
  echo "   记账本 V6=failed ✓"

  # 断言：agent 因 depends_on 门禁从未启动
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up -d blue-whale-agent >/dev/null 2>&1 || true
  sleep 5
  local agent_st; agent_st="$(container_state ${CTR_PREFIX}-agent)"
  echo "   agent 容器状态: ${agent_st}(期望非 running/healthy)"
  case "$agent_st" in running|healthy) fail "drift-agent：agent 不应启动但状态=${agent_st}" ;; esac

  echo "✅ [drift-agent] Agent 结构未知漂移失败通过(输出结构原因 + 门禁生效)"
  [ "$KEEP_STACK" = "1" ] || docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" -f "$TMP_OVERRIDE" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ───────────── 执行 ─────────────
echo "🚀 Schema 迁移验收(场景: ${SCENARIOS[*]})"
for s in "${SCENARIOS[@]}"; do
  case "$s" in
    empty) scenario_empty ;;
    upgrade) scenario_upgrade ;;
    pre-agent) scenario_pre_agent ;;
    partial) scenario_partial ;;
    drift) scenario_drift ;;
    drift-agent) scenario_drift_agent ;;
  esac
done

echo ""
echo "✅ Schema 迁移验收全部通过(${#SCENARIOS[@]} 个场景)"
