#!/usr/bin/env bash
# 模板推荐链路验收(IK1W1K)——真实 MySQL，覆盖 Agent Brief 验收标准：
#
#   1. empty    空库初始化：迁移器跑 V1→V2→V3→V4→V5，模板表（V5）获得公共持久化字段
#               （gmt_create/gmt_modified/version/is_delete，旧列已删），
#               32 卡片 + 96 图片种子就位、每个有效标签非空；
#               随后启动 agent 验证任一有效标签的分页公开 API：
#               HTTP 成功 + 业务 code=200 + 稳定 PageVo 字段 + 首页记录非空按 sort_order 排序；
#               再经 login→gateway 验证已登录 User 消费面链路返回非空结果；
#               最后注入意外数据库异常（DROP template_card_image）验证：
#               公开响应仍是统一「服务暂时不可用」（不泄漏底层原因），
#               服务端日志含底层数据库原因 + 与响应 X-Request-Id 一致的 Request ID。
#   2. upgrade  旧库保数据升级：夹具=旧字段结构 + 既有 32 卡片/96 图片。
#               升级后既有记录、主键(1..32)、图片关联全部保留，旧列值已搬入新列；
#               再次执行迁移容器（幂等重跑）数量不变；agent 分页 API 返回既有数据。
#   3. backfill 缺模板数据的旧库：夹具仅 old-baseline（旧字段结构、0 模板）。
#               升级后补齐 32/96 种子；重复执行迁移不产生重复模板或图片。
#
# 三个场景各自独立 Compose 项目(bw-template-*)，结束 down -v 清理，可重复执行。
# 复用 deploy/local/docker-compose.yml + .acceptance.yml 基础设施与镜像。
#
# 用法：
#   scripts/run-template-acceptance.sh              跑全部三个场景
#   scripts/run-template-acceptance.sh empty        只跑空库+API+异常注入场景
#   scripts/run-template-acceptance.sh upgrade      只跑旧库保数据升级场景
#   scripts/run-template-acceptance.sh backfill     只跑缺数据旧库补种子场景
#   scripts/run-template-acceptance.sh --keep-stack 调试：结束后保留最后一个栈
#
# 前置：:acceptance 镜像需已用当前源码构建（scripts/run-mvp-acceptance.sh 会构建；
# 或 docker compose -p bw-mvp-acceptance -f deploy/local/docker-compose.yml
#   -f deploy/local/docker-compose.acceptance.yml build blue-whale-agent）。
# 本脚本不重新构建镜像（聚焦验证迁移与模板链路）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE="$ROOT/deploy/local/docker-compose.yml"
COMPOSE_ACC="$ROOT/deploy/local/docker-compose.acceptance.yml"
SCHEMA_FIXTURE_DIR="$ROOT/deploy/local/acceptance/schema-migration/fixtures"
TEMPLATE_FIXTURE_DIR="$ROOT/deploy/local/acceptance/template/fixtures"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_DB="${MYSQL_DB:-blue_whale}"
KEEP_STACK=0
SCENARIOS=()

# 模板种子基线事实（与 V5 / data.sql 内容一致）
EXPECT_CARD_TOTAL=32
EXPECT_IMAGE_TOTAL=96
ALL_TAGS="marketing short replicate social image"
FIRST_MARKETING_TITLE='为这款产品创作一条 UGC 广告'
FIRST_MARKETING_IMAGE='https://dj5nb01yl89hl.cloudfront.net/media/images/FE_KPAFDu3_1pSmz.webp'

fail() { echo "❌ template-acceptance: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
模板推荐链路验收(IK1W1K)—— 用法：

  scripts/run-template-acceptance.sh              全部三个场景
  scripts/run-template-acceptance.sh empty        空库初始化 + 分页 API + 异常注入
  scripts/run-template-acceptance.sh upgrade      旧库保数据升级 + 幂等重跑 + API
  scripts/run-template-acceptance.sh backfill     缺模板数据旧库补种子
  scripts/run-template-acceptance.sh --keep-stack 调试：保留最后一个栈

前置：:acceptance 镜像需已用当前源码构建（见文件头注释）。
EOF
}

for arg in "$@"; do
  case "$arg" in
    empty|upgrade|backfill) SCENARIOS+=("$arg") ;;
    --keep-stack) KEEP_STACK=1 ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage; fail "未知参数：$arg" ;;
  esac
