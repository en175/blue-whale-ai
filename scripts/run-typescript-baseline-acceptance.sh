#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/deploy/typescript-baseline/docker-compose.acceptance.yml"
PROJECT="${BW_TS_COMPOSE_PROJECT:-bw-ts-baseline-acceptance}"
NEW_API_DEFAULT_REF="90f1d49992bf22938bfb19352740891a28ecad67"
# Colima 等容器运行时只挂载用户主目录，构建临时目录必须位于 $HOME 下，
# 否则容器挂载为空导致 go.mod 不可见。
mkdir -p "${HOME}/.cache"

physical_path() {
  local target="$1" directory link hops=0
  while [ -L "$target" ]; do
    hops=$((hops + 1))
    [ "$hops" -le 40 ] || return 1
    directory="$(cd -P "$(dirname "$target")" && pwd)" || return 1
    link="$(readlink "$target")" || return 1
    case "$link" in
      /*) target="$link" ;;
      *) target="$directory/$link" ;;
    esac
  done
  directory="$(cd -P "$(dirname "$target")" && pwd)" || return 1
  printf '%s/%s\n' "$directory" "$(basename "$target")"
}

is_reusable_new_api_binary() {
  local candidate="$1" candidate_path home_path
  [ -f "$candidate" ] && [ -x "$candidate" ] || return 1
  candidate_path="$(physical_path "$candidate")" || return 1
  home_path="$(cd -P "$HOME" && pwd)" || return 1
  case "$candidate_path" in
    "$home_path"/*) return 0 ;;
    *) return 1 ;;
  esac
}

ACCEPTANCE_LOCK_DIR="${HOME}/.cache/blue-whale-typescript-baseline-acceptance.lock"
ACCEPTANCE_LOCK_HELD="false"

acquire_acceptance_lock() {
  local existing_pid=""
  if ! mkdir "$ACCEPTANCE_LOCK_DIR" 2>/dev/null; then
    existing_pid="$(cat "$ACCEPTANCE_LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -z "$existing_pid" ]; then
      echo "无法获取 TypeScript 基线验收锁：$ACCEPTANCE_LOCK_DIR" >&2
      return 1
    fi
    if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
      echo "已有 TypeScript 基线验收正在运行（PID ${existing_pid}）；固定宿主端口不支持并行运行" >&2
      return 1
    fi
    if [[ "$existing_pid" =~ ^[0-9]+$ ]]; then
      echo "检测到陈旧的 TypeScript 基线验收锁（PID ${existing_pid}）；确认无进程后清理：$ACCEPTANCE_LOCK_DIR" >&2
      return 1
    fi
    echo "无法获取 TypeScript 基线验收锁：$ACCEPTANCE_LOCK_DIR" >&2
    return 1
  fi
  printf '%s\n' "$$" >"$ACCEPTANCE_LOCK_DIR/pid"
  ACCEPTANCE_LOCK_HELD="true"
}

release_acceptance_lock() {
  local owner_pid=""
  [ "$ACCEPTANCE_LOCK_HELD" = "true" ] || return 0
  owner_pid="$(cat "$ACCEPTANCE_LOCK_DIR/pid" 2>/dev/null || true)"
  if [ "$owner_pid" = "$$" ]; then
    rm -f "$ACCEPTANCE_LOCK_DIR/pid"
    rmdir "$ACCEPTANCE_LOCK_DIR" 2>/dev/null || true
  fi
  ACCEPTANCE_LOCK_HELD="false"
}

acquire_acceptance_lock

# 若外部预置了可用 new-api 二进制（如 dev 栈产物），直接复用，跳过取源与容器内编译。
NEW_API_REUSE_PRESET="false"
NEW_API_BUILD_DIR=""
if [ -n "${BW_NEW_API_BINARY:-}" ] && is_reusable_new_api_binary "$BW_NEW_API_BINARY"; then
  NEW_API_REUSE_PRESET="true"
else
  if [ -n "${BW_NEW_API_BINARY:-}" ]; then
    echo "⚠️ baseline: 忽略无效预置二进制；必须是 HOME 内的可执行普通文件" >&2
  fi
  NEW_API_BUILD_DIR="$(mktemp -d "${HOME}/.cache/bw-new-api-acceptance.XXXXXX")"
  NEW_API_SOURCE_DIR="$NEW_API_BUILD_DIR/source"
  export BW_NEW_API_BINARY="$NEW_API_BUILD_DIR/new-api"
fi

dc() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"
}

# Invoked indirectly by the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  if [ "$NEW_API_REUSE_PRESET" = "false" ] && [ -n "$NEW_API_BUILD_DIR" ]; then
    rm -rf "$NEW_API_BUILD_DIR"
  fi
  release_acceptance_lock
}
trap cleanup EXIT

GIT_COMMIT="$(git -C "$ROOT" rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export GIT_COMMIT BUILD_TIME
export BW_TS_COMPOSE_FILE="$COMPOSE_FILE"
export BW_TS_COMPOSE_PROJECT="$PROJECT"

# 浏览器层黑盒验收（IK67GD T02）在宿主机驱动 chromium；已安装时跳过下载。
pnpm --dir "$ROOT" exec playwright install chromium

if [ "$NEW_API_REUSE_PRESET" = "true" ]; then
  echo "ℹ️ baseline: 复用预置 new-api 二进制（${BW_NEW_API_BINARY}），跳过取源与容器内 go build"
else
  # new-api 源码在独立仓库 blue-whale-api（仓库拆分后迁出本仓）。
  NEW_API_REPO_URL="${BW_NEW_API_REPO_URL:-git@gitee.com:hangzhou-xuanfu_1/blue-whale-api.git}"
  NEW_API_REF="${BW_NEW_API_REF:-$NEW_API_DEFAULT_REF}"
  NEW_API_CLONE_DIR="${HOME}/.cache/blue-whale-acceptance/blue-whale-api"
  mkdir -p "$NEW_API_CLONE_DIR"
  if [ -d "$NEW_API_CLONE_DIR/.git" ]; then
    git -C "$NEW_API_CLONE_DIR" remote set-url origin "$NEW_API_REPO_URL"
  else
    git -C "$NEW_API_CLONE_DIR" init -q
    git -C "$NEW_API_CLONE_DIR" remote add origin "$NEW_API_REPO_URL"
  fi
  git -C "$NEW_API_CLONE_DIR" fetch --depth 1 origin "$NEW_API_REF"
  NEW_API_SOURCE_COMMIT="$(git -C "$NEW_API_CLONE_DIR" rev-parse FETCH_HEAD)"
  git -C "$NEW_API_CLONE_DIR" checkout -q --detach "$NEW_API_SOURCE_COMMIT"
  echo "ℹ️ baseline: new-api source: $NEW_API_SOURCE_COMMIT (ref: $NEW_API_REF)"

  mkdir -p \
    "$NEW_API_SOURCE_DIR/web/default/dist" \
    "$NEW_API_SOURCE_DIR/web/classic/dist"
  git -C "$NEW_API_CLONE_DIR" archive "$NEW_API_SOURCE_COMMIT" | tar -x -C "$NEW_API_SOURCE_DIR"
  printf '%s\n' '<!doctype html><title>acceptance</title>' \
    >"$NEW_API_SOURCE_DIR/web/default/dist/index.html"
  printf '%s\n' '<!doctype html><title>acceptance</title>' \
    >"$NEW_API_SOURCE_DIR/web/classic/dist/index.html"
  (
    docker_arch="$(docker info --format '{{.Architecture}}')"
    case "$docker_arch" in
      amd64|x86_64) new_api_goarch=amd64 ;;
      arm64|aarch64) new_api_goarch=arm64 ;;
      *)
        echo "unsupported Docker architecture: $docker_arch" >&2
        exit 1
        ;;
    esac
    # 在容器内构建 new-api（宿主机无需 Go 工具链）；模块缓存挂卷复用。
    docker run --rm \
      -v "$NEW_API_BUILD_DIR:/build" \
      -v bw-ts-baseline-go-mod-cache:/go/pkg/mod \
      -w /build/source \
      -e CGO_ENABLED=0 \
      -e GOOS=linux \
      -e GOARCH="$new_api_goarch" \
      golang:1.25-alpine \
      go build -trimpath -ldflags="-s -w" -o /build/new-api .
  )
fi

"$ROOT/scripts/init-typescript-baseline-db.sh"
if [ "${BW_TS_SKIP_IMAGE_BUILD:-false}" = "true" ]; then
  dc up -d new-api provider-stub storage-stub agent-worker generation-worker web
else
  dc up -d --build new-api provider-stub storage-stub agent-worker generation-worker web
fi

setup_response="$(
  dc exec -T new-api wget -qO- \
    --header='Content-Type: application/json' \
    --post-data='{"username":"acceptroot","password":"AcceptanceRoot-Only!","confirmPassword":"AcceptanceRoot-Only!","DemoSiteEnabled":false}' \
    http://127.0.0.1:3000/api/setup
)"
if ! printf '%s' "$setup_response" | grep -q '"success":true'; then
  echo "new-api acceptance setup failed" >&2
  exit 1
fi

dc exec -T mysql mysql -uroot -pblue_whale new_api <<'SQL'
INSERT INTO channels (
  id, type, `key`, status, name, weight, created_time, base_url, models,
  `group`, priority, auto_ban, settings
) VALUES
  (
    9001, 1, 'sk-acceptance-upstream', 1, 'acceptance-image', 100,
    UNIX_TIMESTAMP(), 'http://provider-stub:4329',
    'doubao-seedream-4-0-250828', 'default', 100, 0,
    '{"disable_task_polling_sleep":true}'
  ),
  (
    9002, 59, 'sk-acceptance-upstream', 1, 'acceptance-video', 100,
    UNIX_TIMESTAMP(), 'http://provider-stub:4329',
    'doubao-seedance-2-0-260128', 'default', 100, 0,
    '{"disable_task_polling_sleep":true}'
  );
INSERT INTO options (`key`, `value`)
VALUES
  (
    'ModelRatio',
    '{"doubao-seedream-4-0-250828":1,"doubao-seedance-2-0-260128":1}'
  ),
  ('QuotaForNewUser', '10000000')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
SQL
dc restart new-api >/dev/null

deadline=$((SECONDS + 180))
while [ "$SECONDS" -lt "$deadline" ]; do
  pending=0
  for service in new-api provider-stub storage-stub agent-worker generation-worker web; do
    container_id="$(dc ps -q "$service")"
    if [ -z "$container_id" ] || [ "$(docker inspect -f '{{.State.Health.Status}}' "$container_id")" != "healthy" ]; then
      pending=1
    fi
  done
  if [ "$pending" -eq 0 ]; then
    if node --test \
      "$ROOT/tests/typescript-baseline/no-java-runtime.test.mjs" \
      "$ROOT/tests/typescript-baseline/fullstack.test.mjs" \
      "$ROOT/tests/typescript-baseline/ik50gb-c-smoke.test.mjs"; then
      provider_requests="$(dc exec -T provider-stub wget -qO- http://127.0.0.1:4329/__acceptance/requests)"
      PROVIDER_REQUESTS="$provider_requests" node -e '
        const requests = JSON.parse(process.env.PROVIDER_REQUESTS).requests;
        for (const pathname of [
          "/v1/images/generations",
          "/v1/video/generations",
          "/v1/video/generations/acceptance-video-task",
        ]) {
          if (!requests.some((item) => item.pathname === pathname && item.authorized === true)) {
            console.error(`authorized provider acceptance request missing: ${pathname}`);
            process.exit(1);
          }
        }
      '
      if ! node --test "$ROOT/tests/typescript-baseline/scenario-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "black-box scenario acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/conversation-browser-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "browser conversation acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/composer-upload-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub storage-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "composer upload acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/mention-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub storage-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "atomic mention blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/mention-input-snapshot-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub storage-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "mention input snapshot blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/skill-journey-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "skill journey blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/plan-message-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "plan message blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/plan-apply-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "plan apply blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/plan-application-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "plan application blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/scene-card-generation-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "scene card generation blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/output-slot-retry-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "output slot retry blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/storyboard-preview-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "storyboard preview blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/snapshot-recovery-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub           | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "snapshot recovery blackbox acceptance failed" >&2
        exit 1
      fi
      if ! node --test "$ROOT/tests/typescript-baseline/storyboard-frame-video-input-blackbox.test.mjs"; then
        dc logs --no-color --tail=200 new-api web agent-worker generation-worker provider-stub \
          | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
        echo "storyboard frame video input blackbox acceptance failed" >&2
        exit 1
      fi
      exit 0
    fi
    dc logs --no-color --tail=200 new-api web generation-worker provider-stub \
      | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
    exit 1
  fi
  sleep 2
done

dc ps >&2
dc logs --no-color --tail=200 \
  | node "$ROOT/scripts/lib/sanitize-acceptance-logs.mjs" >&2
echo "TypeScript baseline stack did not become ready" >&2
exit 1
