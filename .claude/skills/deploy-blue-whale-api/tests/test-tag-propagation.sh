#!/usr/bin/env bash
# deploy-blue-whale-api：image tag 绑定源码 commit 的契约测试（IK6RG8 / ADR-0063）。
#
# 设计契约（与 scripts/test-hooks.sh 一致）：
#   - 零测试框架依赖（不引 bats）；纯 bash + PATH 注入 stub + mktemp -d 隔离。
#   - 不 clone 真实仓、不连网、不 ssh 真服、不 docker build/up。
#   - seam = 子脚本对外部命令（git/bun/go/file/ssh/scp）的调用边界。
#   - 退出码：全用例过 → 0；任一失败 → 非 0。
#
# 设计决策：compose yml 形如 image: blue-whale-api:${NEW_API_IMAGE_TAG:-latest}，
# env 变量 NEW_API_IMAGE_TAG 持【短 SHA】（不带 blue-whale-api: 前缀，避免双前缀）。
# resolve_image_tag() 返回【完整 tag】（blue-whale-api:<short>，用于日志/回滚记录）。
#
# 跑法：
#   bash .claude/skills/deploy-blue-whale-api/tests/test-tag-propagation.sh
#   bash .qoder/skills/deploy-blue-whale-api/tests/test-tag-propagation.sh   （等价性）

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$SKILL_DIR/scripts"
COMPOSE_YML="$SKILL_DIR/docker/docker-compose.yml"
NEW_API_BIN="new-api"

# 固定 fake SHA（40 hex）；short = 前 12。
FAKE_SHA="1234567890abcdef1234567890abcdef12345678"
FAKE_SHORT="${FAKE_SHA:0:12}"
FAKE_TAG="blue-whale-api:$FAKE_SHORT"

PASS=0
FAIL=0
FAILURES=()
SAVED_PATH="$PATH"

# ── 真实 .build 保护（防 fresh_home 的 rm -rf 毁掉本地真实构建）──────
# 首次 fresh_home 把 $SKILL_DIR/.build 移到备份；后续调用照旧 rm -rf 清测试产物。
# EXIT trap 把真实 .build 还原（与 scripts/test-hooks.sh 的 save/restore 隔离范式一致）。
BUILD_BACKUP=""
restore_build() {
  if [ -n "$BUILD_BACKUP" ]; then
    rm -rf "$SKILL_DIR/.build"
    mv "$BUILD_BACKUP/.build" "$SKILL_DIR/.build"
    rm -rf "$BUILD_BACKUP"
    BUILD_BACKUP=""
  fi
}
trap restore_build EXIT

# ── 计数 / 断言 ──────────────────────────────────────────────────
record_pass() { PASS=$((PASS + 1)); }
record_fail() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); }

# run <cmd...> → RUN_EXIT / RUN_STDOUT / RUN_STDERR
run() {
  local tmp_out tmp_err
  tmp_out="$(mktemp)"; tmp_err="$(mktemp)"
  "$@" >"$tmp_out" 2>"$tmp_err"
  RUN_EXIT=$?
  RUN_STDOUT="$(cat "$tmp_out")"
  RUN_STDERR="$(cat "$tmp_err")"
  rm -f "$tmp_out" "$tmp_err"
}

assert_exit() {
  local expect="$1" label="$2"
  if [ "$RUN_EXIT" = "$expect" ]; then record_pass
  else record_fail "[${label}] exit=${RUN_EXIT} 期望=${expect}"; fi
}
assert_exit_nonzero() {
  local label="$1"
  if [ "$RUN_EXIT" -ne 0 ]; then record_pass
  else record_fail "[${label}] exit=${RUN_EXIT} 期望非零"; fi
}
assert_contains() {
  local hay="$1" needle="$2" label="$3"
  if printf '%s' "$hay" | grep -qF -- "$needle"; then record_pass
  else record_fail "[${label}] 未含 \"${needle}\""; fi
}
assert_not_contains() {
  local hay="$1" needle="$2" label="$3"
  if printf '%s' "$hay" | grep -qF -- "$needle"; then record_fail "[${label}] 不应含 \"${needle}\""
  else record_pass; fi
}
assert_file_exists() {
  local path="$1" label="$2"
  if [ -f "$path" ]; then record_pass
  else record_fail "[${label}] 文件不存在：${path}"; fi
}
assert_file_equals() {
  local path="$1" expected="$2" label="$3" actual=""
  [ -f "$path" ] && actual="$(cat "$path")"
  if [ "$actual" = "$expected" ]; then record_pass
  else record_fail "[${label}] ${path}=\"${actual}\" 期望=\"${expected}\""; fi
}