done
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(empty upgrade backfill)

command -v docker >/dev/null || fail "未找到 docker"
command -v python3 >/dev/null || fail "未找到 python3（API 响应断言需要）"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 不可用"

# 写临时 fixture override：给 MySQL 挂载指定夹具到 initdb.d（按目标文件名序执行）
# 参数：$1 = old-baseline 夹具绝对路径；$2 = 可选第二夹具绝对路径（旧模板数据）
write_fixture_override() {
  local baseline="$1" extra="${2:-}"
  cat > "$TMP_OVERRIDE" <<EOF
services:
  mysql:
    volumes:
      - mysql-data:/var/lib/mysql
      - ${baseline}:/docker-entrypoint-initdb.d/01-old-baseline.sql:ro
EOF
  if [ -n "$extra" ]; then
    cat >> "$TMP_OVERRIDE" <<EOF
      - ${extra}:/docker-entrypoint-initdb.d/02-template-old-seed.sql:ro
EOF
  fi
}

# 在指定项目的 MySQL 容器里执行 SQL，返回结果
mysql_exec() {
  local project="$1" sql="$2"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" \
    exec -T mysql mysql -u"$MYSQL_USER" -pblue_whale "$MYSQL_DB" -e "$sql" 2>/dev/null
}

# 单值查询（取结果最后一行，规避 mysql 警告输出）
mysql_scalar() {
  mysql_exec "$1" "$2" | tail -1
}

# 启动基础设施（mysql + redis + nacos）并等待健康。
# $1 = project；$2 = 可选额外 override 文件（fixture 挂载用）
start_infra() {
  local project="$1" extra="${2:-}"
  local files=(-f "$COMPOSE_BASE" -f "$COMPOSE_ACC")
  [ -n "$extra" ] && files+=(-f "$extra")
  docker compose -p "$project" "${files[@]}" up -d mysql redis nacos >/dev/null
  for c in bw-acc-mysql bw-acc-redis bw-acc-nacos; do
    wait_healthy "$c" 50 || fail "基础设施 $c 未健康"
  done
}

container_exit_code() {
  docker inspect -f '{{.State.ExitCode}}' "$1" 2>/dev/null || echo "-1"
}

container_state() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo "missing"
}

# 轮询等待容器进入 healthy，成功返回 0、超时返回 1（失败处理由调用方负责）。
# $1 = 容器名；$2 = 最大尝试次数（默认 50，每轮 sleep 3s）
wait_healthy() {
  local container="$1" tries="${2:-50}"
  for _ in $(seq 1 "$tries"); do
    [ "$(container_state "$container")" = "healthy" ] && return 0
    sleep 3
  done
  return 1
}

