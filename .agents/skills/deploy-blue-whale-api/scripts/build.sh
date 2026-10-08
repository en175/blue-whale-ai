#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_REPO_URL="${BW_NEW_API_REPO_URL:-git@gitee.com:hangzhou-xuanfu_1/blue-whale-api.git}"
API_REPO_REF="${BW_NEW_API_REF:-90f1d49992bf22938bfb19352740891a28ecad67}"
API_CACHE_DIR="${HOME}/.cache/blue-whale-deploy"
API_CLONE_DIR="$API_CACHE_DIR/blue-whale-api"
API_LOCK_DIR="$API_CACHE_DIR/source.lock"
API_LOCK_HELD="false"
API_DIR="$API_CLONE_DIR"

acquire_api_source_lock() {
  local existing_pid=""
  if ! mkdir "$API_LOCK_DIR" 2>/dev/null; then
    existing_pid="$(cat "$API_LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -z "$existing_pid" ]; then
      echo "✗ 无法获取 new-api 部署构建锁：$API_LOCK_DIR" >&2
      return 1
    fi
    if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
      echo "✗ 已有 new-api 部署构建正在运行（PID ${existing_pid}）" >&2
      return 1
    fi
    if [[ "$existing_pid" =~ ^[0-9]+$ ]]; then
      echo "✗ 检测到陈旧的 new-api 部署构建锁（PID ${existing_pid}）；确认无进程后清理：$API_LOCK_DIR" >&2
      return 1
    fi
    echo "✗ 无法获取 new-api 部署构建锁：$API_LOCK_DIR" >&2
    return 1
  fi
  printf '%s\n' "$$" >"$API_LOCK_DIR/pid"
  API_LOCK_HELD="true"
}

cleanup() {
  local owner_pid=""
  rm -f "$API_DIR/web/.npmrc"
  [ "$API_LOCK_HELD" = "true" ] || return 0
  owner_pid="$(cat "$API_LOCK_DIR/pid" 2>/dev/null || true)"
  if [ "$owner_pid" = "$$" ]; then
    rm -f "$API_LOCK_DIR/pid"
    rmdir "$API_LOCK_DIR" 2>/dev/null || true
  fi
}

mkdir -p "$API_CACHE_DIR"
acquire_api_source_lock
trap cleanup EXIT
mkdir -p "$API_CLONE_DIR"
if [ -d "$API_CLONE_DIR/.git" ]; then
  git -C "$API_CLONE_DIR" remote set-url origin "$API_REPO_URL"
else
  git -C "$API_CLONE_DIR" init -q
  git -C "$API_CLONE_DIR" remote add origin "$API_REPO_URL"
fi
git -C "$API_CLONE_DIR" fetch --depth 1 origin "$API_REPO_REF"
API_SOURCE_COMMIT="$(git -C "$API_CLONE_DIR" rev-parse FETCH_HEAD)"
git -C "$API_CLONE_DIR" checkout -q --detach "$API_SOURCE_COMMIT"
API_SOURCE_SHORT="${API_SOURCE_COMMIT:0:12}"
IMAGE_TAG="blue-whale-api:$API_SOURCE_SHORT"
echo "ℹ️ deploy: new-api source: $API_SOURCE_COMMIT (ref: $API_REPO_REF) image: $IMAGE_TAG"
BUILD_OUT="$SKILL_DIR/.build"
mkdir -p "$BUILD_OUT"
printf '%s\n' "$IMAGE_TAG" >"$BUILD_OUT/image-tag"
printf '%s\n' "$API_SOURCE_COMMIT" >"$BUILD_OUT/source-commit"

echo "▶ bun build default 前端"
command -v "$BUN" >/dev/null 2>&1 || { echo "✗ bun 未找到：$BUN（装：npm install --prefix ~/bun-install bun，或改 BUN 指向）" >&2; exit 1; }
printf 'registry=https://registry.npmmirror.com\n' > "$API_DIR/web/.npmrc"
( cd "$API_DIR/web" && "$BUN" install )
( cd "$API_DIR/web/default" && "$BUN" run build )
[ -f "$API_DIR/web/default/dist/index.html" ] || { echo "✗ default/dist 未生成" >&2; exit 1; }

if [ ! -f "$API_DIR/web/classic/dist/index.html" ]; then
  echo "▶ classic/dist 缺失 → 写占位（go:embed 编译需要）"
  mkdir -p "$API_DIR/web/classic/dist"
  cat > "$API_DIR/web/classic/dist/index.html" <<'EOF'
<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>classic 未构建</title></head>
<body style="font-family:sans-serif;padding:2rem">classic 主题未构建（占位）。默认 default 主题可用。</body></html>
EOF
fi

echo "▶ go build linux/amd64 CGO=0"
mkdir -p "$BUILD_OUT"
( cd "$API_DIR" && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$BUILD_OUT/$BIN_NAME" main.go )
file "$BUILD_OUT/$BIN_NAME" | grep -q 'ELF 64-bit.*x86-64' || { echo "✗ 二进制非 linux x86-64" >&2; exit 1; }
echo "✓ build 完成 → $BUILD_OUT/$BIN_NAME ($(du -h "$BUILD_OUT/$BIN_NAME" | cut -f1))"
