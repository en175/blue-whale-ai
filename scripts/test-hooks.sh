#!/usr/bin/env bash
# .claude/hooks/ PreToolUse 拦截器的纯 bash 测试夹具。
#
# 设计契约（与 hook 一致）：
#   - 零测试框架依赖（不引 bats/jq）；安全敏感 hook 可复用 Python helper 做真实 JSON/shell 解析。
#   - seam = stdin JSON → exit code + stderr 黑盒边界（hook 本身即 public boundary）。
#   - 退出码：全用例过 → 0；任一失败 → 非 0。CI/手测一键判过。
#
# 跑法：bash scripts/test-hooks.sh
# 可选：HOOK_DIR=/path/to/hooks bash scripts/test-hooks.sh
#
# 为什么存在：PR #11 的 block-issue-without-repo.sh 首版正则只匹配 string，
# 漏了 MCP schema 里 project_id 的 number 形态，「三场景空跑通过」是假绿
# （IJZ5WA 复现）。手写测试输入凭直觉写字符串、不对照真实 schema 类型是根因。
# 本夹具强制：输入 JSON 字段类型须以 MCP tools/list schema 为准。

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DIR="${HOOK_DIR:-"$REPO_ROOT/.claude/hooks"}"
HOOK_DIR="$(cd "$HOOK_DIR" && pwd)"
CODEX_HOOKS_JSON="$REPO_ROOT/.codex/hooks.json"
AUTH_SCRIPT="$REPO_ROOT/scripts/manage-agent-authorization.sh"
REAL_GIT="$(command -v git)"
ACTION_TEST_ROOT=""
PUBLISH_TEST_ROOT=""
SAVED_CLAUDE_PROJECT_DIR=""

# ── git stub（隔离 git rev-parse，不碰真实仓库）────────────────
# push-to-master / dangerous-git 的「无显式 refspec → 查当前分支」分支，
# 用 PATH 注入临时 fake git：只响应 rev-parse --abbrev-ref HEAD → $FAKE_BRANCH。
STUB_DIR=""
SAVED_PATH="$PATH"

setup_git_stub() {
  STUB_DIR="$(mktemp -d)"
  cat >"${STUB_DIR}/git" <<'EOF'
#!/usr/bin/env bash
# fake git：解析可选 -C <dir>。无 -C 走全局 fallback（保 push-to-master 等旧 slice 兼容）；
# 有 -C 按 FAKE_BRANCH_MAP / FAKE_TOPLEVEL_MAP（每行 prefix<TAB>value，路径前缀匹配）返回；
# 有 -C 但未命中 MAP → 空输出 exit 1（模拟该目录不属任何工作树 / 无分支，供 hook 走仓库外放行）。
git_dir=""
if [ "$1" = "-C" ]; then
  git_dir="$2"; shift 2
fi
# lookup_map <map-text> <query-dir>：每行 prefix<TAB>value，query 前缀命中 prefix → echo value 返回 0
lookup_map() {
  while IFS=$'\t' read -r prefix value; do
    [ -z "$prefix" ] && continue
    case "$2" in "$prefix"*) echo "$value"; return 0 ;; esac
  done < <(printf '%s\n' "$1")
  return 1
}
if [ -z "$git_dir" ] && [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ] && [ "$3" = "HEAD" ]; then
  echo "${FAKE_BRANCH:-master}"
  exit 0
fi
if [ "$1" = "symbolic-ref" ] && [ "$2" = "--short" ] && [ "$3" = "HEAD" ]; then
  if [ -n "$git_dir" ] && [ -n "${FAKE_BRANCH_MAP:-}" ] && lookup_map "$FAKE_BRANCH_MAP" "$git_dir"; then exit 0; fi
  if [ -n "$git_dir" ]; then exit 1; fi
  echo "${FAKE_BRANCH:-master}"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
  if [ -n "$git_dir" ] && [ -n "${FAKE_TOPLEVEL_MAP:-}" ] && lookup_map "$FAKE_TOPLEVEL_MAP" "$git_dir"; then exit 0; fi
  if [ -n "$git_dir" ]; then exit 1; fi
  echo "${FAKE_GIT_TOPLEVEL:-$PWD}"
  exit 0
fi
# 其它子命令不归本 stub 管，exit 0 空输出（hook 不依赖）
exit 0
EOF
  chmod +x "${STUB_DIR}/git"
  export PATH="${STUB_DIR}:${SAVED_PATH}"
}

teardown_git_stub() {
  if [ -n "$STUB_DIR" ] && [ -d "$STUB_DIR" ]; then
    rm -rf "$STUB_DIR"
  fi
  PATH="$SAVED_PATH"
  export PATH
}

# ── 计数 ────────────────────────────────────────────────────────
PASS=0
FAIL=0
FAILURES=()

# ── helper ──────────────────────────────────────────────────────
# run_hook <hook_name> <json>
# 喂 stdin JSON，捕获 exit code 到 $RUN_EXIT、stdout 到 $RUN_STDOUT、stderr 到 $RUN_STDERR。
run_hook() {
  local hook="$1"; shift
  local json="$1"; shift
  local tmp_out
  local tmp_err
  tmp_out="$(mktemp)"
  tmp_err="$(mktemp)"
  printf '%s' "$json" | bash "${HOOK_DIR}/${hook}" >"$tmp_out" 2>"$tmp_err"
  RUN_EXIT=$?
  RUN_STDOUT="$(cat "$tmp_out")"
  RUN_STDERR="$(cat "$tmp_err")"
  rm -f "$tmp_out"
  rm -f "$tmp_err"
}

# run_command_hook <command> <json>
# 喂 stdin JSON 到 settings/hooks.json 中的 command 字符串，捕获边界输出。
run_command_hook() {
  local command="$1"; shift
  local json="$1"; shift
  local tmp_out
  local tmp_err
  tmp_out="$(mktemp)"
  tmp_err="$(mktemp)"
  printf '%s' "$json" | eval "$command" >"$tmp_out" 2>"$tmp_err"
  RUN_EXIT=$?
  RUN_STDOUT="$(cat "$tmp_out")"
  RUN_STDERR="$(cat "$tmp_err")"
  rm -f "$tmp_out"
  rm -f "$tmp_err"
}

run_authorization() {
  local tmp_out
  local tmp_err
  tmp_out="$(mktemp)"
  tmp_err="$(mktemp)"
  bash "$AUTH_SCRIPT" "$@" >"$tmp_out" 2>"$tmp_err"
  RUN_EXIT=$?
  RUN_STDOUT="$(cat "$tmp_out")"
  RUN_STDERR="$(cat "$tmp_err")"
  rm -f "$tmp_out" "$tmp_err"
}

run_authorization_helper() {
  local tmp_out tmp_err
  tmp_out="$(mktemp)"
  tmp_err="$(mktemp)"
  python3 "$REPO_ROOT/.claude/hooks/lib/authorization.py" "$@" >"$tmp_out" 2>"$tmp_err"
  RUN_EXIT=$?
  RUN_STDOUT="$(cat "$tmp_out")"
  RUN_STDERR="$(cat "$tmp_err")"
  rm -f "$tmp_out" "$tmp_err"
}

# assert_exit <expected_exit> <label>
assert_exit() {
  local expect="$1"; shift
  local label="$1"; shift
  if [ "$RUN_EXIT" = "$expect" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] exit=${RUN_EXIT} 期望=${expect}")
  fi
}

# assert_stderr_has <substring> <label>
assert_stderr_has() {
  local needle="$1"; shift
  local label="$1"; shift
  if printf '%s' "$RUN_STDERR" | grep -qF -- "$needle"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] stderr 未含 \"${needle}\" 实际=${RUN_STDERR}")
  fi
}

assert_stdout_has() {
  local needle="$1"; shift
  local label="$1"; shift
  if printf '%s' "$RUN_STDOUT" | grep -qF -- "$needle"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] stdout 未含 \"${needle}\" 实际=${RUN_STDOUT}")
  fi
}

assert_stdout_starts_with() {
  local prefix="$1"; shift
  local label="$1"; shift
  case "$RUN_STDOUT" in
    "$prefix"*)
      PASS=$((PASS + 1))
      ;;
    *)
      FAIL=$((FAIL + 1))
      FAILURES+=("[${label}] stdout 未以 \"${prefix}\" 开头 实际=${RUN_STDOUT}")
      ;;
  esac
}

assert_stdout_empty() {
  local label="$1"; shift
  if [ -z "$RUN_STDOUT" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] stdout 应为空，实际=${RUN_STDOUT}")
  fi
}