# 场景开始前的预清理（忽略 KEEP_STACK；override 为空时不挂载）
pre_clean() {
  local project="$1"
  local files=(-f "$COMPOSE_BASE" -f "$COMPOSE_ACC")
  [ -s "$TMP_OVERRIDE" ] && files+=(-f "$TMP_OVERRIDE")
  docker compose -p "$project" "${files[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}

# 跑一次迁移容器并断言 exit 0；失败打印日志并按场景清理。
# 用 StartedAt 变化判定「新一次运行」，避免重复执行时读到旧容器的 exited 状态。
# $1 = project；$2 = 场景名（用于错误信息）
run_migration() {
  local project="$1" scene="$2"
  local before; before="$(docker inspect -f '{{.State.StartedAt}}' bw-acc-schema-migration 2>/dev/null || echo none)"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up blue-whale-schema-migration >/dev/null 2>&1 &
  local deadline=180 elapsed=0 code=""
  while [ "$elapsed" -lt "$deadline" ]; do
    local started; started="$(docker inspect -f '{{.State.StartedAt}}' bw-acc-schema-migration 2>/dev/null || echo none)"
    if [ "$started" != "$before" ] && [ "$(container_state bw-acc-schema-migration)" = "exited" ]; then
      code="$(container_exit_code bw-acc-schema-migration)"
      break
    fi
    sleep 3; elapsed=$((elapsed + 3))
  done
  if [ "$code" != "0" ]; then
    echo "❌ $scene：迁移失败(exit=${code:-timeout})"
    docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs blue-whale-schema-migration 2>&1 | tail -30
    cleanup_project "$project"
    fail "$scene 迁移失败"
  fi
}

# 启动 agent 并等待健康（模板分页 API 验证用）
start_agent() {
  local project="$1"
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up -d blue-whale-agent >/dev/null
  if ! wait_healthy bw-acc-agent 100; then
    docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs blue-whale-agent 2>&1 | tail -30
    cleanup_project "$project"
    fail "agent 未进入健康状态"
  fi
}

# 经 agent 容器内 curl 访问模板分页 API（agent 镜像自带 curl）。
# $1 = project；$2 = tagCode；额外 curl 参数经 $3+ 传入
agent_curl() {
  local project="$1" tag="$2"; shift 2
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" \
    exec -T blue-whale-agent curl -s "$@" \
    "http://localhost:8082/api/agent/templates/page?tagCode=${tag}&page=1&size=10"
}

cleanup_project() {
  local project="$1"
  [ "$KEEP_STACK" = "1" ] && return 0
  local files=(-f "$COMPOSE_BASE" -f "$COMPOSE_ACC")
  [ -s "$TMP_OVERRIDE" ] && files+=(-f "$TMP_OVERRIDE")
  docker compose -p "$project" "${files[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}

# ── 公共断言 ──

# 记账本为 1,2,3,4,5 且全部 applied（V1 基线 / V2 Skill seed / V3 游标 IK1W1M / V4 生成任务资产 IK1W1L / V5 模板 IK1W1K）
assert_ledger() {
  local project="$1" versions
  versions="$(mysql_scalar "$project" 'SELECT GROUP_CONCAT(version ORDER BY version) FROM schema_migrations WHERE status=1')"
  [ "$versions" = "1,2,3,4,5" ] || fail "记账本应为 1,2,3,4,5(applied)，实际 $versions"
  echo "   记账本版本: $versions ✓"
}

# 模板两表结构：新公共字段齐全、旧审计列已删、逻辑身份唯一键存在
assert_template_schema() {
  local project="$1" t
  for t in template_card template_card_image; do
    local new_cols old_cols
    new_cols="$(mysql_scalar "$project" "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$MYSQL_DB' AND TABLE_NAME='$t' AND COLUMN_NAME IN ('gmt_create','gmt_modified','version','is_delete')")"
    old_cols="$(mysql_scalar "$project" "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$MYSQL_DB' AND TABLE_NAME='$t' AND COLUMN_NAME IN ('create_time','update_time','deleted')")"
    [ "$new_cols" = "4" ] || fail "$t 应有 4 个公共持久化字段，实际 $new_cols"
    [ "$old_cols" = "0" ] || fail "$t 旧审计列应已删除，实际残留 $old_cols"
  done
  local uk_card uk_image
  uk_card="$(mysql_scalar "$project" "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$MYSQL_DB' AND TABLE_NAME='template_card' AND INDEX_NAME='uk_template_card_tag_title'")"
  uk_image="$(mysql_scalar "$project" "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$MYSQL_DB' AND TABLE_NAME='template_card_image' AND INDEX_NAME='uk_template_card_image_card_sort'")"
  [ "$uk_card" = "1" ] || fail "template_card 缺唯一键 uk_template_card_tag_title"
  [ "$uk_image" = "1" ] || fail "template_card_image 缺唯一键 uk_template_card_image_card_sort"
  echo "   结构：两表公共字段齐全、旧列已删、唯一键就位 ✓"
}

# 种子数量：32 卡片 / 96 图片，每个有效标签非空（精确计数）
assert_seed_counts() {
  local project="$1" cards images
  cards="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card')"
  images="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card_image')"
  [ "$cards" = "$EXPECT_CARD_TOTAL" ] || fail "卡片应为 $EXPECT_CARD_TOTAL，实际 $cards"
  [ "$images" = "$EXPECT_IMAGE_TOTAL" ] || fail "图片应为 $EXPECT_IMAGE_TOTAL，实际 $images"
  local tag cnt
  for tag in $ALL_TAGS; do
    cnt="$(mysql_scalar "$project" "SELECT COUNT(*) FROM template_card WHERE tag_code='$tag'")"
    [ "$cnt" -ge 1 ] || fail "标签 $tag 应至少有 1 张卡片，实际 0"
    echo "   标签 $tag: $cnt 张卡片 ✓"
  done
  echo "   种子：$cards 卡片 / $images 图片 ✓"
}

# 分页 API 基础断言：HTTP 200、code=200、PageVo 字段稳定、首页记录非空
# $1 = project；$2 = tagCode
assert_api_page_ok() {
  local project="$1" tag="$2" resp body http_code
  resp="$(agent_curl "$project" "$tag" -w $'\n%{http_code}')"
  http_code="$(printf '%s' "$resp" | tail -1)"
  body="$(printf '%s' "$resp" | sed '$d')"
  [ "$http_code" = "200" ] || fail "标签 $tag 分页 API HTTP 状态应为 200，实际 $http_code"
  [ -n "$body" ] || fail "标签 $tag 分页 API 无响应体"
  python3 - "$body" "$tag" <<'PY' || fail "标签 $2 分页 API 断言失败"
import json, sys
d = json.loads(sys.argv[1])
tag = sys.argv[2]
assert d.get("code") == 200, f"[{tag}] code={d.get('code')}"
data = d.get("data") or {}
for f in ("records", "total", "current", "size", "pages"):
    assert f in data, f"[{tag}] PageVo 缺字段 {f}"
assert data["current"] == 1 and data["size"] == 10, f"[{tag}] 分页回显异常: {data}"
assert data["total"] >= 1 and data["pages"] >= 1, f"[{tag}] total/pages 异常: {data}"
assert len(data["records"]) >= 1, f"[{tag}] 首页记录为空"
first = data["records"][0]
for f in ("title", "video", "images", "layout"):
    assert f in first, f"[{tag}] TemplateCardDto 缺字段 {f}"
assert len(first["images"]) >= 1, f"[{tag}] 首条记录图片为空"
PY
  echo "   API tag=$tag: HTTP 200、code=200、分页字段稳定、首页非空 ✓"
}

# 首页排序契约：marketing 首条 = sort_order 0 的卡片，图片按 sort_order 排序
assert_api_first_record() {
  local project="$1" body
  body="$(agent_curl "$project" marketing)"
  python3 - "$body" "$FIRST_MARKETING_TITLE" "$FIRST_MARKETING_IMAGE" <<'PY' || fail "首页排序契约断言失败"
import json, sys
d = json.loads(sys.argv[1])
first = d["data"]["records"][0]
assert first["title"] == sys.argv[2], f"首条标题={first['title']!r}，应为 sort_order 0 卡片"
assert first["images"][0] == sys.argv[3], f"首图={first['images'][0]!r}，图片未按 sort_order 排序"
PY
  echo "   API 排序契约：首条=sort_order 0 卡片、图片按序 ✓"
}

TMP_OVERRIDE="$(mktemp /tmp/template-acc-override.XXXXXX.yml)"
trap 'rm -f "$TMP_OVERRIDE"' EXIT

# ───────────── 场景 1：空库初始化 + 分页 API + 异常注入 ─────────────
scenario_empty() {
  local project="bw-template-empty"
  echo "🧪 [1/3] 空库初始化 + 分页 API + 异常注入(project=$project)"
  pre_clean "$project"

  start_infra "$project"
  run_migration "$project" "空库场景"

  assert_ledger "$project"
  assert_template_schema "$project"
  assert_seed_counts "$project"

  # 分页公开 API：任一有效标签 HTTP 成功 + 业务成功 + 稳定分页结构 + 首页非空
  start_agent "$project"
  local tag
  for tag in $ALL_TAGS; do
    assert_api_page_ok "$project" "$tag"
  done
  assert_api_first_record "$project"

  # 网关级已登录链路（首页/生成页消费面视角）：login 取 JWT → 经网关访问分页 API
  echo "   验证网关级已登录链路(login → gateway → agent)..."
  docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" up -d blue-whale-user blue-whale-gateway >/dev/null
  local svc
  for svc in bw-acc-user bw-acc-gateway; do
    if ! wait_healthy "$svc" 100; then
      docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs "$svc" 2>&1 | tail -20
      cleanup_project "$project"
      fail "$svc 未进入健康状态"
    fi
  done
  local login_resp token gw_body
  login_resp="$(curl -s -X POST http://localhost:8786/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"phone":"15079999999","code":"123456"}')"
  token="$(printf '%s' "$login_resp" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])' 2>/dev/null)"
  [ -n "$token" ] || fail "网关登录未取到 access_token：$login_resp"
  gw_body="$(curl -s "http://localhost:8786/api/agent/templates/page?tagCode=marketing&page=1&size=10" \
    -H "Authorization: Bearer $token")"
  python3 - "$gw_body" <<'PY' || fail "网关级分页 API 断言失败"
import json, sys
d = json.loads(sys.argv[1])
assert d.get("code") == 200, f"code={d.get('code')}，已登录链路应业务成功"
data = d.get("data") or {}
assert data.get("total", 0) >= 1 and len(data.get("records", [])) >= 1, "已登录链路首页记录为空"
PY
  echo "   网关级已登录链路：分页 API 返回非空结果 ✓"

  # 异常注入：DROP 图片表 → 意外数据库异常
  echo "   注入意外数据库异常(DROP TABLE template_card_image)..."
  mysql_exec "$project" 'DROP TABLE template_card_image' >/dev/null

  local raw normalized status_line rid body
  raw="$(agent_curl "$project" marketing -i)"
  normalized="$(printf '%s' "$raw" | tr -d '\r')"
  status_line="$(printf '%s' "$normalized" | head -1)"
  rid="$(printf '%s' "$normalized" | grep -i '^X-Request-Id:' | head -1 | awk '{print $2}')"
  body="$(printf '%s' "$normalized" | awk 'f{print} /^$/{f=1}')"

  case "$status_line" in
    *" 200"*) ;;
    *) fail "异常注入：HTTP 状态应为 200（统一 Result），实际: $status_line" ;;
  esac
  [ -n "$rid" ] || fail "异常注入：响应缺 X-Request-Id 头"
  python3 - "$body" <<'PY' || fail "异常注入：响应体断言失败"
