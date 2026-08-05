#!/usr/bin/env bash
# 日常开发本地自足栈（ADR-0064 三层访问模型第一层）。
#
# 宿主机 pnpm dev 依赖本地 MySQL / Redis / new-api（账户服务），
# 本脚本基于 typescript-baseline 验收 compose + 端口发布层起这三个服务。
# 测试站数据库禁止直连；确需查测试数据走 scripts/tunnel-testsite-db.sh。
#
# 用法:
#   scripts/dev-stack.sh up       启动（首次自动构建 new-api 并初始化管理员）
#   scripts/dev-stack.sh down     停止（保留数据）
#   scripts/dev-stack.sh fresh    清空本地开发库并重来（等价 pnpm db:fresh 的 dev 版）
#   scripts/dev-stack.sh status   查看服务状态

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE="$ROOT/deploy/typescript-baseline/docker-compose.acceptance.yml"
COMPOSE_DEV="$ROOT/deploy/typescript-baseline/docker-compose.dev.yml"
PROJECT="bw-ts-dev"
CACHE_DIR="${HOME}/.cache/blue-whale-dev"

fail() {
  echo "❌ dev-stack: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker command not found"
docker info >/dev/null 2>&1 || fail "Docker daemon is not running"

dc() {
  docker compose -p "$PROJECT" -f "$COMPOSE_BASE" -f "$COMPOSE_DEV" "$@"
}

API_REPO_URL="git@gitee.com:hangzhou-xuanfu_1/blue-whale-api.git"

build_new_api_binary() {
  # new-api 源码在独立仓库 blue-whale-api（仓库拆分后迁出本仓）。
  mkdir -p "$CACHE_DIR"
  local source_dir="$CACHE_DIR/blue-whale-api"
  if [ -d "$source_dir/.git" ]; then
    git -C "$source_dir" fetch --depth 1 origin master
    git -C "$source_dir" checkout -q FETCH_HEAD
  else
    git clone --depth 1 --branch master "$API_REPO_URL" "$source_dir"
  fi

  local marker="$CACHE_DIR/api-source-rev"
  local current_rev
  current_rev="$(git -C "$source_dir" rev-parse HEAD)"
  if [ -f "$CACHE_DIR/new-api" ] && [ -f "$marker" ] \
    && [ "$(cat "$marker")" = "$current_rev" ]; then
    return 0
  fi

  echo "ℹ️ dev-stack: 构建 new-api 二进制（容器内构建，无需本机 Go）"
  local build_dir docker_arch goarch
  build_dir="$(mktemp -d "$CACHE_DIR/build.XXXXXX")"
  mkdir -p "$source_dir/web/default/dist" "$source_dir/web/classic/dist"
  [ -f "$source_dir/web/default/dist/index.html" ] \
    || printf '%s\n' '<!doctype html><title>dev</title>' >"$source_dir/web/default/dist/index.html"
  [ -f "$source_dir/web/classic/dist/index.html" ] \
    || printf '%s\n' '<!doctype html><title>dev</title>' >"$source_dir/web/classic/dist/index.html"

  docker_arch="$(docker info --format '{{.Architecture}}')"
  case "$docker_arch" in
    amd64 | x86_64) goarch=amd64 ;;
    arm64 | aarch64) goarch=arm64 ;;
    *) fail "unsupported Docker architecture: $docker_arch" ;;
  esac

  # 源码目录直接挂卷构建（浅克隆体积小，无需拷贝）；模块缓存挂卷复用。
  docker run --rm \
    -v "$build_dir:/build" \
    -v "$source_dir:/src:ro" \
    -v bw-ts-dev-go-mod-cache:/go/pkg/mod \
    -w /src \
    -e CGO_ENABLED=0 -e GOOS=linux -e GOARCH="$goarch" \
    golang:1.25-alpine \
    go build -trimpath -ldflags="-s -w" -o /build/new-api .

  mv "$build_dir/new-api" "$CACHE_DIR/new-api"
  rm -rf "$build_dir"
  printf '%s' "$current_rev" >"$marker"
}

wait_healthy() {
  local service="$1" deadline=$((SECONDS + 120)) container_id
  while [ "$SECONDS" -lt "$deadline" ]; do
    container_id="$(dc ps -a -q "$service")"
    if [ -n "$container_id" ] \
      && [ "$(docker inspect -f '{{.State.Health.Status}}' "$container_id")" = "healthy" ]; then
      return 0
    fi
    sleep 2
  done
  dc logs "$service" >&2 || true
  fail "$service did not become healthy in 120s"
}

ensure_new_api_account() {
  # 用 register 而不是 setup：setup 建的用户没有默认令牌，
  # GENERATE_DEFAULT_TOKEN 模式下登录会报 "account default token is not configured"；
  # register 自动生成初始令牌，且首个注册用户即管理员。
  local login_probe
  login_probe="$(
    dc exec -T new-api wget -qO- \
      --header='Content-Type: application/json' \
      --post-data='{"username":"root","password":"rootroot"}' \
      http://127.0.0.1:3000/api/user/login || true
  )"
  if printf '%s' "$login_probe" | grep -q '"success":true'; then
    return 0
  fi
  echo "ℹ️ dev-stack: 注册 new-api 管理员（root / rootroot）"
  local register_response
  register_response="$(
    dc exec -T new-api wget -qO- \
      --header='Content-Type: application/json' \
      --post-data='{"username":"root","password":"rootroot","email":"root@local.dev"}' \
      http://127.0.0.1:3000/api/user/register
  )"
  printf '%s' "$register_response" | grep -q '"success":true' \
    || fail "new-api register failed: $register_response"
}

wait_mysql_initdb() {
  # mysqladmin ping 通过不代表 /docker-entrypoint-initdb.d 建表脚本跑完；
  # 以基线种子数据（002_seed.sql）就绪为准。
  local deadline=$((SECONDS + 180))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if dc exec -T mysql mysql -uroot -pblue_whale -N -B blue_whale -e \
      "SELECT COUNT(*) FROM generation_model_capability WHERE enabled = 1" 2>/dev/null | grep -q "^2$"; then
      return 0
    fi
    sleep 3
  done
  dc logs mysql >&2 || true
  fail "MySQL initdb (baseline schema/seed) did not finish in 180s"
}

up() {
  build_new_api_binary
  export BW_NEW_API_BINARY="$CACHE_DIR/new-api"
  dc up -d mysql redis
  wait_healthy mysql
  wait_mysql_initdb
  dc up -d new-api
  wait_healthy new-api
  ensure_new_api_account
  cat <<'EOF'
✅ 本地自足栈已就绪（项目名 bw-ts-dev）：
  MySQL   127.0.0.1:3306（root / blue_whale，库 blue_whale）
  Redis   127.0.0.1:6379
  new-api http://127.0.0.1:3001（登录 root / rootroot）
下一步：仓库根目录 pnpm dev 启动前端与 generation-worker。
EOF
}

case "${1:-}" in
  up) up ;;
  down) dc down --remove-orphans ;;
  fresh)
    dc down -v --remove-orphans
    up
    ;;
  status) dc ps ;;
  *)
    echo "用法: scripts/dev-stack.sh {up|down|fresh|status}" >&2
    exit 2
    ;;
esac