# ── stub 工厂 ────────────────────────────────────────────────────
STUB_DIR=""
BUN_STUB=""
SSH_CAPTURE=""

setup_stubs() {
  STUB_DIR="$(mktemp -d)"
  SSH_CAPTURE="$(mktemp)"
  BUN_STUB="$STUB_DIR/bun"

  # git：剥 -C <dir> 前缀；fetch 建 web/default 目录树；rev-parse FETCH_HEAD → 固定 SHA。
  cat >"$STUB_DIR/git" <<EOF
#!/usr/bin/env bash
git_dir=""
if [ "\$1" = "-C" ]; then git_dir="\$2"; shift 2; fi
case "\$1" in
  init|remote|checkout) : ;;
  fetch) mkdir -p "\$git_dir/web/default" 2>/dev/null || true ;;
  rev-parse) [ "\$2" = "FETCH_HEAD" ] && echo "$FAKE_SHA" ;;
esac
exit 0
EOF

  # bun：install noop；run build 在 cwd 建 dist/index.html 撑 go:embed 检查。
  cat >"$BUN_STUB" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "run" ]; then
  mkdir -p dist
  printf '<!doctype html><html><body>stub</body></html>\n' > dist/index.html
fi
exit 0
EOF

  # go：解析 -o <path>，写假二进制占位。
  cat >"$STUB_DIR/go" <<'EOF'
#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$out" ] && { mkdir -p "$(dirname "$out")"; printf 'stub-binary' >"$out"; }
exit 0
EOF

  # file：恒报 ELF 64-bit x86-64 撑 build.sh 的 file|grep 校验。
  cat >"$STUB_DIR/file" <<'EOF'
#!/usr/bin/env bash
echo "ELF 64-bit LSB executable, x86-64, version 1 (SYSV), statically linked"
exit 0
EOF

  # ssh：记录全部调用到 SSH_CAPTURE；按命令内容给模式化响应（不连真服）。
  cat >"$STUB_DIR/ssh" <<EOF
#!/usr/bin/env bash
args="\$*"
printf '%s\n' "\$args" >>"$SSH_CAPTURE"
if printf '%s' "\$args" | grep -q 'docker ps -a'; then
  echo "no"            # 容器不存在 → restart.sh 跳过 rm 分支
  exit 0
fi
if printf '%s' "\$args" | grep -q 'for i in'; then
  exit 0               # curl 验证循环 → 模拟成功
fi
if printf '%s' "\$args" | grep -q 'cat .*\\.image-tag\\.prev'; then
  if [ -n "\${FAKE_PREV_TAG:-}" ]; then printf '%s\\n' "\$FAKE_PREV_TAG"; fi
  exit 0               # rollback 读 prev（remote || true 恒 0；空输出 = prev 缺失）
fi
exit 0
EOF

  # scp：记录即可。
  cat >"$STUB_DIR/scp" <<EOF
#!/usr/bin/env bash
printf 'scp %s\\n' "\$*" >>"$SSH_CAPTURE"
exit 0
EOF

  chmod +x "$STUB_DIR/git" "$STUB_DIR/go" "$STUB_DIR/file" "$STUB_DIR/ssh" "$STUB_DIR/scp" "$BUN_STUB"
  export PATH="$STUB_DIR:$SAVED_PATH"
  export BUN="$BUN_STUB"
}

teardown_stubs() {
  export PATH="$SAVED_PATH"
  unset BUN 2>/dev/null || true
  unset FAKE_PREV_TAG 2>/dev/null || true
  [ -n "$STUB_DIR" ] && [ -d "$STUB_DIR" ] && rm -rf "$STUB_DIR"
  STUB_DIR=""
}

# 独立 HOME（隔离 API_CACHE_DIR / 锁）+ DEPLOY_KEY + 清 .build。
fresh_home() {
  local home_tmp key_tmp
  home_tmp="$(mktemp -d)"
  key_tmp="$home_tmp/key"
  : >"$key_tmp"
  export HOME="$home_tmp"
  export DEPLOY_KEY="$key_tmp"
  if [ -z "$BUILD_BACKUP" ] && [ -d "$SKILL_DIR/.build" ]; then
    BUILD_BACKUP="$(mktemp -d)"
    mv "$SKILL_DIR/.build" "$BUILD_BACKUP/.build"
  else
    rm -rf "$SKILL_DIR/.build"
  fi
}

# ════════════════════════════════════════════════════════════════
# 用例
# ════════════════════════════════════════════════════════════════