import json, sys
d = json.loads(sys.argv[1])
assert d.get("code") == 500, f"code={d.get('code')}，应为 500"
assert d.get("msg") == "服务暂时不可用", f"msg={d.get('msg')!r}，应为统一脱敏提示"
assert "template_card_image" not in json.dumps(d, ensure_ascii=False), "响应泄漏了底层数据库细节"
PY

  # 服务端日志：含同一 Request ID + 底层数据库原因
  local logs
  logs="$(docker compose -p "$project" -f "$COMPOSE_BASE" -f "$COMPOSE_ACC" logs blue-whale-agent 2>&1)"
  printf '%s' "$logs" | grep -q "requestId=$rid" \
    || fail "异常注入：agent 日志未含请求标识 $rid"
  printf '%s' "$logs" | grep -q "template_card_image" \
    || fail "异常注入：agent 日志未含底层数据库原因(template_card_image)"
  echo "   异常注入：响应统一脱敏(requestId=$rid)，日志含请求标识与底层原因 ✓"

  echo "✅ [1/3] 空库初始化 + 分页 API + 异常注入通过"
  cleanup_project "$project"
}

# ───────────── 场景 2：旧库保数据升级 + 幂等重跑 + API ─────────────
scenario_upgrade() {
  local project="bw-template-upgrade"
  echo "🧪 [2/3] 旧库保数据升级 + 幂等重跑 + API(project=$project)"
  pre_clean "$project"

  # 夹具：旧字段结构（含 project 既有行）+ 旧模板数据（32 卡片/96 图片，旧列）
  write_fixture_override "$SCHEMA_FIXTURE_DIR/old-baseline.sql" "$TEMPLATE_FIXTURE_DIR/template-old-seed.sql"
  start_infra "$project" "$TMP_OVERRIDE"

  # 升级前事实：旧结构 + 32/96 + 无记账本
  local pre_cards pre_images old_col
  pre_cards="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card')"
  pre_images="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card_image')"
  old_col="$(mysql_scalar "$project" "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$MYSQL_DB' AND TABLE_NAME='template_card' AND COLUMN_NAME='create_time'")"
  echo "   升级前: 卡片 $pre_cards / 图片 $pre_images / 旧列 create_time 存在=$old_col"
  { [ "$pre_cards" = "$EXPECT_CARD_TOTAL" ] && [ "$pre_images" = "$EXPECT_IMAGE_TOTAL" ] && [ "$old_col" = "1" ]; } \
    || fail "夹具未正确注入旧库模板数据(32/96/旧结构)"

  run_migration "$project" "旧库升级场景"

  assert_ledger "$project"
  assert_template_schema "$project"

  # 保数据：记录数、主键范围、图片关联原样保留
  local cards images id_min id_max card1_images card1_first_img
  cards="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card')"
  images="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card_image')"
  id_min="$(mysql_scalar "$project" 'SELECT MIN(id) FROM template_card')"
  id_max="$(mysql_scalar "$project" 'SELECT MAX(id) FROM template_card')"
  card1_images="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card_image WHERE card_id=1')"
  card1_first_img="$(mysql_scalar "$project" 'SELECT image_url FROM template_card_image WHERE card_id=1 AND sort_order=0')"
  [ "$cards" = "$EXPECT_CARD_TOTAL" ] || fail "升级后卡片数变了：$cards"
  [ "$images" = "$EXPECT_IMAGE_TOTAL" ] || fail "升级后图片数变了：$images"
  { [ "$id_min" = "1" ] && [ "$id_max" = "32" ]; } || fail "升级后卡片主键范围变了：$id_min..$id_max"
  [ "$card1_images" = "3" ] || fail "卡片 id=1 的图片关联应为 3，实际 $card1_images"
  [ "$card1_first_img" = "$FIRST_MARKETING_IMAGE" ] || fail "卡片 id=1 首图关联变了：$card1_first_img"
  echo "   保数据：32/96 记录、主键 1..32、图片关联原样保留 ✓"

  # 旧列值已搬入新列（无 NULL 审计值、逻辑删除标记保留 0）
  local null_audit bad_delete
  null_audit="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card WHERE gmt_create IS NULL OR gmt_modified IS NULL OR version IS NULL OR is_delete IS NULL')"
  bad_delete="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card WHERE is_delete<>0')"
  [ "$null_audit" = "0" ] || fail "存在未回填的公共字段行：$null_audit"
  [ "$bad_delete" = "0" ] || fail "逻辑删除标记未正确迁移：$bad_delete"
  echo "   旧列值已搬入新列（gmt_create/version/is_delete 全部就位）✓"

  # 幂等：迁移容器重复执行，数量与记账本不变
  run_migration "$project" "旧库升级幂等重跑"
  local cards2 images2
  cards2="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card')"
  images2="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card_image')"
  { [ "$cards2" = "$EXPECT_CARD_TOTAL" ] && [ "$images2" = "$EXPECT_IMAGE_TOTAL" ]; } \
    || fail "迁移重跑后数量变了：卡片 $cards2 / 图片 $images2"
  assert_ledger "$project"
  echo "   幂等重跑：数量不变（32/96）✓"

  # 分页 API 返回既有数据
  start_agent "$project"
  assert_api_page_ok "$project" marketing
  assert_api_first_record "$project"

  echo "✅ [2/3] 旧库保数据升级 + 幂等重跑 + API 通过"
  cleanup_project "$project"
}

