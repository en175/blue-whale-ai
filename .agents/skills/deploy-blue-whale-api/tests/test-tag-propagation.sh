#!/usr/bin/env bash

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$SKILL_DIR/scripts"
COMPOSE_YML="$SKILL_DIR/docker/docker-compose.yml"
NEW_API_BIN="new-api"

FAKE_SHA="1234567890abcdef1234567890abcdef12345678"
FAKE_SHORT="${FAKE_SHA:0:12}"
FAKE_TAG="blue-whale-api:$FAKE_SHORT"

PASS=0
FAIL=0
FAILURES=()
SAVED_PATH="$PATH"

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

record_pass() { PASS=$((PASS + 1)); }
record_fail() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); }

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

STUB_DIR=""
BUN_STUB=""
SSH_CAPTURE=""

setup_stubs() {
  STUB_DIR="$(mktemp -d)"
  SSH_CAPTURE="$(mktemp)"
  BUN_STUB="$STUB_DIR/bun"

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

  cat >"$BUN_STUB" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "run" ]; then
  mkdir -p dist
  printf '<!doctype html><html><body>stub</body></html>\n' > dist/index.html
fi
exit 0
EOF

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

  cat >"$STUB_DIR/file" <<'EOF'
#!/usr/bin/env bash
echo "ELF 64-bit LSB executable, x86-64, version 1 (SYSV), statically linked"
exit 0
EOF

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

yml_text="$(cat "$COMPOSE_YML")"
assert_contains "$yml_text" 'image: blue-whale-api:${NEW_API_IMAGE_TAG:-latest}' "compose: image 字段引用 NEW_API_IMAGE_TAG 变量"
assert_not_contains "$yml_text" 'image: blue-whale-api:latest' "compose: 不再写死 blue-whale-api:latest"

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

setup_stubs
fresh_home
mkdir -p "$SKILL_DIR/.build"
printf '%s\n' "$FAKE_TAG" >"$SKILL_DIR/.build/image-tag"
printf '%s\n' "$FAKE_SHA" >"$SKILL_DIR/.build/source-commit"
: >"$SKILL_DIR/.build/$NEW_API_BIN"

: >"$SSH_CAPTURE"
run bash "$SCRIPTS_DIR/restart.sh"
assert_exit 0 "restart: stub ssh exit 0"
restart_cap="$(cat "$SSH_CAPTURE")"
assert_contains "$restart_cap" ".image-tag.prev" "restart: 记录远端 .image-tag.prev"
assert_contains "$restart_cap" "docker inspect" "restart: 经 docker inspect 读当前容器 image"
assert_contains "$RUN_STDOUT" "$FAKE_TAG" "restart: 部署后 echo 含运行 image tag"

: >"$SSH_CAPTURE"
export FAKE_PREV_TAG="$FAKE_TAG"
run bash "$SCRIPTS_DIR/rollback.sh"
assert_exit 0 "rollback: prev 存在 exit 0"
rb_cap="$(cat "$SSH_CAPTURE")"
assert_contains "$rb_cap" "NEW_API_IMAGE_TAG=$FAKE_SHORT" "rollback: 用 prev short SHA 起 compose"
assert_contains "$rb_cap" "--no-build" "rollback: --no-build 复用存活 prev 镜像"

unset FAKE_PREV_TAG
run bash "$SCRIPTS_DIR/rollback.sh"
assert_exit_nonzero "rollback: prev 缺失非零退出"
teardown_stubs

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