# ── 用例 1：build.sh 派生 short SHA 并落盘 ──────────────────────
setup_stubs
fresh_home
run bash "$SCRIPTS_DIR/build.sh"
assert_exit 0 "build: stub 全链路 exit 0"
assert_file_exists "$SKILL_DIR/.build/image-tag" "build: .build/image-tag 落盘"
assert_file_equals "$SKILL_DIR/.build/image-tag" "$FAKE_TAG" "build: image-tag = blue-whale-api:<short>"
assert_file_equals "$SKILL_DIR/.build/source-commit" "$FAKE_SHA" "build: source-commit = 完整 SHA"
assert_contains "$RUN_STDOUT" "$FAKE_TAG" "build: echo 含 image tag"
assert_contains "$RUN_STDOUT" "$FAKE_SHA" "build: echo 含完整 source SHA"
teardown_stubs

# ── 用例 2：docker-compose.yml 引用变量、不写死 latest ───────────
yml_text="$(cat "$COMPOSE_YML")"
assert_contains "$yml_text" 'image: blue-whale-api:${NEW_API_IMAGE_TAG:-latest}' "compose: image 字段引用 NEW_API_IMAGE_TAG 变量"
assert_not_contains "$yml_text" 'image: blue-whale-api:latest' "compose: 不再写死 blue-whale-api:latest"

# ── 用例 3：push.sh 把 tag 注入远端 .env ────────────────────────
setup_stubs
fresh_home
mkdir -p "$SKILL_DIR/.build"
printf '%s\n' "$FAKE_TAG" >"$SKILL_DIR/.build/image-tag"
printf '%s\n' "$FAKE_SHA" >"$SKILL_DIR/.build/source-commit"
: >"$SKILL_DIR/.build/$NEW_API_BIN"
run bash "$SCRIPTS_DIR/push.sh"
assert_exit 0 "push: stub ssh/scp exit 0"
assert_contains "$RUN_STDOUT" "$FAKE_TAG" "push: echo 含推送 image tag"
push_cap="$(cat "$SSH_CAPTURE")"
assert_contains "$push_cap" "NEW_API_IMAGE_TAG=$FAKE_SHORT" "push: 远端 .env 含 NEW_API_IMAGE_TAG=<short SHA>"
assert_not_contains "$push_cap" "NEW_API_IMAGE_TAG=$FAKE_TAG" "push: env 值是短 SHA 不带前缀（避免 compose 双前缀）"
teardown_stubs

# ── 用例 4：restart 记录 prev tag + rollback 行为 ───────────────
setup_stubs
fresh_home
mkdir -p "$SKILL_DIR/.build"
printf '%s\n' "$FAKE_TAG" >"$SKILL_DIR/.build/image-tag"
printf '%s\n' "$FAKE_SHA" >"$SKILL_DIR/.build/source-commit"
: >"$SKILL_DIR/.build/$NEW_API_BIN"

# 4a: restart.sh 记录远端 .image-tag.prev（容器 image tag → prev 文件）
: >"$SSH_CAPTURE"
run bash "$SCRIPTS_DIR/restart.sh"
assert_exit 0 "restart: stub ssh exit 0"
restart_cap="$(cat "$SSH_CAPTURE")"
assert_contains "$restart_cap" ".image-tag.prev" "restart: 记录远端 .image-tag.prev"
assert_contains "$restart_cap" "docker inspect" "restart: 经 docker inspect 读当前容器 image"
assert_contains "$RUN_STDOUT" "$FAKE_TAG" "restart: 部署后 echo 含运行 image tag"

# 4b: rollback.sh prev 存在 → NEW_API_IMAGE_TAG=<prev-short> compose up --no-build
: >"$SSH_CAPTURE"
export FAKE_PREV_TAG="$FAKE_TAG"
run bash "$SCRIPTS_DIR/rollback.sh"
assert_exit 0 "rollback: prev 存在 exit 0"
rb_cap="$(cat "$SSH_CAPTURE")"
assert_contains "$rb_cap" "NEW_API_IMAGE_TAG=$FAKE_SHORT" "rollback: 用 prev short SHA 起 compose"
assert_contains "$rb_cap" "--no-build" "rollback: --no-build 复用存活 prev 镜像"

# 4c: rollback.sh prev 缺失 → 非零退出（不静默回退 latest）
unset FAKE_PREV_TAG
run bash "$SCRIPTS_DIR/rollback.sh"
assert_exit_nonzero "rollback: prev 缺失非零退出"
teardown_stubs

# ── 汇总 ────────────────────────────────────────────────────────
echo ""
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -ne 0 ]; then
  i=0
  while [ "$i" -lt "${#FAILURES[@]}" ]; do
    echo "  ✗ ${FAILURES[$i]}"
    i=$((i + 1))
  done
  exit 1
fi
echo "✓ 全部通过"