# ───────────── 场景 3：缺模板数据的旧库补种子 ─────────────
scenario_backfill() {
  local project="bw-template-backfill"
  echo "🧪 [3/3] 缺模板数据的旧库补种子(project=$project)"
  pre_clean "$project"

  # 夹具仅 old-baseline：旧字段结构、无模板数据
  write_fixture_override "$SCHEMA_FIXTURE_DIR/old-baseline.sql"
  start_infra "$project" "$TMP_OVERRIDE"

  local pre_cards
  pre_cards="$(mysql_scalar "$project" 'SELECT COUNT(*) FROM template_card')"
  [ "$pre_cards" = "0" ] || fail "夹具应为 0 模板数据，实际 $pre_cards"
  echo "   升级前: 模板 0 张（缺数据旧库）✓"

  run_migration "$project" "补种子场景"

  assert_ledger "$project"
  assert_template_schema "$project"
  assert_seed_counts "$project"

  # 幂等：再跑一次迁移，不产生重复模板或图片
  run_migration "$project" "补种子幂等重跑"
  assert_seed_counts "$project"
  echo "   幂等重跑：无重复模板/图片 ✓"

  echo "✅ [3/3] 缺模板数据的旧库补种子通过"
  cleanup_project "$project"
}

# ───────────── 执行 ─────────────
echo "🚀 模板推荐链路验收(场景: ${SCENARIOS[*]})"
for s in "${SCENARIOS[@]}"; do
  case "$s" in
    empty) scenario_empty ;;
    upgrade) scenario_upgrade ;;
    backfill) scenario_backfill ;;
  esac
done

echo ""
echo "✅ 模板推荐链路验收全部通过(${#SCENARIOS[@]} 个场景)"
