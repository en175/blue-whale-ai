#!/usr/bin/env bash
# .claude/hooks/ PreToolUse 拦截器的纯 bash 测试夹具。
#
# 设计契约（与 hook 一致）：
#   - 零测试框架依赖（不引 bats/jq）；安全敏感 hook 可复用 Python helper 做真实 JSON/shell 解析。
#   - seam = stdin JSON → exit code + stderr 黑盒边界（hook 本身即 public boundary）。
#   - 退出码：全用例过 → 0；任一失败 → 非 0。CI/手测一键判过。
#
# 跑法：bash scripts/test-hooks.sh
#
# 为什么存在：PR #11 的 block-issue-without-repo.sh 首版正则只匹配 string，
# 漏了 MCP schema 里 project_id 的 number 形态，「三场景空跑通过」是假绿
# （IJZ5WA 复现）。手写测试输入凭直觉写字符串、不对照真实 schema 类型是根因。
# 本夹具强制：输入 JSON 字段类型须以 MCP tools/list schema 为准。

set -u

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.claude/hooks" && pwd)"

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

# git push 修改远程 → 触发用户确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git push -u origin feature/x"}}'
assert_exit 0 "release: git push 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: git push stdout 含 ask"

# git 全局选项形式也应触发确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"git -C ../blue-whale-worktrees/task push origin feature/x"}}'
assert_exit 0 "release: git -C push 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: git -C push stdout 含 ask"

# JSON 转义引号不能截断 command 后绕过 push 检测
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"echo \"ready\"; git push origin feature/x"}}'
assert_exit 0 "release: 转义引号后 git push 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: 转义引号后 git push stdout 含 ask"

# 项目发布脚本内部会 push → 触发用户确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/publish-task-branch.sh"}}'
assert_exit 0 "release: publish-task-branch 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: publish-task-branch stdout 含 ask"

# 项目清理脚本可能删除远程源分支 → 触发用户确认
run_hook "$RELEASE_HOOK" '{"tool_input":{"command":"scripts/cleanup-task-worktree.sh"}}'
assert_exit 0 "release: cleanup-task-worktree 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: cleanup-task-worktree stdout 含 ask"

# 创建 draft PR → 触发用户确认
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","draft":"true","title":"test"}}'
assert_exit 0 "release: draft PR 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: draft PR stdout 含 ask"

# 创建非 draft PR → 阻断
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","draft":"false","title":"test"}}'
assert_exit 2 "release: 非 draft PR 拦截"
assert_stderr_has "draft=true" "release: 非 draft PR 提示 draft=true"

# 创建 PR 缺 draft → 阻断
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"master","title":"test"}}'
assert_exit 2 "release: 缺 draft PR 拦截"

# 创建非 master 目标 PR → 阻断
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_pull","tool_input":{"source_branch":"feature/x","target_branch":"develop","draft":"true","title":"test"}}'
assert_exit 2 "release: 非 master 目标 PR 拦截"

# 合并 PR → 单独触发用户确认
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__merge_enterprise_pull","tool_input":{"pull_request_id":12,"merge_method":"merge"}}'
assert_exit 0 "release: merge PR 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: merge PR stdout 含 ask"

# 创建 release → 单独触发用户确认
run_hook "$RELEASE_HOOK" '{"tool_name":"mcp__gitee-ent__create_enterprise_repo_release","tool_input":{"release_tag_version":"v1.0.0","release_title":"v1.0.0","release_description":"test"}}'
assert_exit 0 "release: create release 触发确认"
assert_stdout_has '"permissionDecision":"ask"' "release: create release stdout 含 ask"

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
