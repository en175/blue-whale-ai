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

# ── git stub（隔离 git rev-parse，不碰真实仓库）────────────────
# push-to-master / dangerous-git 的「无显式 refspec → 查当前分支」分支，
# 用 PATH 注入临时 fake git：只响应 rev-parse --abbrev-ref HEAD → $FAKE_BRANCH。
STUB_DIR=""
SAVED_PATH="$PATH"

setup_git_stub() {
  STUB_DIR="$(mktemp -d)"
  cat >"${STUB_DIR}/git" <<'EOF'
#!/usr/bin/env bash
# fake git：仅响应 rev-parse --abbrev-ref HEAD（返回 $FAKE_BRANCH）。
if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ] && [ "$3" = "HEAD" ]; then
  echo "${FAKE_BRANCH:-master}"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
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

publish_marker_path() {
  local branch="${1:-feature/x}"
  local slug="$(printf '%s' "$branch" | tr '/' '%')"
  local common="$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
  case "$common" in
    "") common="$REPO_ROOT/.git" ;;
    /*) ;;
    *)  common="$REPO_ROOT/$common" ;;
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

claude_items = claude["hooks"]["PreToolUse"]
codex_items = codex["hooks"]["PreToolUse"]

def shape(items):
    return [(item["matcher"], len(item.get("hooks", []))) for item in items]

if shape(claude_items) != shape(codex_items):
    raise SystemExit(f"matcher/hook shape mismatch: claude={shape(claude_items)} codex={shape(codex_items)}")

matchers = [item["matcher"] for item in codex_items]
required = {
    "Bash",
    "Read|Glob",
    "mcp__gitee-ent__create_enterprise_repo_pull",
    "mcp__gitee-ent__merge_enterprise_pull",
    "mcp__gitee-ent__create_enterprise_repo_release",
    "mcp__gitee-ent__create_enterprise_issue",
    "mcp__gitee-ent__update_enterprise_issue",
}
missing = sorted(required - set(matchers))
if missing:
    raise SystemExit(f"missing Codex matcher(s): {missing}")

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
            f"script mismatch at PreToolUse[{index}] matcher={claude_item['matcher']}: "
            f"claude={claude_scripts} codex={codex_scripts}"
        )
    script_count += len(codex_scripts)

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
  python3 - "$CODEX_HOOKS_JSON" "$script" <<'PY'
import json
import os
import shlex
import sys
from pathlib import Path

codex = json.loads(Path(sys.argv[1]).read_text())
wanted = sys.argv[2]
matches = []
for item in codex["hooks"]["PreToolUse"]:
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

# 新发布审查包入口带授权参数 → 只触发一次确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/publish-review-package.sh --user-authorized"}}'
assert_exit 0 "release: publish-review-package 授权入口触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: publish-review-package stdout 含 ask"

# 直接本地 commit / merge --no-ff 也必须经过本地验收授权门。
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git commit -m \"feat: task slice\""}}'
assert_exit 0 "release: 直接 git commit 触发确认"
assert_stdout_starts_with '{"hookSpecificOutput"' "release: 直接 git commit stdout 为纯 JSON"
assert_stdout_has '"permissionDecision":"ask"' "release: 直接 git commit stdout 含 ask"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git merge --no-ff feature/x"}}'
assert_exit 0 "release: 直接 git merge --no-ff 触发确认"
assert_stdout_starts_with '{"hookSpecificOutput"' "release: 直接 git merge --no-ff stdout 为纯 JSON"
assert_stdout_has '"permissionDecision":"ask"' "release: 直接 git merge --no-ff stdout 含 ask"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git merge feature/x"}}'
assert_exit 0 "release: 直接 git merge 工单分支触发确认"
assert_stdout_starts_with '{"hookSpecificOutput"' "release: 直接 git merge 工单分支 stdout 为纯 JSON"
assert_stdout_has '"permissionDecision":"ask"' "release: 直接 git merge 工单分支 stdout 含 ask"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git merge --ff-only origin/master"}}'
assert_exit 0 "release: git merge --ff-only 同步放行"
assert_stdout_not_has '"permissionDecision":"ask"' "release: git merge --ff-only 不触发确认"

# 标准本地验收入口缺授权参数 → 硬拦；带授权参数 → 触发确认。
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/commit-task-for-review.sh -m \"feat: task slice\""}}'
assert_exit 2 "release: commit-task-for-review 缺参数被拦截"
assert_stderr_has "--user-authorized" "release: commit-task-for-review 缺参数提示授权参数"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/commit-task-for-review.sh --user-authorized -m \"feat: task slice\""}}'
assert_exit 0 "release: commit-task-for-review 授权入口触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: commit-task-for-review stdout 含 ask"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/merge-task-to-local-master.sh feature/x"}}'
assert_exit 2 "release: merge-task-to-local-master 缺参数被拦截"
assert_stderr_has "--user-authorized" "release: merge-task-to-local-master 缺参数提示授权参数"

run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/merge-task-to-local-master.sh --user-authorized feature/x"}}'
assert_exit 0 "release: merge-task-to-local-master 授权入口触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: merge-task-to-local-master stdout 含 ask"

# bash 包裹新发布审查包入口带授权参数 → 仍应触发确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"bash scripts/publish-review-package.sh --user-authorized"}}'
assert_exit 0 "release: bash publish-review-package 授权入口触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: bash publish-review-package stdout 含 ask"

# bash -lc 包裹标准入口仍应识别
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"bash -lc \"scripts/publish-review-package.sh --user-authorized\""}}'
assert_exit 0 "release: bash -lc publish-review-package 授权入口触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: bash -lc publish-review-package stdout 含 ask"

# 项目清理脚本依靠自身校验，不在发布 Hook 中弹确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/cleanup-task-worktree.sh"}}'
assert_exit 0 "release: cleanup-task-worktree 放行"

# 主 checkout 验证 worktree 脚本硬停的复合命令不应误触发发布确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"cd /Users/jj.reno/Blue-Whale\n# 主 checkout 跑 worktree 脚本应硬停\nscripts/cleanup-task-worktree.sh 2>&1; echo \"exit=$?\"\necho \"---\"\nscripts/publish-task-branch.sh 2>&1; echo \"exit=$?\"\necho \"---\"\nscripts/ensure-graphify-worktree.sh 2>&1; echo \"exit=$?\""}}'
assert_exit 0 "release: 复合验证命令放行"

# 只验证清理/graphify 脚本时不应误触发发布确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"cd /Users/jj.reno/Blue-Whale\nscripts/cleanup-task-worktree.sh 2>&1; echo \"exit=$?\"\necho \"---\"\nscripts/ensure-graphify-worktree.sh 2>&1; echo \"exit=$?\""}}'
assert_exit 0 "release: 非发布验证复合命令放行"

# 创建合法普通 PR（缺 draft）→ 只校验形态，不二次确认
write_publish_marker "feature/x"
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","title":"test"}}'
assert_exit 0 "release: 普通 PR 放行不二次确认"
assert_stdout_not_has '"permissionDecision":"ask"' "release: 普通 PR 不二次确认"
assert_file_missing "$(publish_marker_path feature/x)" "release: 普通 PR 消费发布审查包标记"

# 创建显式非 draft PR → 只校验形态，不二次确认
write_publish_marker "feature/x"
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","draft":"false","title":"test"}}'
assert_exit 0 "release: 非 draft PR 放行不二次确认"
assert_stdout_not_has '"permissionDecision":"ask"' "release: 非 draft PR 不二次确认"
assert_file_missing "$(publish_marker_path feature/x)" "release: 非 draft PR 消费发布审查包标记"

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

# 合并 PR → 单独触发用户确认
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"pull_request_id":12,"merge_method":"merge"}}'
assert_exit 0 "release: merge PR 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: merge PR stdout 含 ask"

# 创建 release → 单独触发用户确认
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_release","tool_input":{"release_tag_version":"v1.0.0","release_title":"v1.0.0","release_description":"test"}}'
assert_exit 0 "release: create release 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: create release stdout 含 ask"

# 回归（G+）：标记按 branch 隔离，不同分支标记互不覆盖。
# 防本次缺陷复发——publish 在 worktree 写、hook 在主仓读，common dir 对称使其命中；
# 且并行多分支发布时，一条分支的 PR 消费不应误删另一分支标记。
write_publish_marker "feature/aaa"
write_publish_marker "feature/bbb"
assert_file_exists "$(publish_marker_path feature/aaa)" "release: G+ 并行 aaa 标记独立存在"
assert_file_exists "$(publish_marker_path feature/bbb)" "release: G+ 并行 bbb 标记独立存在"
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/aaa","target_branch":"master","title":"test"}}'
assert_exit 0 "release: G+ 并行场景 aaa PR 放行"
assert_file_missing "$(publish_marker_path feature/aaa)" "release: G+ aaa 标记被消费"
assert_file_exists "$(publish_marker_path feature/bbb)" "release: G+ bbb 标记不受 aaa 消费影响"
remove_publish_marker "feature/bbb"

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

# Slice 5 — Codex project hook layer
assert_file_exists "$CODEX_HOOKS_JSON" "codex: hooks.json 存在"
assert_codex_hooks_valid "codex: hooks.json 与 Claude matcher 同步"
assert_git_not_ignored ".codex/hooks.json" "codex: hooks.json 可提交"
assert_git_not_ignored ".codex/hooks/run-claude-pretool.sh" "codex: wrapper 可提交"
assert_git_ignored ".codex/config.toml" "codex: config.toml 保持私密"
assert_git_ignored ".codex/local.json" "codex: 其它本机配置保持私密"
assert_git_ignored ".codex/hooks/other.sh" "codex: 禁止提交复制出来的 hook 实现"

# Slice 5.5 — 用户本地集成区 / Agent 任务区边界
assert_file_not_has_text ".githooks/pre-commit" "禁止在 master/main 上提交" "workflow: pre-commit 不再拦用户本地 master commit"
assert_file_not_has_text "scripts/start-task-worktree.sh" "sync-master.sh" "workflow: start-task-worktree 不再要求同步本地 master"
assert_file_not_has_text "scripts/cleanup-task-worktree.sh" "sync-master.sh" "workflow: cleanup-task-worktree 不再同步用户本地 master"
assert_file_not_has_text "scripts/publish-review-package.sh" "任务 worktree 内执行" "workflow: publish-review-package 支持发布包装分支"
assert_file_has_text "scripts/start-task-worktree.sh" 'worktree add "$target" -b "$branch" origin/master' "workflow: task worktree 默认基于 origin/master"

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
assert_exit 2 "codex: release ask 转硬阻断"
assert_stderr_has "requires explicit user confirmation" "codex: release ask 转硬阻断提示"

run_command_hook "$CODEX_RELEASE_CMD" '{"tool_input":{"command":"git commit -m \"feat: task slice\""}}'
assert_exit 2 "codex: direct commit ask 转硬阻断"
assert_stderr_has "requires explicit user confirmation" "codex: direct commit ask 转硬阻断提示"

run_command_hook "$CODEX_RELEASE_CMD" '{"tool_input":{"command":"scripts/merge-task-to-local-master.sh --user-authorized feature/x"}}'
assert_exit 2 "codex: local merge ask 转硬阻断"
assert_stderr_has "requires explicit user confirmation" "codex: local merge ask 转硬阻断提示"

teardown_git_stub
unset FAKE_BRANCH

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