publish_marker_path() {
  local branch="${1:-feature/x}"
  local slug="$(printf '%s' "$branch" | tr '/' '%')"
  local root="${PUBLISH_TEST_ROOT:-$REPO_ROOT}"
  local common="$("$REAL_GIT" -C "$root" rev-parse --git-common-dir 2>/dev/null || true)"
  case "$common" in
    "") common="$root/.git" ;;
    /*) ;;
    *)  common="$root/$common" ;;
  esac
  printf '%s/agent-release-review-package-%s' "$common" "$slug"
}

write_publish_marker() {
  local branch="$1"; shift
  local target="${1:-master}"; shift || true
  local created_at="${1:-$(date +%s)}"; shift || true
  local marker
  marker="$(publish_marker_path "$branch")"
  mkdir -p "$(dirname "$marker")"
  cat >"$marker" <<EOF
branch=$branch
target=$target
created_at=$created_at
EOF
}

remove_publish_marker() {
  local branch="${1:-feature/x}"
  rm -f "$(publish_marker_path "$branch")"
}

authorization_marker_path() {
  local action="$1"
  local enterprise_id="$2"
  local project_id="$3"
  local subject="$4"
  local root common digest
  root="${ACTION_TEST_ROOT:-$REPO_ROOT}"
  common="$("$REAL_GIT" -C "$root" rev-parse --git-common-dir)"
  case "$common" in /*) ;; *) common="$root/$common" ;; esac
  digest="$(printf '%s\n%s\n%s\n%s\n' "$action" "$enterprise_id" "$project_id" "$subject" | "$REAL_GIT" -C "$root" hash-object --stdin)"
  printf '%s/agent-action-authorizations/%s' "$common" "$digest"
}

authorization_claim_path() {
  printf '%s.claim' "$(authorization_marker_path "$@")"
}

write_action_marker() {
  local action="$1"
  local enterprise_id="$2"
  local project_id="$3"
  local subject="$4"
  local created_at="${5:-$(date +%s)}"
  local marker
  marker="$(authorization_marker_path "$action" "$enterprise_id" "$project_id" "$subject")"
  mkdir -p "$(dirname "$marker")"
  cat >"$marker" <<EOF
version=1
action=$action
enterprise_id=$enterprise_id
project_id=$project_id
subject=$subject
created_at=$created_at
EOF
  chmod 600 "$marker"
}

remove_all_action_markers() {
  local marker
  marker="$(authorization_marker_path _ _ _ _)"
  rm -rf "$(dirname "$marker")"
}

setup_action_test_repo() {
  SAVED_CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
  ACTION_TEST_ROOT="$(mktemp -d)"
  "$REAL_GIT" -C "$ACTION_TEST_ROOT" init -q
  mkdir -p "$ACTION_TEST_ROOT/.claude/hooks/lib" "$ACTION_TEST_ROOT/scripts"
  cp "$REPO_ROOT/.claude/hooks/lib/authorization.py" "$ACTION_TEST_ROOT/.claude/hooks/lib/authorization.py"
  cp "$REPO_ROOT/scripts/manage-agent-authorization.sh" "$ACTION_TEST_ROOT/scripts/manage-agent-authorization.sh"
  chmod +x "$ACTION_TEST_ROOT/.claude/hooks/lib/authorization.py" "$ACTION_TEST_ROOT/scripts/manage-agent-authorization.sh"
  AUTH_SCRIPT="$ACTION_TEST_ROOT/scripts/manage-agent-authorization.sh"
  CLAUDE_PROJECT_DIR="$ACTION_TEST_ROOT"
  export ACTION_TEST_ROOT AUTH_SCRIPT CLAUDE_PROJECT_DIR
}

teardown_action_test_repo() {
  if [ -n "$SAVED_CLAUDE_PROJECT_DIR" ]; then
    CLAUDE_PROJECT_DIR="$SAVED_CLAUDE_PROJECT_DIR"
    export CLAUDE_PROJECT_DIR
  else
    unset CLAUDE_PROJECT_DIR
  fi
  AUTH_SCRIPT="$REPO_ROOT/scripts/manage-agent-authorization.sh"
  rm -rf "$ACTION_TEST_ROOT"
  ACTION_TEST_ROOT=""
  SAVED_CLAUDE_PROJECT_DIR=""
  export ACTION_TEST_ROOT AUTH_SCRIPT SAVED_CLAUDE_PROJECT_DIR
}

setup_publish_test_repo() {
  PUBLISH_TEST_ROOT="$(mktemp -d)"
  "$REAL_GIT" -C "$PUBLISH_TEST_ROOT" init -q
  CLAUDE_PROJECT_DIR="$PUBLISH_TEST_ROOT"
  export PUBLISH_TEST_ROOT CLAUDE_PROJECT_DIR
}

teardown_publish_test_repo() {
  unset CLAUDE_PROJECT_DIR
  rm -rf "$PUBLISH_TEST_ROOT"
  PUBLISH_TEST_ROOT=""
  export PUBLISH_TEST_ROOT
}

assert_stdout_not_has() {
  local needle="$1"; shift
  local label="$1"; shift
  if printf '%s' "$RUN_STDOUT" | grep -qF -- "$needle"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] stdout 不应含 \"${needle}\" 实际=${RUN_STDOUT}")
  else
    PASS=$((PASS + 1))
  fi
}

assert_file_exists() {
  local path="$1"; shift
  local label="$1"; shift
  if [ -f "$path" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] 文件不存在：${path}")
  fi
}

assert_file_missing() {
  local path="$1"; shift
  local label="$1"; shift
  if [ ! -e "$path" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] 文件仍存在：${path}")
  fi
}

assert_file_mode_600() {
  local path="$1"; shift
  local label="$1"; shift
  local mode
  mode="$(python3 - "$path" <<'PY'
import os, stat, sys
print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))
PY
)"
  if [ "$mode" = "0o600" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] 文件权限=${mode} 期望=0o600：${path}")
  fi
}

assert_file_has_text() {
  local path="$1"; shift
  local needle="$1"; shift
  local label="$1"; shift
  if grep -qF -- "$needle" "$path"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] ${path} 未含 \"${needle}\"")
  fi
}

assert_file_not_has_text() {
  local path="$1"; shift
  local needle="$1"; shift
  local label="$1"; shift
  if grep -qF -- "$needle" "$path"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] ${path} 不应含 \"${needle}\"")
  else
    PASS=$((PASS + 1))
  fi
}

assert_file_not_matches() {
  local path="$1"; shift
  local pattern="$1"; shift
  local label="$1"; shift
  if grep -qE -- "$pattern" "$path"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] ${path} 不应匹配正则 ${pattern}")
  else
    PASS=$((PASS + 1))
  fi
}

assert_git_ignored() {
  local path="$1"; shift
  local label="$1"; shift
  if git check-ignore -q --no-index "$path"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] 应被 gitignore 忽略但未被忽略：${path}")
  fi
}

assert_git_not_ignored() {
  local path="$1"; shift
  local label="$1"; shift
  if git check-ignore -q --no-index "$path"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] 不应被 gitignore 忽略但已被忽略：${path}")
  else
    PASS=$((PASS + 1))
  fi
}

assert_codex_hooks_valid() {
  local label="$1"; shift
  local tmp_err
  tmp_err="$(mktemp)"
  python3 - "$REPO_ROOT/.claude/settings.json" "$CODEX_HOOKS_JSON" > /dev/null 2>"$tmp_err" <<'PY'
import json
import os
import re
import shlex
import sys
from pathlib import Path

claude_path = Path(sys.argv[1])
codex_path = Path(sys.argv[2])
claude = json.loads(claude_path.read_text())
codex = json.loads(codex_path.read_text())

def shape(items):
    return [(item["matcher"], len(item.get("hooks", []))) for item in items]

def claude_script(command):
    match = re.search(r"\.claude/hooks/([^\"'\s]+\.sh)", command)
    return match.group(1) if match else None

def codex_script(command):
    if "run-claude-pretool.sh" not in command:
        if ".codex/hooks/" in command:
            raise SystemExit(f"Codex command points at copied .codex/hooks implementation: {command}")
        if ".claude/hooks/" in command:
            raise SystemExit(f"Codex command bypasses wrapper: {command}")
        return None
    parts = shlex.split(command)
    scripts = [
        os.path.basename(part)
        for part in parts
        if part.endswith(".sh") and os.path.basename(part) != "run-claude-pretool.sh"
    ]
    if len(scripts) != 1:
        raise SystemExit(f"Codex wrapper command must name exactly one hook script: {command}")
    return scripts[0]

script_count = 0
for event in ("PreToolUse", "PostToolUse"):
    claude_items = claude["hooks"].get(event, [])
    codex_items = codex["hooks"].get(event, [])
    if event == "PreToolUse":
        # 提醒型 gate 与 Claude 专属 Edit|Write 兜底不属于平台中立契约。
        claude_items = [
            it for it in claude_items if it["matcher"] not in ("Grep|Glob", "Edit|Write")
        ]
    if shape(claude_items) != shape(codex_items):
        raise SystemExit(
            f"{event} matcher/hook shape mismatch: claude={shape(claude_items)} codex={shape(codex_items)}"
        )
    for index, (claude_item, codex_item) in enumerate(zip(claude_items, codex_items)):
        claude_scripts = [
            script
            for hook in claude_item.get("hooks", [])
            if hook.get("type") == "command"
            for script in [claude_script(hook["command"])]
            if script
        ]
        codex_scripts = [
            script
            for hook in codex_item.get("hooks", [])
            if hook.get("type") == "command"
            for script in [codex_script(hook["command"])]
            if script
        ]
        if claude_scripts != codex_scripts:
            raise SystemExit(
                f"script mismatch at {event}[{index}] matcher={claude_item['matcher']}: "
                f"claude={claude_scripts} codex={codex_scripts}"
            )
        script_count += len(codex_scripts)

pre_matchers = [item["matcher"] for item in codex["hooks"]["PreToolUse"]]
required_pre = {
    "Bash",
    "mcp__gitee-ent__create_enterprise_repo_pull",
    "mcp__gitee-ent__merge_enterprise_pull",
    "mcp__gitee-ent__create_enterprise_repo_release",
    "mcp__gitee-ent__create_enterprise_issue",
    "mcp__gitee-ent__update_enterprise_issue",
}
missing = sorted(required_pre - set(pre_matchers))
if missing:
    raise SystemExit(f"missing Codex PreToolUse matcher(s): {missing}")

post_matchers = {item["matcher"] for item in codex["hooks"].get("PostToolUse", [])}
required_post = {
    "mcp__gitee-ent__create_enterprise_repo_pull",
    "mcp__gitee-ent__merge_enterprise_pull",
    "mcp__gitee-ent__create_enterprise_repo_release",
}
missing = sorted(required_post - post_matchers)
if missing:
    raise SystemExit(f"missing Codex PostToolUse matcher(s): {missing}")

if script_count == 0:
    raise SystemExit("no Codex script hook commands found")
PY
  local exit_code=$?
  if [ "$exit_code" = 0 ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[${label}] Codex hooks JSON 校验失败：$(cat "$tmp_err")")
  fi
  rm -f "$tmp_err"
}

codex_command_for() {
  local script="$1"; shift
  local event="${1:-PreToolUse}"
  python3 - "$CODEX_HOOKS_JSON" "$script" "$event" <<'PY'
import json
import os
import shlex
import sys
from pathlib import Path

codex = json.loads(Path(sys.argv[1]).read_text())
wanted = sys.argv[2]
event = sys.argv[3]
matches = []
for item in codex["hooks"][event]:
    for hook in item.get("hooks", []):
        command = hook.get("command", "")
        if hook.get("type") != "command" or "run-claude-pretool.sh" not in command:
            continue
        parts = shlex.split(command)
        scripts = [
            os.path.basename(part)
            for part in parts
            if part.endswith(".sh") and os.path.basename(part) != "run-claude-pretool.sh"
        ]
        if scripts == [wanted]:
            matches.append(command)

if not matches:
    raise SystemExit(f"missing Codex command for {wanted}")
if len(set(matches)) != 1:
    raise SystemExit(f"ambiguous Codex commands for {wanted}: {matches}")
print(matches[0])
PY
}

CODEX_BLOCK_PUSH_CMD="$(codex_command_for block-push-to-master.sh)"
CODEX_DANGER_CMD="$(codex_command_for block-dangerous-git.sh)"
CODEX_SQUASH_CMD="$(codex_command_for block-squash-merge.sh)"
CODEX_ISSUE_CMD="$(codex_command_for block-issue-without-repo.sh)"
CODEX_RELEASE_CMD="$(codex_command_for confirm-release-action.sh)"
CODEX_RELEASE_POST_CMD="$(codex_command_for confirm-release-action.sh PostToolUse)"

# ── 用例 ────────────────────────────────────────────────────────

# Slice 0 / 1 — block-squash-merge
# merge_method=merge → 放行（tracer bullet）
run_hook block-squash-merge.sh '{"tool_input":{"merge_method":"merge"}}'
assert_exit 0 "squash-merge: merge 放行"

# squash → 拦（exit 2 + stderr 提示 squash）
run_hook block-squash-merge.sh '{"tool_input":{"merge_method":"squash"}}'
assert_exit 2 "squash-merge: squash 拦截"
assert_stderr_has "squash" "squash-merge: squash 提示含 squash"

# rebase → 拦
run_hook block-squash-merge.sh '{"tool_input":{"merge_method":"rebase"}}'
assert_exit 2 "squash-merge: rebase 拦截"
assert_stderr_has "rebase" "squash-merge: rebase 提示含 rebase"

# 缺省（未传 merge_method，Gitee 默认 merge）→ 放行
run_hook block-squash-merge.sh '{"tool_input":{}}'
assert_exit 0 "squash-merge: 缺省放行"

# Slice 1.5 — confirm-release-action
RELEASE_HOOK=confirm-release-action.sh

# 非发布 Bash 命令 → 放行且不要求确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git status --short"}}'
assert_exit 0 "release: 非发布 git status 放行"

# git push 修改远程 → 硬拦，必须走标准发布审查包入口
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git push -u origin feature/x"}}'
assert_exit 2 "release: 直接 git push 被拦截"
assert_stderr_has "publish-review-package.sh --user-authorized" "release: 直接 git push 提示标准入口"

# git 全局选项形式也应硬拦
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git -C ../blue-whale-worktrees/task push origin feature/x"}}'
assert_exit 2 "release: git -C push 被拦截"
assert_stderr_has "直接 git push" "release: git -C push 提示直接 push"

# JSON 转义引号不能截断 command 后绕过 push 检测
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"echo \"ready\"; git push origin feature/x"}}'
assert_exit 2 "release: 转义引号后 git push 被拦截"
assert_stderr_has "直接 git push" "release: 转义引号后 git push 提示直接 push"

# bash -lc 嵌套 push 也不能绕过标准入口
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"bash -lc \"git push origin feature/x\""}}'
assert_exit 2 "release: bash -lc git push 被拦截"
assert_stderr_has "直接 git push" "release: bash -lc git push 提示直接 push"

# 直接 force-with-lease 也必须走标准入口，避免 PR 反馈后绕过发布确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git push --force-with-lease origin feature/x"}}'
assert_exit 2 "release: 直接 force-with-lease push 被拦截"
assert_stderr_has "直接 git push" "release: 直接 force-with-lease push 提示直接 push"

# 旧项目发布脚本不由 Hook 弹窗；脚本自身会失败并提示新入口
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/publish-task-branch.sh"}}'
assert_exit 0 "release: publish-task-branch hook 放行"

# 新发布审查包入口缺授权参数 → 硬拦
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/publish-review-package.sh"}}'
assert_exit 2 "release: publish-review-package 缺参数被拦截"
assert_stderr_has "--user-authorized" "release: publish-review-package 缺参数提示授权参数"

# bash 包裹新发布审查包入口缺参数 → 仍应硬拦
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"bash scripts/publish-review-package.sh"}}'
assert_exit 2 "release: bash publish-review-package 缺参数被拦截"
assert_stderr_has "--user-authorized" "release: bash publish-review-package 缺参数提示授权参数"

# 新发布审查包入口带授权参数 → 无交互放行
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/publish-review-package.sh --user-authorized"}}'
assert_exit 0 "release: publish-review-package 授权入口放行"
assert_stdout_empty "release: publish-review-package 无交互输出"

# 直接本地 commit / merge --no-ff 硬拦，要求改走标准入口。
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git commit -m \"feat: task slice\""}}'
assert_exit 2 "release: 直接 git commit 硬拦"
assert_stderr_has "commit-task-for-review.sh -m" "release: 直接 git commit 指向标准入口"

# 裸 git commit --amend 同被拦（任何 commit 子命令归为 git commit），文案须同时指引首次 -m 与 review 后 --amend。
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git commit --amend"}}'
assert_exit 2 "release: 直接 git commit --amend 硬拦"
assert_stderr_has "commit-task-for-review.sh -m" "release: git commit --amend 文案仍含首次 -m 指引"
assert_stderr_has "commit-task-for-review.sh --amend" "release: git commit --amend 文案含 --amend 指引"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git merge --no-ff feature/x"}}'
assert_exit 2 "release: 直接 git merge --no-ff 硬拦"
assert_stderr_has "merge-task-to-local-master.sh --user-authorized" "release: 直接 git merge --no-ff 指向标准入口"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git merge feature/x"}}'
assert_exit 2 "release: 直接 git merge 工单分支硬拦"
assert_stderr_has "merge-task-to-local-master.sh --user-authorized" "release: 直接 git merge 工单分支指向标准入口"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git merge --ff-only origin/master"}}'
assert_exit 0 "release: git merge --ff-only 同步放行"
assert_stdout_not_has '"permissionDecision":"ask"' "release: git merge --ff-only 不触发确认"

# 标准本地验收入口：worktree commit 本地可逆，出现即放行（不校验 --user-authorized）。
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/commit-task-for-review.sh -m \"feat: task slice\""}}'
assert_exit 0 "release: commit-task-for-review 出现即放行（无需 --user-authorized）"
assert_stdout_empty "release: commit-task-for-review 无交互输出"

# hook 只认入口名、不校验 --user-authorized：命令仍含该参数时 hook 层照常放行（参数合法性由脚本自身处理）。
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/commit-task-for-review.sh --user-authorized -m \"feat: task slice\""}}'
assert_exit 0 "release: commit-task-for-review 含残留 --user-authorized 时 hook 层放行"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/merge-task-to-local-master.sh feature/x"}}'
assert_exit 2 "release: merge-task-to-local-master 缺参数被拦截"
assert_stderr_has "--user-authorized" "release: merge-task-to-local-master 缺参数提示授权参数"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/merge-task-to-local-master.sh --user-authorized feature/x"}}'
assert_exit 0 "release: merge-task-to-local-master 授权入口放行"
assert_stdout_empty "release: merge-task-to-local-master 无交互输出"

# bash 包裹新发布审查包入口带授权参数 → 仍应无交互放行
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"bash scripts/publish-review-package.sh --user-authorized"}}'
assert_exit 0 "release: bash publish-review-package 授权入口放行"
assert_stdout_empty "release: bash publish-review-package 无交互输出"

# bash -lc 包裹标准入口仍应识别
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"bash -lc \"scripts/publish-review-package.sh --user-authorized\""}}'
assert_exit 0 "release: bash -lc publish-review-package 授权入口放行"
assert_stdout_empty "release: bash -lc publish-review-package 无交互输出"

# 标准入口不能掩盖同一复合命令中的裸 Git 操作。
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/commit-task-for-review.sh -m \"feat: x\" && git commit -m \"bypass\""}}'
assert_exit 2 "release: 标准 commit 入口后裸 commit 仍硬拦"
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/merge-task-to-local-master.sh --user-authorized feature/x && git merge --no-ff feature/y"}}'
assert_exit 2 "release: 标准 merge 入口后裸 merge 仍硬拦"
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/publish-review-package.sh --user-authorized && git commit -m \"bypass\""}}'
assert_exit 2 "release: 标准 publish 入口后裸 commit 仍硬拦"

# 内联和仓库 Git alias 不能绕过 push / commit / merge 分类。
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git -c alias.ship=push ship origin feature/x"}}'
assert_exit 2 "release: inline alias push 硬拦"
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git -c alias.save=commit save -m \"bypass\""}}'
assert_exit 2 "release: inline alias commit 硬拦"
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git -c alias.integrate=\"merge --no-ff\" integrate feature/x"}}'
assert_exit 2 "release: inline alias merge 硬拦"

ALIAS_TEST_ROOT="$(mktemp -d)"
"$REAL_GIT" -C "$ALIAS_TEST_ROOT" init -q
"$REAL_GIT" -C "$ALIAS_TEST_ROOT" config alias.ship push
"$REAL_GIT" -C "$ALIAS_TEST_ROOT" config alias.save commit
"$REAL_GIT" -C "$ALIAS_TEST_ROOT" config alias.integrate 'merge --no-ff'
"$REAL_GIT" -C "$ALIAS_TEST_ROOT" config alias.option-ship '-c foo.bar=baz push'
"$REAL_GIT" -C "$ALIAS_TEST_ROOT" config alias.option-save '-c foo.bar=baz commit'
"$REAL_GIT" -C "$ALIAS_TEST_ROOT" config alias.option-integrate '-c foo.bar=baz merge --no-ff'
run_hook "$RELEASE_HOOK" "$(printf '{\"tool_input\":{\"command\":\"git -C %s ship origin feature/x\"}}' "$ALIAS_TEST_ROOT")"
assert_exit 2 "release: configured alias push 硬拦"
run_hook "$RELEASE_HOOK" "$(printf '{\"tool_input\":{\"command\":\"git -C %s save -m bypass\"}}' "$ALIAS_TEST_ROOT")"
assert_exit 2 "release: configured alias commit 硬拦"
run_hook "$RELEASE_HOOK" "$(printf '{\"tool_input\":{\"command\":\"git -C %s integrate feature/x\"}}' "$ALIAS_TEST_ROOT")"
assert_exit 2 "release: configured alias merge 硬拦"
run_hook "$RELEASE_HOOK" "$(printf '{\"tool_input\":{\"command\":\"git -C %s option-ship origin feature/x\"}}' "$ALIAS_TEST_ROOT")"
assert_exit 2 "release: configured alias with global option push 硬拦"
run_hook "$RELEASE_HOOK" "$(printf '{\"tool_input\":{\"command\":\"git -C %s option-save -m bypass\"}}' "$ALIAS_TEST_ROOT")"
assert_exit 2 "release: configured alias with global option commit 硬拦"
run_hook "$RELEASE_HOOK" "$(printf '{\"tool_input\":{\"command\":\"git -C %s option-integrate feature/x\"}}' "$ALIAS_TEST_ROOT")"
assert_exit 2 "release: configured alias with global option merge 硬拦"
rm -rf "$ALIAS_TEST_ROOT"

# 项目清理脚本依靠自身校验，不在发布 Hook 中弹确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/cleanup-task-worktree.sh"}}'
assert_exit 0 "release: cleanup-task-worktree 放行"

# 主 checkout 验证 worktree 脚本硬停的复合命令不应误触发发布确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"cd /Users/jj.reno/Blue-Whale\n# 主 checkout 跑 worktree 脚本应硬停\nscripts/cleanup-task-worktree.sh 2>&1; echo \"exit=$?\"\necho \"---\"\nscripts/publish-task-branch.sh 2>&1; echo \"exit=$?\"\necho \"---\"\nscripts/ensure-graphify-worktree.sh 2>&1; echo \"exit=$?\""}}'
assert_exit 0 "release: 复合验证命令放行"

# 只验证清理/graphify 脚本时不应误触发发布确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"cd /Users/jj.reno/Blue-Whale\nscripts/cleanup-task-worktree.sh 2>&1; echo \"exit=$?\"\necho \"---\"\nscripts/ensure-graphify-worktree.sh 2>&1; echo \"exit=$?\""}}'
assert_exit 0 "release: 非发布验证复合命令放行"

# 创建合法普通 PR（缺 draft）→ Pre 只校验形态放行，不消费标记（消费延后到 Post，见 ADR-0011）
setup_publish_test_repo
write_publish_marker "feature/x"
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","title":"test"}}'
assert_exit 0 "release: 普通 PR 放行不二次确认"
assert_stdout_not_has '"permissionDecision":"ask"' "release: 普通 PR 不二次确认"
assert_file_exists "$(publish_marker_path feature/x)" "release: 普通 PR Pre 阶段不消费标记（延后到 Post）"

# 创建显式非 draft PR → Pre 只校验形态放行，不消费标记（消费延后到 Post，见 ADR-0011）
write_publish_marker "feature/x"
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","draft":"false","title":"test"}}'
assert_exit 0 "release: 非 draft PR 放行不二次确认"
assert_stdout_not_has '"permissionDecision":"ask"' "release: 非 draft PR 不二次确认"
assert_file_exists "$(publish_marker_path feature/x)" "release: 非 draft PR Pre 阶段不消费标记（延后到 Post）"

# 直接创建合法形态普通 PR 但缺少发布审查包标记 → 阻断
remove_publish_marker feature/x
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","title":"test"}}'
assert_exit 2 "release: 普通 PR 缺发布标记拦截"
assert_stderr_has "publish-review-package.sh --user-authorized" "release: 普通 PR 缺发布标记提示标准入口"

# G+ 标记按分支隔离：写 feature/other 标记，PR 用 source=feature/x 只找 feature%x 文件，
# 找不到 → 落到「缺标记」阻断（等效防伪造消费授权，失败模式从「不匹配」变为「缺标记」，
# 因标记路径本身含分支 slug，结构性消除了「找到别人标记」的可能）。
write_publish_marker "feature/other"
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","title":"test"}}'
assert_exit 2 "release: 跨分支 PR 找不到对应标记拦截"
assert_stderr_has "publish-review-package.sh --user-authorized" "release: 跨分支 PR 缺标记提示"
remove_publish_marker feature/other

# 过期发布标记 → 阻断并消费标记
write_publish_marker "feature/x" "master" "1"
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","title":"test"}}'
assert_exit 2 "release: 普通 PR 发布标记过期"
assert_stderr_has "已过期" "release: 普通 PR 发布标记过期提示"
assert_file_missing "$(publish_marker_path feature/x)" "release: 普通 PR 过期标记被清理"

# 创建 draft PR → 阻断
write_publish_marker "feature/x"
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","draft":"true","title":"test"}}'
assert_exit 2 "release: draft PR 拦截"
assert_stderr_has "不使用 draft PR" "release: draft PR 提示普通 PR"
remove_publish_marker feature/x

# 创建 PR 缺 target_branch → 阻断
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","title":"test"}}'
assert_exit 2 "release: 缺 target_branch PR 拦截"

# 创建 PR 缺 source_branch → 阻断
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"target_branch":"master","title":"test"}}'
assert_exit 2 "release: 缺 source_branch PR 拦截"

# 创建非 master 目标 PR → 阻断
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"develop","draft":"false","title":"test"}}'
assert_exit 2 "release: 非 master 目标 PR 拦截"

# 合并 PR → 必须持有绑定企业/仓库/PR 的一次性凭证。
setup_action_test_repo
remove_all_action_markers
run_hook "$RELEASE_HOOK" '{"tool_use_id":"merge-12-missing","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":12,"merge_method":"merge"}}'
assert_exit 2 "release: merge PR 缺凭证拦截"
assert_stderr_has "manage-agent-authorization.sh grant" "release: merge PR 缺凭证提示自动授权入口"

write_action_marker merge-pr 16660949 48854568 12
run_hook "$RELEASE_HOOK" '{"tool_use_id":"merge-12-a","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":12,"merge_method":"merge"}}'
assert_exit 0 "release: merge PR 有效凭证首次 claim 放行"
assert_stdout_empty "release: merge PR 无交互输出"
assert_file_exists "$(authorization_marker_path merge-pr 16660949 48854568 12)" "release: merge PR Pre 不消费凭证"
assert_file_exists "$(authorization_claim_path merge-pr 16660949 48854568 12)" "release: merge PR Pre 原子占用凭证"

run_hook "$RELEASE_HOOK" '{"tool_use_id":"merge-12-b","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":12,"merge_method":"merge"}}'
assert_exit 2 "release: merge PR 同凭证并发 claim 拦截"
assert_stderr_has "已被另一个工具调用占用" "release: merge PR 并发占用提示"

run_hook "$RELEASE_HOOK" '{"hook_event_name":"PostToolUse","tool_use_id":"merge-12-a","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":12,"merge_method":"merge"},"tool_response":{"isError":true}}'
assert_exit 0 "release: merge PR 失败 Post 放行"
assert_file_exists "$(authorization_marker_path merge-pr 16660949 48854568 12)" "release: merge PR 失败 Post 保留凭证"
assert_file_missing "$(authorization_claim_path merge-pr 16660949 48854568 12)" "release: merge PR 失败 Post 释放占用"

run_hook "$RELEASE_HOOK" '{"tool_use_id":"merge-12-b","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":12,"merge_method":"merge"}}'
assert_exit 0 "release: merge PR 失败释放后可重试"
run_hook "$RELEASE_HOOK" '{"hook_event_name":"PostToolUse","tool_use_id":"merge-12-b","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":12,"merge_method":"merge"},"tool_response":{"isError":false}}'
assert_exit 0 "release: merge PR 成功 Post 放行"
assert_file_missing "$(authorization_marker_path merge-pr 16660949 48854568 12)" "release: merge PR 成功 Post 消费凭证"
assert_file_missing "$(authorization_claim_path merge-pr 16660949 48854568 12)" "release: merge PR 成功 Post 清理占用"

write_action_marker merge-pr 16660949 48854568 17
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":17,"merge_method":"merge"}}'
assert_exit 2 "release: merge PR 缺 tool_use_id 拦截"
assert_stderr_has "tool_use_id" "release: merge PR 缺 tool_use_id 提示"

write_action_marker merge-pr 16660949 48854568 13 1
run_hook "$RELEASE_HOOK" '{"tool_use_id":"merge-13","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":13,"merge_method":"merge"}}'
assert_exit 2 "release: merge PR 过期凭证拦截"
assert_stderr_has "已过期" "release: merge PR 过期凭证提示"
assert_file_missing "$(authorization_marker_path merge-pr 16660949 48854568 13)" "release: merge PR 过期凭证清理"

write_action_marker merge-pr 16660949 48854568 14
run_hook "$RELEASE_HOOK" '{"tool_use_id":"merge-15","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":15,"merge_method":"merge"}}'
assert_exit 2 "release: merge PR 对象错配拦截"
assert_file_exists "$(authorization_marker_path merge-pr 16660949 48854568 14)" "release: merge PR 对象错配不消费其他凭证"

malformed_marker="$(authorization_marker_path merge-pr 16660949 48854568 16)"
mkdir -p "$(dirname "$malformed_marker")"
printf 'version=1\naction=merge-pr\n' >"$malformed_marker"
run_hook "$RELEASE_HOOK" '{"tool_use_id":"merge-16","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":16,"merge_method":"merge"}}'
assert_exit 2 "release: merge PR 非法凭证拦截"
assert_stderr_has "凭证无效" "release: merge PR 非法凭证提示"
assert_file_missing "$malformed_marker" "release: merge PR 非法凭证清理"

# 创建 release → 使用绑定 tag 的一次性凭证，失败保留、成功消费。
write_action_marker create-release 16660949 48854568 v1.0.0
run_hook "$RELEASE_HOOK" '{"tool_use_id":"release-v1","tool_name":"mcp__gitee-ent__create_enterprise_repo_release","tool_input":{"enterprise_id":16660949,"project_id":"48854568","release_tag_version":"v1.0.0","release_title":"v1.0.0","release_description":"test"}}'
assert_exit 0 "release: create release 有效凭证放行"
assert_stdout_empty "release: create release 无交互输出"
assert_file_exists "$(authorization_marker_path create-release 16660949 48854568 v1.0.0)" "release: create release Pre 不消费凭证"

run_hook "$RELEASE_HOOK" '{"hook_event_name":"PostToolUse","tool_use_id":"release-v1","tool_name":"mcp__gitee-ent__create_enterprise_repo_release","tool_input":{"enterprise_id":16660949,"project_id":"48854568","release_tag_version":"v1.0.0","release_title":"v1.0.0","release_description":"test"},"tool_response":{"isError":false}}'
assert_exit 0 "release: create release 成功 Post 放行"
assert_file_missing "$(authorization_marker_path create-release 16660949 48854568 v1.0.0)" "release: create release 成功 Post 消费凭证"

write_action_marker create-release 16660949 48854568 v1.1.0
run_hook "$RELEASE_HOOK" '{"tool_use_id":"release-v1-ambiguous","tool_name":"mcp__gitee-ent__create_enterprise_repo_release","tool_input":{"enterprise_id":16660949,"project_id":"48854568","release_tag_version":"v1.1.0","release_title":"v1.1.0","release_description":"test"}}'
assert_exit 0 "release: create release 歧义 Post 前 claim 放行"
run_hook "$RELEASE_HOOK" '{"hook_event_name":"PostToolUse","tool_use_id":"release-v1-ambiguous","tool_name":"mcp__gitee-ent__create_enterprise_repo_release","tool_input":{"enterprise_id":16660949,"project_id":"48854568","release_tag_version":"v1.1.0"},"tool_response":{"isError":"false"}}'
assert_exit 0 "release: create release 畸形 Post 放行"
assert_file_exists "$(authorization_marker_path create-release 16660949 48854568 v1.1.0)" "release: create release 畸形 Post 保留凭证"
assert_file_missing "$(authorization_claim_path create-release 16660949 48854568 v1.1.0)" "release: create release 畸形 Post 释放占用"

# AI 管理入口：grant/revoke/revoke --all 全自动管理，不需要人类处理文件。
run_authorization grant --user-authorized merge-pr --enterprise-id 16660949 --project-id 48854568 --pull-request-id 21
assert_exit 0 "authorization: grant merge-pr 成功"
assert_file_exists "$(authorization_marker_path merge-pr 16660949 48854568 21)" "authorization: grant 写入 merge-pr 凭证"
assert_file_mode_600 "$(authorization_marker_path merge-pr 16660949 48854568 21)" "authorization: grant 凭证权限 0600"

run_authorization revoke merge-pr --enterprise-id 16660949 --project-id 48854568 --pull-request-id 21
assert_exit 0 "authorization: revoke merge-pr 成功"
assert_file_missing "$(authorization_marker_path merge-pr 16660949 48854568 21)" "authorization: revoke 删除 merge-pr 凭证"

run_authorization grant --user-authorized create-release --enterprise-id 16660949 --project-id 48854568 --release-tag-version v2.0.0
assert_exit 0 "authorization: grant create-release 成功"
run_authorization revoke --all
assert_exit 0 "authorization: revoke --all 成功"
assert_file_missing "$(authorization_marker_path create-release 16660949 48854568 v2.0.0)" "authorization: revoke --all 删除全部凭证"

run_authorization grant merge-pr --enterprise-id 16660949 --project-id 48854568 --pull-request-id 22
assert_exit 2 "authorization: grant 缺 user-authorized 拦截"
assert_stderr_has "--user-authorized" "authorization: grant 缺授权提示"

run_authorization_helper grant "$ACTION_TEST_ROOT" merge-pr 16660949 48854568 23
assert_exit 2 "authorization: helper direct grant 缺授权声明拦截"
assert_stderr_has "--user-authorized" "authorization: helper direct grant 缺授权提示"
teardown_action_test_repo

# 回归（G+）：标记按 branch 隔离，不同分支标记互不覆盖。
# 防本次缺陷复发——publish 在 worktree 写、hook 在主仓读，common dir 对称使其命中；
# 且并行多分支发布时，一条分支的 PR 消费（Post 撕票）不应误删另一分支标记。
write_publish_marker "feature/aaa"
write_publish_marker "feature/bbb"
assert_file_exists "$(publish_marker_path feature/aaa)" "release: G+ 并行 aaa 标记独立存在"
assert_file_exists "$(publish_marker_path feature/bbb)" "release: G+ 并行 bbb 标记独立存在"
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/aaa","target_branch":"master","title":"test"}}'
assert_exit 0 "release: G+ 并行场景 aaa PR 放行"
assert_file_exists "$(publish_marker_path feature/aaa)" "release: G+ aaa Pre 阶段不消费（延后到 Post）"
assert_file_exists "$(publish_marker_path feature/bbb)" "release: G+ bbb 标记不受 aaa 影响"
remove_publish_marker "feature/aaa"
remove_publish_marker "feature/bbb"

# G+ Post 隔离回归：Post 消费 aaa 不应误删 bbb（恢复跨分支隔离守卫意图）。
write_publish_marker "feature/aaa"
write_publish_marker "feature/bbb"
run_hook "$RELEASE_HOOK" '{"hook_event_name":"PostToolUse","tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/aaa","target_branch":"master","title":"test"},"tool_response":{"isError":false}}'
assert_exit 0 "release: G+ Post aaa 放行"
assert_file_missing "$(publish_marker_path feature/aaa)" "release: G+ Post aaa 被消费"
assert_file_exists "$(publish_marker_path feature/bbb)" "release: G+ Post aaa 消费不误删 bbb"
remove_publish_marker "feature/aaa"
remove_publish_marker "feature/bbb"

# PostToolUse 消费标记：只有 tool_response.isError=false 明确证明 PR 创建成功才撕票（ADR-0011）。
write_publish_marker "feature/x"
assert_file_exists "$(publish_marker_path feature/x)" "release: Post 消费前标记存在"
run_hook "$RELEASE_HOOK" '{"hook_event_name":"PostToolUse","tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","title":"test"},"tool_response":{"isError":false}}'
assert_exit 0 "release: Post create PR 放行（不阻断已执行工具）"
assert_file_missing "$(publish_marker_path feature/x)" "release: Post 创建成功消费标记"

# Post 响应缺失或类型畸形时不能证明成功，保留发布标记等待明确结果或 TTL。
write_publish_marker "feature/x"
run_hook "$RELEASE_HOOK" '{"hook_event_name":"PostToolUse","tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master"},"tool_response":{"isError":"false"}}'
assert_exit 0 "release: Post 畸形 isError 放行不阻断"
assert_file_exists "$(publish_marker_path feature/x)" "release: Post 畸形 isError 保留标记"
remove_publish_marker feature/x

# Post 缺 source_branch 不 consume（guard）：撕票需 source_branch 算路径，缺失则不动标记。
write_publish_marker "feature/x"
run_hook "$RELEASE_HOOK" '{"hook_event_name":"PostToolUse","tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"target_branch":"master","title":"test"},"tool_response":{"isError":false}}'
assert_exit 0 "release: Post 缺 source_branch 放行不阻断"
assert_file_exists "$(publish_marker_path feature/x)" "release: Post 缺 source_branch 不消费标记"
remove_publish_marker feature/x
teardown_publish_test_repo

# Slice 2 — block-issue-without-repo（核心：project_id 类型漂移回归基线）
# MCP schema: project_id 为 number。本组同时喂 number 与 string 两种形态，
# 防止正则退回 string-only 时 number 用例漏检（PR #11 / IJZ5WA 复现）。
ISSUE_HOOK=block-issue-without-repo.sh

# 字段缺失 → 拦
run_hook "$ISSUE_HOOK" '{"tool_input":{}}'
assert_exit 2 "issue: project_id 缺失拦截"

# number 合法值 → 放行（schema 原生形态，回归基线核心）
run_hook "$ISSUE_HOOK" '{"tool_input":{"project_id":48854568}}'
assert_exit 0 "issue: project_id=number 放行"

# number 0（Gitee 无关联哨兵）→ 拦
run_hook "$ISSUE_HOOK" '{"tool_input":{"project_id":0}}'
assert_exit 2 "issue: project_id=number 0 拦截"

# string 形态合法值 → 放行
run_hook "$ISSUE_HOOK" '{"tool_input":{"project_id":"48854568"}}'
assert_exit 0 "issue: project_id=string 放行"

# string "0" → 拦
run_hook "$ISSUE_HOOK" '{"tool_input":{"project_id":"0"}}'
assert_exit 2 "issue: project_id=string \"0\" 拦截"

# 子 issue 只传 parent_id、不传 project_id → 拦
run_hook "$ISSUE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_issue","tool_input":{"parent_id":33553306}}'
assert_exit 2 "issue: 子 issue 缺 project_id 拦截"
assert_stderr_has "子 issue 缺少 project_id" "issue: 子 issue 缺 project_id 提示"

# 子 issue 有 parent_id/project_id，但缺 program_id → 拦
run_hook "$ISSUE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_issue","tool_input":{"parent_id":33553306,"project_id":48854568}}'
assert_exit 2 "issue: 子 issue 缺 program_id 拦截"
assert_stderr_has "子 issue 缺少 program_id" "issue: 子 issue 缺 program_id 提示"

# 子 issue 同时继承 parent_id/project_id/program_id → 放行
run_hook "$ISSUE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_issue","tool_input":{"parent_id":33553306,"project_id":48854568,"program_id":883843}}'
assert_exit 0 "issue: 子 issue 继承父项归属放行"

# update 只改状态/标签，不要求重复传 project_id → 放行
run_hook "$ISSUE_HOOK" '{"tool_name":"mcp__gitee-ent__update_enterprise_issue","tool_input":{"issue_id":"IJZ5WA","issue_state_id":123,"label_ids":"342812299"}}'
assert_exit 0 "issue: 普通 update 放行"

# update 显式 project_id=0 → 拦
run_hook "$ISSUE_HOOK" '{"tool_name":"mcp__gitee-ent__update_enterprise_issue","tool_input":{"issue_id":"IJZ5WA","project_id":0}}'
assert_exit 2 "issue: update project_id=0 拦截"

# update 子 issue 时只传 parent_id、不补 project_id/program_id → 拦
run_hook "$ISSUE_HOOK" '{"tool_name":"mcp__gitee-ent__update_enterprise_issue","tool_input":{"issue_id":"IJZ74J","parent_id":33553306}}'
assert_exit 2 "issue: update 子 issue 缺归属拦截"

# update 子 issue 补齐 parent_id/project_id/program_id → 放行
run_hook "$ISSUE_HOOK" '{"tool_name":"mcp__gitee-ent__update_enterprise_issue","tool_input":{"issue_id":"IJZ74J","parent_id":33553306,"project_id":48854568,"program_id":883843}}'
assert_exit 0 "issue: update 子 issue 继承父项归属放行"

# ── 回归基线：string-only 正则在 number 形态下漏检 ──
# 直接验证「如果正则退回 string-only，number 输入会漏」这一事实，
# 不依赖 hook 当前实现。失败即说明回归防护失效（夹具本身坏了）。
STRING_ONLY_MATCH="$(printf '%s' '{"tool_input":{"project_id":48854568}}' \
  | grep -oE '"project_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1)"
if [ -z "$STRING_ONLY_MATCH" ]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAILURES+=("[issue 回归基线] string-only 正则竟匹配到 number 形态=\"${STRING_ONLY_MATCH}\"（应漏才对，说明基线失效）")
fi
TOTAL_BASELINE=1

# Slice 3 — block-push-to-master（git stub 隔离当前分支推断）
PUSH_HOOK=block-push-to-master.sh

setup_git_stub

# 显式 push origin master → 拦
export FAKE_BRANCH=feature/无关分支
run_hook "$PUSH_HOOK" '{"tool_input":{"command":"git push origin master"}}'
assert_exit 2 "push: 显式 master 拦截"
assert_stderr_has "master" "push: master 提示含 master"

# git 全局选项形式 push origin master → 拦
run_hook "$PUSH_HOOK" '{"tool_input":{"command":"git -C ../blue-whale-worktrees/task push origin master"}}'
assert_exit 2 "push: git -C master 拦截"
assert_stderr_has "master" "push: git -C master 提示含 master"

# JSON 转义引号不能截断 command 后绕过 master push 检测
run_hook "$PUSH_HOOK" '{"tool_input":{"command":"echo \"ready\"; git push origin master"}}'
assert_exit 2 "push: 转义引号后 master 拦截"
assert_stderr_has "master" "push: 转义引号后 master 提示含 master"

# 显式 push origin main → 拦
run_hook "$PUSH_HOOK" '{"tool_input":{"command":"git push origin main"}}'
assert_exit 2 "push: 显式 main 拦截"

# FAKE_BRANCH=master + 隐式 push（无 refspec）→ 拦（命中 fake git）
export FAKE_BRANCH=master
run_hook "$PUSH_HOOK" '{"tool_input":{"command":"git push"}}'
assert_exit 2 "push: 当前分支 master 隐式 push 拦截"
assert_stderr_has "master" "push: 隐式 master 提示含 master"

# FAKE_BRANCH=feature/x + 隐式 push → 放行（工单分支）
export FAKE_BRANCH=feature/x
run_hook "$PUSH_HOOK" '{"tool_input":{"command":"git push"}}'
assert_exit 0 "push: 当前分支 feature/x 隐式 push 放行"

# 显式 push origin feature/x → 放行
run_hook "$PUSH_HOOK" '{"tool_input":{"command":"git push origin feature/x"}}'
assert_exit 0 "push: 显式 feature/x 放行"

teardown_git_stub
unset FAKE_BRANCH

# Slice 4 — block-dangerous-git（复用 git stub 隔离当前分支）
DANGER_HOOK=block-dangerous-git.sh

setup_git_stub
export FAKE_BRANCH=feature/x

# 裸 --force → 无条件拦
run_hook "$DANGER_HOOK" '{"tool_input":{"command":"git push --force origin feature/x"}}'
assert_exit 2 "danger: 裸 --force 拦截"
assert_stderr_has "--force" "danger: --force 提示含 force"

# --force-with-lease 到工单分支 → 放行
run_hook "$DANGER_HOOK" '{"tool_input":{"command":"git push --force-with-lease origin feature/x"}}'
assert_exit 0 "danger: --force-with-lease feature/x 放行"

# git 全局选项形式的裸 --force → 拦
run_hook "$DANGER_HOOK" '{"tool_input":{"command":"git -C ../blue-whale-worktrees/task push --force origin feature/x"}}'
assert_exit 2 "danger: git -C 裸 --force 拦截"
assert_stderr_has "--force" "danger: git -C --force 提示含 force"

# git reset --hard → 拦
run_hook "$DANGER_HOOK" '{"tool_input":{"command":"git reset --hard HEAD~1"}}'
assert_exit 2 "danger: reset --hard 拦截"

# git clean -fd → 拦
run_hook "$DANGER_HOOK" '{"tool_input":{"command":"git clean -fd"}}'
assert_exit 2 "danger: clean -fd 拦截"

# git branch -D → 拦
run_hook "$DANGER_HOOK" '{"tool_input":{"command":"git branch -D feature/x"}}'
assert_exit 2 "danger: branch -D 拦截"

# git checkout . → 拦
run_hook "$DANGER_HOOK" '{"tool_input":{"command":"git checkout ."}}'
assert_exit 2 "danger: checkout . 拦截"

# git restore . → 拦
run_hook "$DANGER_HOOK" '{"tool_input":{"command":"git restore ."}}'
assert_exit 2 "danger: restore . 拦截"

teardown_git_stub
unset FAKE_BRANCH

# Slice 4.5 — block-master-edit（按 file_path 所属工作树判分支 + 仓库边界）
MASTER_EDIT_HOOK=block-master-edit.sh

setup_git_stub
# 两个工作树共存：主 checkout（master）+ worktree（工单分支）
export FAKE_BRANCH_MAP=$'/tmp/repo\tmaster\n/tmp/worktree\tfeature/ik096s'
export FAKE_TOPLEVEL_MAP=$'/tmp/repo\t/tmp/repo\n/tmp/worktree\t/tmp/worktree'

# 主 checkout master，Edit 主 checkout 内文件 → 拦
run_hook "$MASTER_EDIT_HOOK" '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/repo/src/a.py"}}'
assert_exit 2 "master-edit: 主 checkout master 文件拦截"

# 主 checkout session（cwd=master），Edit worktree 工单分支文件 → 放行
# 核心：按 file_path 所属工作树解析得工单分支，不靠「worktree 路径不在主 toplevel 前缀内」的布局假设
run_hook "$MASTER_EDIT_HOOK" '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/worktree/src/b.py"}}'
assert_exit 0 "master-edit: cwd=master 编辑 worktree 工单分支文件放行"

# 主 checkout session，Edit 仓库外 dotfile → 放行（-C 目录未命中 MAP → 非工作树）
run_hook "$MASTER_EDIT_HOOK" '{"tool_name":"Edit","tool_input":{"file_path":"/Users/x/.codex/config.toml"}}'
assert_exit 0 "master-edit: 仓库外 dotfile 放行"

# 非 Edit 工具 → 放行（无论 file_path 在哪个工作树）
run_hook "$MASTER_EDIT_HOOK" '{"tool_name":"Read","tool_input":{"file_path":"/tmp/repo/src/a.py"}}'
assert_exit 0 "master-edit: 非 Edit 工具放行"

# detached HEAD worktree（分支解析为空）→ 放行
export FAKE_BRANCH_MAP=$'/tmp/detached\t'
export FAKE_TOPLEVEL_MAP=$'/tmp/detached\t/tmp/detached'
run_hook "$MASTER_EDIT_HOOK" '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/detached/src/c.py"}}'
assert_exit 0 "master-edit: detached HEAD worktree 放行"

teardown_git_stub
unset FAKE_BRANCH FAKE_GIT_TOPLEVEL FAKE_BRANCH_MAP FAKE_TOPLEVEL_MAP

# Slice 4.6 — block-master-edit 真实 git 端到端
# stub 的 git -C 用纯前缀匹配，不模拟「目录不存在→失败」与「git -C . 退化 cwd」，
# 故 fail-open 回归（#1）与 file_path 缺失 fallback（#2）只能用真实 git 覆盖。
REAL_REPO="$(mktemp -d)"
git -C "$REAL_REPO" init -q
git -C "$REAL_REPO" symbolic-ref HEAD refs/heads/master  # 强制 master（防 git 默认 main）

# #1: master 仓库内 Write 全新子目录文件（父目录链不存在）→ 向上遍历应解析到 master → 拦
#     修复前：git -C <不存在目录> 失败 → BRANCH/TOPLEVEL 空 → 误判仓库外放行（fail-open）
run_hook "$MASTER_EDIT_HOOK" "$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/brand/new/sub/file.ts"}}' "$REAL_REPO")"
assert_exit 2 "master-edit(real): master 仓库内不存在子目录 Write 拦截（#1 fail-open 回归）"

# #2: file_path 缺失 → dirname("")="." → git -C "." 退化 cwd（=临时 master 仓库）→ 拦
#     锁定 fallback，防未来重构静默破坏
( cd "$REAL_REPO" && printf '%s' '{"tool_name":"Edit","tool_input":{}}' | bash "${HOOK_DIR}/${MASTER_EDIT_HOOK}" ) 2>/dev/null
RUN_EXIT=$?
assert_exit 2 "master-edit(real): file_path 缺失 cwd=master 退化拦截（#2 fallback 锁定）"

rm -rf "$REAL_REPO"

# 非 master 分支 + 不存在子目录 Write → 向上遍历解析得非 master → 放行
# 锁定 walk 不过度阻塞（与 #1 对称的 must-not-regress，stub 屏蔽 walk 故走真实 git）
FEATURE_REPO="$(mktemp -d)"
git -C "$FEATURE_REPO" init -q
git -C "$FEATURE_REPO" symbolic-ref HEAD refs/heads/feature/x
run_hook "$MASTER_EDIT_HOOK" "$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/brand/new/sub/f.ts"}}' "$FEATURE_REPO")"
assert_exit 0 "master-edit(real): 非 master 仓库不存在子目录 Write 放行（walk 不过度阻塞）"
rm -rf "$FEATURE_REPO"
unset REAL_REPO FEATURE_REPO

# Slice 5 — Codex project hook layer
assert_file_exists "$CODEX_HOOKS_JSON" "codex: hooks.json 存在"
assert_codex_hooks_valid "codex: hooks.json 与 Claude matcher 同步"
for runtime_hook in .claude/hooks/*.sh .codex/hooks/*.sh .claude/settings.json .codex/hooks.json; do
  assert_file_not_matches "$runtime_hook" 'permissionDecision[^[:alnum:]]*[=:][^[:alnum:]]*ask' "hooks: $runtime_hook 不包含 ask 运行机制"
done
for active_doc in CLAUDE.md CONTEXT.md .claude/rules/git-workflow.md docs/agents/commit-and-review.md docs/agents/worktree-workflow.md docs/agents/hooks/README.md; do
  assert_file_not_has_text "$active_doc" 'permissionDecision=ask' "docs: $active_doc 不再描述 ask 为活跃机制"
done
assert_git_not_ignored ".codex/hooks.json" "codex: hooks.json 可提交"
assert_git_not_ignored ".codex/hooks/run-claude-pretool.sh" "codex: wrapper 可提交"
assert_git_ignored ".codex/config.toml" "codex: config.toml 保持私密"
assert_git_ignored ".codex/local.json" "codex: 其它本机配置保持私密"
assert_git_ignored ".codex/hooks/other.sh" "codex: 禁止提交复制出来的 hook 实现"

# Slice 5.5 — 用户本地集成区 / Agent 任务区边界
assert_file_not_has_text ".githooks/pre-commit" "禁止在 master/main 上提交" "workflow: pre-commit 不再拦用户本地 master commit"
assert_file_not_has_text "scripts/start-task-worktree.sh" "git worktree" "workflow: shell 入口不复制 Git 业务逻辑"
assert_file_not_has_text "scripts/cleanup-task-worktree.sh" "sync-master.sh" "workflow: cleanup-task-worktree 不再同步用户本地 master"
assert_file_not_has_text "scripts/publish-review-package.sh" "任务 worktree 内执行" "workflow: publish-review-package 支持发布包装分支"
assert_file_has_text "scripts/start-task-worktree.py" '"fetch", "origin", "master"' "workflow: Python 入口先 fetch origin/master"
assert_file_has_text "scripts/start-task-worktree.py" '"merge", "--ff-only", "origin/master"' "workflow: 远程领先时 fast-forward"
assert_file_has_text "scripts/start-task-worktree.py" '"--no-ff"' "workflow: 分叉时普通 merge"
assert_file_has_text "scripts/start-task-worktree.py" '"worktree", "add", str(target), "-b", branch, base_sha' "workflow: worktree 基于同步后的精确 SHA"
assert_file_has_text "AGENTS.md" '`CLAUDE.md` 是本仓库团队 Agent 规则的唯一权威源' "workflow: AGENTS 索引 CLAUDE 权威源"
assert_file_not_has_text "scripts/merge-task-to-local-master.sh" "不允许含非 ASCII" "workflow: 本地合入不再拒绝中文分支"
assert_file_has_text ".githooks/pre-push" '--validate-branch "$branch"' "workflow: pre-push 复用结构化中文分支校验器"
assert_file_not_has_text ".githooks/pre-push" "纯 shell，零依赖" "workflow: pre-push 不再宣称零依赖"
assert_file_has_text "scripts/setup-hooks.sh" "Python 3" "workflow: 初始化说明披露 pre-push 的 Python 3 依赖"

setup_git_stub
export FAKE_BRANCH=feature/x

# Codex 包装命令必须能从 repo root 调到 .claude/hooks 权威脚本。
run_command_hook "$CODEX_BLOCK_PUSH_CMD" '{"tool_input":{"command":"git push origin master"}}'
assert_exit 2 "codex: push master 包装命令拦截"
assert_stderr_has "master" "codex: push master 包装命令提示"

run_command_hook "$CODEX_DANGER_CMD" '{"tool_input":{"command":"git push --force origin feature/x"}}'
assert_exit 2 "codex: dangerous git 包装命令拦截"
assert_stderr_has "--force" "codex: dangerous git 包装命令提示"

run_command_hook "$CODEX_DANGER_CMD" '{"tool_input":{"command":"git push --force-with-lease origin feature/x"}}'
assert_exit 0 "codex: force-with-lease 工单分支放行"

run_command_hook "$CODEX_SQUASH_CMD" '{"tool_input":{"merge_method":"squash"}}'
assert_exit 2 "codex: squash merge 包装命令拦截"

run_command_hook "$CODEX_ISSUE_CMD" '{"tool_name":"mcp__gitee-ent__update_enterprise_issue","tool_input":{"issue_id":"IJZ5WA","issue_state_id":123,"label_ids":"342812299"}}'
assert_exit 0 "codex: 普通 update issue 放行"

run_command_hook "$CODEX_ISSUE_CMD" '{"tool_name":"mcp__gitee-ent__update_enterprise_issue","tool_input":{"issue_id":"IJZ74J","parent_id":33553306}}'
assert_exit 2 "codex: update 子 issue 缺归属拦截"

run_command_hook "$CODEX_RELEASE_CMD" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","draft":"true","title":"test"}}'
assert_exit 2 "codex: draft PR 包装命令拦截"
assert_stderr_has "不使用 draft PR" "codex: draft PR 包装命令提示普通 PR"

run_command_hook "$CODEX_RELEASE_CMD" '{"tool_input":{"command":"git push -u origin feature/x"}}'
assert_exit 2 "codex: 直接 git push 包装命令拦截"
assert_stderr_has "直接 git push" "codex: 直接 git push 包装命令提示"

run_command_hook "$CODEX_RELEASE_CMD" '{"tool_input":{"command":"scripts/publish-review-package.sh --user-authorized"}}'
assert_exit 0 "codex: release 授权入口无交互放行"
assert_stdout_empty "codex: release 授权入口无输出"

run_command_hook "$CODEX_RELEASE_CMD" '{"tool_input":{"command":"git commit -m \"feat: task slice\""}}'
assert_exit 2 "codex: direct commit 硬阻断"
assert_stderr_has "commit-task-for-review.sh -m" "codex: direct commit 指向标准入口"

run_command_hook "$CODEX_RELEASE_CMD" '{"tool_input":{"command":"git commit --amend"}}'
assert_exit 2 "codex: direct commit --amend 硬阻断"
assert_stderr_has "commit-task-for-review.sh --amend" "codex: direct commit --amend 文案含 --amend 指引"

run_command_hook "$CODEX_RELEASE_CMD" '{"tool_input":{"command":"scripts/merge-task-to-local-master.sh --user-authorized feature/x"}}'
assert_exit 0 "codex: local merge 授权入口无交互放行"
assert_stdout_empty "codex: local merge 授权入口无输出"

# 一次性凭证依赖真实 git common-dir/hash-object；前面的 fake git 只用于分支查询型 gate。
teardown_git_stub
unset FAKE_BRANCH

setup_action_test_repo
write_action_marker merge-pr 16660949 48854568 31
run_command_hook "$CODEX_RELEASE_CMD" '{"tool_use_id":"codex-merge-31","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":31,"merge_method":"merge"}}'
assert_exit 0 "codex: merge PR 有凭证放行"
assert_file_exists "$(authorization_marker_path merge-pr 16660949 48854568 31)" "codex: merge PR Pre 保留凭证"

run_command_hook "$CODEX_RELEASE_POST_CMD" '{"hook_event_name":"PostToolUse","tool_use_id":"codex-merge-31","tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"enterprise_id":16660949,"project_id":"48854568","pull_request_id":31,"merge_method":"merge"},"tool_response":{"isError":false}}'
assert_exit 0 "codex: merge PR Post 放行"
assert_file_missing "$(authorization_marker_path merge-pr 16660949 48854568 31)" "codex: merge PR Post 消费凭证"
teardown_action_test_repo

# Slice 6 — cleanup-release-branch.sh（真实临时 git 仓库集成测试）
# 现有夹具只做 hook 层黑盒；本组用真实裸 origin + clone 仓库驱动
# cleanup-release-branch.sh 的公共 CLI 行为（exit code + git 副作用）。
# 夹具：mktemp 临时仓库，cp 真实 scripts/lib/worktree-paths.sh + 待测脚本进去，
# ROOT 取到临时仓库、lib 能 source 到、git 操作隔离（不碰真实仓库）。

# run_repo_script <cwd> <script-and-args...>
# 在 cwd 下跑脚本，捕获 exit→RUN_EXIT / stdout→RUN_STDOUT / stderr→RUN_STDERR（与 run_hook 同口径）。
run_repo_script() {
  local cwd="$1"; shift
  local out err
  out="$(mktemp)"; err="$(mktemp)"
  ( cd "$cwd" && bash "$@" ) >"$out" 2>"$err"
  RUN_EXIT=$?
  RUN_STDOUT="$(cat "$out")"
  RUN_STDERR="$(cat "$err")"
  rm -f "$out" "$err"
}

# build_repo_at <repo-path> <origin-path>
# 在指定路径建一个干净的 master 仓库（含待测脚本 + lib），远端推一个 bare origin。
build_repo_at() {
  local repo="$1" origin="$2"
  git init --bare "$origin" >/dev/null 2>&1
  git init "$repo" >/dev/null 2>&1
  mkdir -p "$repo/scripts/lib"
  cp "$REPO_ROOT/scripts/lib/worktree-paths.sh" "$repo/scripts/lib/"
  cp "$REPO_ROOT/scripts/cleanup-release-branch.sh" "$repo/scripts/"
  (
    cd "$repo"
    git config user.email t@t
    git config user.name t
    git config core.editor true
    git commit --allow-empty -m init >/dev/null 2>&1
    git add scripts
    git commit -m "add scripts" >/dev/null 2>&1
    git branch -M master
    git remote add origin "$origin"
    git push -q origin master >/dev/null 2>&1
  )
}

RELEASE_TMP_LIST=()
# setup_release_repo：建一个标准主 checkout 形态仓库（非 worktree），路径存 RELEASE_TMP 供子测试用。
setup_release_repo() {
  RELEASE_TMP="$(mktemp -d)"
  RELEASE_TMP_LIST+=("$RELEASE_TMP")
  build_repo_at "$RELEASE_TMP/main" "$RELEASE_TMP/origin.git"
}
teardown_release_repos() {
  for t in "${RELEASE_TMP_LIST[@]}"; do rm -rf "$t"; done
}

# L1 — 参数层
setup_release_repo
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh
assert_exit 1 "release-cleanup: 缺 --user-authorized 拦截"
assert_stderr_has "缺少 --user-authorized" "release-cleanup: 缺授权提示"

setup_release_repo
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh --user-authorized
assert_exit 1 "release-cleanup: 缺分支名拦截"
assert_stderr_has "缺少发布包装分支名" "release-cleanup: 缺分支名提示"

setup_release_repo
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh -h
assert_exit 2 "release-cleanup: -h 走 usage exit 2"

setup_release_repo
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh --bogus
assert_exit 2 "release-cleanup: 未知参数走 usage exit 2"

# L1b — ROOT 推导锁定：从非 git 目录用绝对路径调用带授权+白名单分支，
# BASH_SOURCE 正确解析 ROOT → 走到「本地分支不存在」校验 exit 1；
# rev-parse 在非 git cwd 赋值吞 git exit 128 → set -e 崩在 ROOT 行（exit 128，stderr 是 git fatal）。
# 本用例锁住 BASH_SOURCE 写法，防回退 rev-parse。
setup_release_repo
empty_cwd="$(mktemp -d)"; RELEASE_TMP_LIST+=("$empty_cwd")
run_repo_script "$empty_cwd" "$RELEASE_TMP/main/scripts/cleanup-release-branch.sh" --user-authorized feature/never-exists
assert_exit 1 "release-cleanup: 非 repo cwd 绝对路径调用仍解析 ROOT 走到分支校验"
assert_stderr_has "本地分支不存在" "release-cleanup: 绝对路径调用走到分支存在校验（非 rev-parse 崩）"

# L2 — 校验层（任一失败 exit 1，分支不动）
# 在 worktree 形态路径内执行 → 拦（worktree-paths.sh 把父名 blue-whale-worktrees 识别为 worktree 区）
WT_TMP="$(mktemp -d)"; RELEASE_TMP_LIST+=("$WT_TMP")
build_repo_at "$WT_TMP/blue-whale-worktrees/main" "$WT_TMP/origin.git"
run_repo_script "$WT_TMP/blue-whale-worktrees/main" scripts/cleanup-release-branch.sh --user-authorized feature/x-release
assert_exit 1 "release-cleanup: 在 worktree 内拦截"
assert_stderr_has "任务 worktree" "release-cleanup: worktree 提示"

# 当前非 master → 拦
setup_release_repo
git -C "$RELEASE_TMP/main" checkout -b feature/other >/dev/null 2>&1
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh --user-authorized feature/x-release
assert_exit 1 "release-cleanup: 非 master 当前分支拦截"
assert_stderr_has "切回本地 master" "release-cleanup: 非 master 提示"

# 工作区不干净 → 拦（HEAD 仍在 master，制造未跟踪文件）
setup_release_repo
echo dirty > "$RELEASE_TMP/main/dirty.txt"
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh --user-authorized feature/x-release
assert_exit 1 "release-cleanup: 工作区不干净拦截"
assert_stderr_has "工作区不干净" "release-cleanup: 不干净提示"

# 非白名单前缀 → 拦
setup_release_repo
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh --user-authorized release/x
assert_exit 1 "release-cleanup: 非白名单前缀拦截"
assert_stderr_has "白名单前缀" "release-cleanup: 白名单提示"

# L3 — 合并守卫：未合并进 origin/master → 拦且分支不删
setup_release_repo
git -C "$RELEASE_TMP/main" checkout -b feature/y-release >/dev/null 2>&1
git -C "$RELEASE_TMP/main" commit --allow-empty -m "release work" >/dev/null 2>&1
git -C "$RELEASE_TMP/main" checkout master >/dev/null 2>&1
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh --user-authorized feature/y-release
assert_exit 1 "release-cleanup: 未合并分支拦截"
assert_stderr_has "尚未被 origin/master 包含" "release-cleanup: 未合并提示"
if git -C "$RELEASE_TMP/main" show-ref --verify --quiet refs/heads/feature/y-release; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1)); FAILURES+=("[release-cleanup: 未合并分支应留存] feature/y-release 被误删")
fi

# L4 — 删除层：happy path（已合并 + 远程也有）→ exit 0，本地/远程双删
setup_release_repo
git -C "$RELEASE_TMP/main" checkout -b feature/x-release >/dev/null 2>&1
git -C "$RELEASE_TMP/main" commit --allow-empty -m "release content" >/dev/null 2>&1
git -C "$RELEASE_TMP/main" checkout master >/dev/null 2>&1
git -C "$RELEASE_TMP/main" merge --no-ff --no-edit feature/x-release >/dev/null 2>&1
git -C "$RELEASE_TMP/main" push -q origin master >/dev/null 2>&1
git -C "$RELEASE_TMP/main" push -q origin feature/x-release >/dev/null 2>&1
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh --user-authorized feature/x-release
assert_exit 0 "release-cleanup: happy path 成功"
if git -C "$RELEASE_TMP/main" show-ref --verify --quiet refs/heads/feature/x-release; then
  FAIL=$((FAIL + 1)); FAILURES+=("[release-cleanup: 本地分支应删] feature/x-release 仍存在")
else
  PASS=$((PASS + 1))
fi
if git -C "$RELEASE_TMP/main" ls-remote --exit-code --heads origin feature/x-release >/dev/null 2>&1; then
  FAIL=$((FAIL + 1)); FAILURES+=("[release-cleanup: 远程分支应删] origin feature/x-release 仍存在")
else
  PASS=$((PASS + 1))
fi

# lag：本地 master 落后 origin/master（PR 已合远端、本地未拉）→ 仍能清理。
# ADR-0010 核心：本地 master 是用户集成区，未必含 origin/master。
# 此用例锁定「用 update-ref -d 而非 branch -d」——后者在本地 master 落后时会误判未合并而拒绝。
setup_release_repo
git -C "$RELEASE_TMP/main" checkout -b feature/lag-release >/dev/null 2>&1
git -C "$RELEASE_TMP/main" commit --allow-empty -m "lagged release" >/dev/null 2>&1
git -C "$RELEASE_TMP/main" checkout master >/dev/null 2>&1
git -C "$RELEASE_TMP/main" push -q origin feature/lag-release >/dev/null 2>&1
# 模拟 PR 合并：fast-forward 推 origin/master 到该分支（本地 master 不动）
git -C "$RELEASE_TMP/main" push -q origin feature/lag-release:master >/dev/null 2>&1
git -C "$RELEASE_TMP/main" fetch -q origin >/dev/null 2>&1
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh --user-authorized feature/lag-release
assert_exit 0 "release-cleanup: 本地 master 落后仍能清理"
if git -C "$RELEASE_TMP/main" show-ref --verify --quiet refs/heads/feature/lag-release; then
  FAIL=$((FAIL + 1)); FAILURES+=("[release-cleanup: lag 本地分支应删] feature/lag-release 仍存在")
else
  PASS=$((PASS + 1))
fi
if git -C "$RELEASE_TMP/main" ls-remote --exit-code --heads origin feature/lag-release >/dev/null 2>&1; then
  FAIL=$((FAIL + 1)); FAILURES+=("[release-cleanup: lag 远程分支应删] origin feature/lag-release 仍存在")
else
  PASS=$((PASS + 1))
fi

# 幂等：远程源分支已不存在（他处已删 / 仅本地残留），本地仍存在 → 仍清本地且 exit 0。
# 锁定 L65 ls-remote --exit-code 返回 2（远程无）时跳过 push、不报错、本地照删。
# 本脚本相对 cleanup-task-worktree 的差异价值：远程已无时不因探活非零而失败。
setup_release_repo
git -C "$RELEASE_TMP/main" checkout -b feature/idem-release >/dev/null 2>&1
git -C "$RELEASE_TMP/main" commit --allow-empty -m "idem release" >/dev/null 2>&1
git -C "$RELEASE_TMP/main" checkout master >/dev/null 2>&1
git -C "$RELEASE_TMP/main" merge --no-ff --no-edit feature/idem-release >/dev/null 2>&1
git -C "$RELEASE_TMP/main" push -q origin master >/dev/null 2>&1
# 不 push feature/idem-release：远程无此分支，模拟「他处已删远程、本地残留」
run_repo_script "$RELEASE_TMP/main" scripts/cleanup-release-branch.sh --user-authorized feature/idem-release
assert_exit 0 "release-cleanup: 远程已无时仍清本地（幂等）"
if git -C "$RELEASE_TMP/main" show-ref --verify --quiet refs/heads/feature/idem-release; then
  FAIL=$((FAIL + 1)); FAILURES+=("[release-cleanup: 幂等本地分支应删] feature/idem-release 仍存在")
else
  PASS=$((PASS + 1))
fi

teardown_release_repos

# ── summary ────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL))
echo "────────────────────────────────────────"
printf '通过 %d / %d\n' "$PASS" "$TOTAL"
if [ "$FAIL" -gt 0 ]; then
  echo "失败用例："
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
echo "全 ${TOTAL} 用例通过"
exit 0
