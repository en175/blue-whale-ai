#!/usr/bin/env bash
# 本地构建：bun build default 前端 + 维护 classic 占位 + 交叉编译 linux/amd64 静态二进制。
# 产物：$SKILL_DIR/.build/new-api
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# new-api 源码在独立仓库 blue-whale-api（仓库拆分后迁出本仓）。
API_REPO_URL="git@gitee.com:hangzhou-xuanfu_1/blue-whale-api.git"
API_CLONE_DIR="${HOME}/.cache/blue-whale-dev/blue-whale-api"
mkdir -p "${HOME}/.cache/blue-whale-dev"
if [ -d "$API_CLONE_DIR/.git" ]; then
  git -C "$API_CLONE_DIR" fetch --depth 1 origin master
  git -C "$API_CLONE_DIR" checkout -q FETCH_HEAD
else
  git clone --depth 1 --branch master "$API_REPO_URL" "$API_CLONE_DIR"
fi
API_DIR="$API_CLONE_DIR"
BUILD_OUT="$SKILL_DIR/.build"

# 1. bun build default 前端
echo "▶ bun build default 前端"
command -v "$BUN" >/dev/null 2>&1 || { echo "✗ bun 未找到：$BUN（装：npm install --prefix ~/bun-install bun，或改 BUN 指向）" >&2; exit 1; }
printf 'registry=https://registry.npmmirror.com\n' > "$API_DIR/web/.npmrc"   # 临时淘宝源，trap 清理
trap 'rm -f "$API_DIR/web/.npmrc"' EXIT
( cd "$API_DIR/web" && "$BUN" install )
( cd "$API_DIR/web/default" && "$BUN" run build )
[ -f "$API_DIR/web/default/dist/index.html" ] || { echo "✗ default/dist 未生成" >&2; exit 1; }

# 2. classic 占位（build 易失败，但 go:embed 需文件存在撑编译）
if [ ! -f "$API_DIR/web/classic/dist/index.html" ]; then
  echo "▶ classic/dist 缺失 → 写占位（go:embed 编译需要）"
  mkdir -p "$API_DIR/web/classic/dist"
  cat > "$API_DIR/web/classic/dist/index.html" <<'EOF'
<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>classic 未构建</title></head>
<body style="font-family:sans-serif;padding:2rem">classic 主题未构建（占位）。默认 default 主题可用。</body></html>
EOF
fi

# 3. 交叉编译 linux/amd64 静态二进制（CGO=0，alpine musl 兼容）
echo "▶ go build linux/amd64 CGO=0"
mkdir -p "$BUILD_OUT"
( cd "$API_DIR" && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$BUILD_OUT/$BIN_NAME" main.go )
file "$BUILD_OUT/$BIN_NAME" | grep -q 'ELF 64-bit.*x86-64' || { echo "✗ 二进制非 linux x86-64" >&2; exit 1; }
echo "✓ build 完成 → $BUILD_OUT/$BIN_NAME ($(du -h "$BUILD_OUT/$BIN_NAME" | cut -f1))"
