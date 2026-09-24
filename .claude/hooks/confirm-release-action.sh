#!/usr/bin/env bash
# Claude Code / Codex PreToolUse + PostToolUse — Agent 授权流程兜底（仅本项目）
# JSON 与 shell 命令解析委托给 lib/pretool.py，避免转义引号和 git 全局选项绕过。
#
# 兜底对象：
#   - Bash: 任务分支的普通 commit / push / merge 放行；发布基线 release/* 直推硬拦
#   - Bash: 发布 create/update / 合入标准入口带 --user-authorized 无交互放行；同步入口出现即放行
#   - Bash: 任务分支错误 merge/pull 与 release 工作树直接 commit/pull/merge/rebase/cherry-pick 硬拦
#   - mcp__gitee-ent__create_enterprise_repo_pull: 创建 Gitee PR
#   - mcp__gitee-ent__merge_enterprise_pull: 合并 Gitee PR
#   - mcp__gitee-ent__create_enterprise_repo_release: 创建 Gitee release
#
# 规则：
#   - 发布审查包只允许通过标准入口触发；--user-authorized 即 Agent 对人类授权的声明。
#   - 普通任务分支 push 不需要发布授权；保护分支与发布审查包不得绕过入口。
#   - 创建 PR 校验标准入口写入的短期标记（target、source_branch、draft）；
#     Pre 放行、PostToolUse 成功后消费标记（失败可重试，见 ADR-0011）。
#   - 合并 PR / 创建 release 使用 AI 自动生成、绑定对象、TTL 900s 的一次性凭证。
#   - Pre 仅校验，Post 成功后消费；失败保留凭证供有限重试。
#
# 输出契约：
#   - stdout 保持为空
#   - stderr 仅用于阻断时说明原因
#   - exit 0 = 放行；exit 2 = 阻断并向 Agent 提供纠偏入口

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PRETOOL="$HOOK_DIR/lib/pretool.py"
AUTH_HELPER="$HOOK_DIR/lib/authorization.py"
AUDIT="$HOOK_DIR/lib/hook_audit.py"
HOOK_NAME="$(basename "$0")"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
MARKER_TTL_SECONDS=900

# squash/rebase 方法拦截的共享逻辑（lib/merge-method-check.sh），
# 与 block-squash-merge.sh 共用，避免判定 + 消息文案双份漂移。
# shellcheck source=lib/merge-method-check.sh
. "$HOOK_DIR/lib/merge-method-check.sh"

extract_json_value() {
  key="$1"
  printf '%s' "$INPUT" | python3 "$PRETOOL" value "$key" 2>/dev/null || true
}

audit() {
  printf '%s' "$INPUT" | python3 "$AUDIT" \
    --project-dir "$PROJECT_DIR" \
    --hook "$HOOK_NAME" \
    --operation "$AUDIT_OPERATION" \
    --exit-code "$1" \
    --reason "$2" >/dev/null || true
}

allow() {
  audit 0 "allowed-policy"
  exit 0
}

block() {
  reason="$1"
  audit 2 "blocked-policy"
  cat >&2 <<EOF
BLOCKED: ${reason}

本项目发布动作必须遵守：
		- 首次发布使用 scripts/publish-review-package.sh --user-authorized --create-pr
		- 已有 PR 更新使用 scripts/publish-review-package.sh --user-authorized --update-pr <PR编号>
		- 分支落后时，Agent 依据规则主动运行 scripts/sync-task-from-origin.sh sync；Hook 不自动同步
	- 本地任务提交走 scripts/commit-task-for-review.sh（出现即放行）
	- 创建 PR 的 draft 必须与发布入口标记一致
	- 合并 PR / 创建 release 必须由 Agent 自动生成绑定具体对象的一次性凭证

详见 CLAUDE.md「发布动作必须先获用户授权」。
EOF
  exit 2
}

tool_response_succeeded() {
  printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
if "tool_response" in data:
    response = data.get("tool_response")
    raise SystemExit(0 if isinstance(response, dict) and response.get("isError") is False else 1)
# Kimi CLI：PostToolUse 仅在工具成功时触发（失败走 PostToolUseFailure），
# 载荷成功输出字段是 tool_output（无 tool_response），事件本身即成功证明。
if "tool_output" in data:
    raise SystemExit(0)
raise SystemExit(1)
' 2>/dev/null
}

action_subject() {
  case "$1" in
    merge-pr) extract_json_value "pull_request_id" ;;
    create-release) extract_json_value "release_tag_version" ;;
    *) return 1 ;;
  esac
}

load_action_scope() {
  AUTH_ACTION="$1"
  AUTH_ENTERPRISE_ID="$(extract_json_value "enterprise_id")"
  AUTH_PROJECT_ID="$(extract_json_value "project_id")"
  AUTH_SUBJECT="$(action_subject "$AUTH_ACTION")"
}

validate_action_authorization() {
  load_action_scope "$1"

  [ -n "$AUTH_ENTERPRISE_ID" ] || block "${AUTH_ACTION} 缺少 enterprise_id，无法校验授权范围。"
  [ -n "$AUTH_PROJECT_ID" ] || block "${AUTH_ACTION} 缺少 project_id，无法校验授权范围。"
  [ -n "$AUTH_SUBJECT" ] || block "${AUTH_ACTION} 缺少目标对象，无法校验授权范围。"
  [ -n "$TOOL_USE_ID" ] || block "${AUTH_ACTION} 缺少 tool_use_id，无法原子占用一次性授权凭证。"

  reason="$(python3 "$AUTH_HELPER" claim "$PROJECT_DIR" "$AUTH_ACTION" "$AUTH_ENTERPRISE_ID" "$AUTH_PROJECT_ID" "$AUTH_SUBJECT" "$TOOL_USE_ID" 2>&1)" || {
    block "${reason} 当前对话若已明确授权，请由 Agent 自动运行 scripts/manage-agent-authorization.sh grant --user-authorized ${AUTH_ACTION} 的对应命令后重试。"
  }
}

finish_action_authorization() {
  mode="$1"
  load_action_scope "$2"
  [ -n "$AUTH_ENTERPRISE_ID" ] && [ -n "$AUTH_PROJECT_ID" ] && [ -n "$AUTH_SUBJECT" ] || return 0
  [ -n "$TOOL_USE_ID" ] || return 0
  python3 "$AUTH_HELPER" "$mode" "$PROJECT_DIR" "$AUTH_ACTION" "$AUTH_ENTERPRISE_ID" "$AUTH_PROJECT_ID" "$AUTH_SUBJECT" "$TOOL_USE_ID" >/dev/null 2>&1 || true
}

# 发布标记路径：git common dir（主 checkout 与所有 worktree 共享同一物理路径）
# + branch slug 文件名。common dir 对称 → session 在主 checkout 或 worktree 启动均能命中；
# branch slug → 并行发布任务标记不互相覆盖。与 publish-review-package.sh 写入路径同源。
marker_path_for_branch() {
  br="$1"
  slug="$(printf '%s' "$br" | tr '/' '%')"
  common="$(git -C "$PROJECT_DIR" rev-parse --git-common-dir 2>/dev/null || true)"
  case "$common" in
    "") common="$PROJECT_DIR/.git" ;;
    /*) ;;
    *)  common="$PROJECT_DIR/$common" ;;
  esac
  printf '%s/agent-release-review-package-%s' "$common" "$slug"
}

read_publish_marker() {
  key="$1"; marker_path="$2"
  [ -n "$marker_path" ] && [ -f "$marker_path" ] || return 1
  awk -F= -v key="$key" '$1 == key { print substr($0, length(key) + 2); exit }' "$marker_path"
}

consume_publish_marker() {
  marker_path="$1"
  [ -n "$marker_path" ] && rm -f "$marker_path"
}

validate_publish_marker() {
  source_branch="$1"
  target_branch="$2"
  requested_draft="$3"
  marker_path="$(marker_path_for_branch "$source_branch")"

  marker_branch="$(read_publish_marker branch "$marker_path" || true)"
  marker_target="$(read_publish_marker target "$marker_path" || true)"
  marker_draft="$(read_publish_marker draft "$marker_path" || true)"
  marker_created_at="$(read_publish_marker created_at "$marker_path" || true)"

  if [ -z "$marker_branch" ] || [ -z "$marker_target" ] || [ -z "$marker_created_at" ] || [ -z "$marker_draft" ]; then
    block "创建 PR 前必须先通过 scripts/publish-review-package.sh --user-authorized --create-pr 推送当前工单分支。"
  fi

  now="$(date +%s)"
  case "$marker_created_at" in
    ''|*[!0-9]*) block "发布审查包授权标记无效。请重新执行 scripts/publish-review-package.sh --user-authorized --create-pr。" ;;
  esac

  if [ $((now - marker_created_at)) -gt "$MARKER_TTL_SECONDS" ]; then
    consume_publish_marker "$marker_path"
    block "发布审查包授权标记已过期。请重新执行 scripts/publish-review-package.sh --user-authorized --create-pr。"
  fi

  if [ "$marker_branch" != "$source_branch" ] || [ "$marker_target" != "$target_branch" ]; then
    block "PR 分支与发布审查包授权标记不匹配。请重新执行 scripts/publish-review-package.sh --user-authorized --create-pr。"
  fi

  case "$marker_draft" in
    true|false) ;;
    *) block "发布审查包 draft 标记无效。请重新执行发布入口。" ;;
  esac
  if [ "$marker_draft" != "$requested_draft" ]; then
    block "PR draft 参数与发布审查包标记不匹配。请按发布入口记录的草稿状态创建 PR。"
  fi

  # 成功路径不在此消费：消费延后到 PostToolUse（PR 创建成功后），见 ADR-0011。
  # 失败（404 / 网络 / 参数错）不消耗标记，可原地重试；TTL 过期分支的 consume 见上方。
}

# PostToolUse 分流：PR 创建成功后消费发布标记（撕票）。
# PostToolUse 只在工具成功时触发（失败走 PostToolUseFailure），故直接撕票无需判 isError。见 ADR-0011。
# Post 阶段不能阻断已执行的工具，始终 exit 0。
handle_post_tool_use() {
  # 只有明确 isError=false 才能证明成功；失败或畸形响应保留凭证并释放 claim。
  succeeded=0
  tool_response_succeeded && succeeded=1
  case "$TOOL_NAME" in
    mcp__gitee-ent__create_enterprise_repo_pull)
      source_branch="$(extract_json_value "source_branch")"
      if [ "$succeeded" = 1 ] && [ -n "$source_branch" ]; then
        consume_publish_marker "$(marker_path_for_branch "$source_branch")"
      fi
      ;;
    mcp__gitee-ent__merge_enterprise_pull)
      if [ "$succeeded" = 1 ]; then
        finish_action_authorization consume merge-pr
      else
        finish_action_authorization release merge-pr
      fi
      ;;
    mcp__gitee-ent__create_enterprise_repo_release)
      if [ "$succeeded" = 1 ]; then
        finish_action_authorization consume create-release
      else
        finish_action_authorization release create-release
      fi
      ;;
  esac
  exit 0
}

TOOL_NAME=$(extract_json_value "tool_name")
COMMAND=$(extract_json_value "command")
HOOK_EVENT_NAME=$(extract_json_value "hook_event_name")
TOOL_USE_ID=$(extract_json_value "tool_use_id")

# PostToolUse 分流：PR 创建成功后撕票。Pre 阶段（无 hook_event_name）跳过，走下方 Pre 逻辑。
if [ "$HOOK_EVENT_NAME" = "PostToolUse" ]; then
  handle_post_tool_use
fi

case "$TOOL_NAME" in
  mcp__gitee-ent__create_enterprise_repo_pull) AUDIT_OPERATION="create-pr" ;;
  mcp__gitee-ent__merge_enterprise_pull) AUDIT_OPERATION="merge-pr" ;;
  mcp__gitee-ent__create_enterprise_repo_release) AUDIT_OPERATION="create-release" ;;
  *) AUDIT_OPERATION="bash-other" ;;
esac

# Bash: inline alias 覆盖或 shell/cycle alias 无法安全分类，fail closed。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" unsafe-git-alias; then
  AUDIT_OPERATION="git-alias"
  block "检测到无法安全分类的 Git alias。请改用明确的标准入口或原生 Git 子命令。"
fi

# Bash: 普通 git push 是任务分支日常协作操作；release/* 仍在本 Gate 硬拦。
# master/main 直推与危险 force 由 block-push-to-master / block-dangerous-git 专职拦截。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" has-git-push; then
  AUDIT_OPERATION="git-push"
  release_target="$(printf '%s' "$COMMAND" | python3 "$PRETOOL" release-push-target 2>/dev/null || true)"
  if [ -n "$release_target" ]; then
    block "检测到直接 push 发布基线 ${release_target}。release/* 可能直接影响线上，必须通过受审查的发布流程更新。"
  fi
fi

# 发布线同步和任务合入只走标准入口。Hook 拦截 release 工作树直接改动提交史，
# 但不代替入口执行 Git 操作。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" release-direct-git; then
  AUDIT_OPERATION="release-direct-git"
  block "检测到在 release 工作树直接 commit/pull/merge/rebase/cherry-pick。同步请运行 scripts/sync-release-line.sh --json；任务写入与提交在独立 worktree，合入须经目标 release PR。"
fi

# Bash 可在同一命令中直接写文件再 git commit。仅有工单分支名前缀不足以
# 证明已通过开工入口；在 Agent Gate 校验独立工作树与任务元数据。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" unmanaged-task-commit; then
  AUDIT_OPERATION="git-commit"
  block "检测到任务名分支上的直接提交，但当前不是带有效发布线元数据的独立任务 worktree。请通过开工入口创建任务区或显式修复元数据。"
fi

# 扫描整条命令以分类审计，并保留任务分支错误同步的专门纠偏。
# 普通 commit / merge 是任务分支内可逆操作，不属于发布授权边界。
# 任务分支错误 merge/pull 同步必须指向任务同步入口；生产 master 不承接日常任务集成。
task_acceptance="$(printf '%s' "$COMMAND" | python3 "$PRETOOL" task-acceptance-git 2>/dev/null || true)"
case "$task_acceptance" in
  "git commit")
    AUDIT_OPERATION="git-commit"
    ;;
  "git merge")
    AUDIT_OPERATION="git-merge"
    ;;
  "git merge origin/master")
    AUDIT_OPERATION="git-merge-sync"
    block "检测到在任务分支上用 merge 同步 origin/master。任务分支同步固定使用 rebase；请由 Agent 依据规则运行 scripts/sync-task-from-origin.sh sync --json。"
    ;;
  "git merge origin/release")
    AUDIT_OPERATION="git-merge-sync"
    block "检测到在任务分支上用 merge 同步目标 release。请运行 scripts/sync-task-from-origin.sh sync --target-branch <任务目标release> --json。"
    ;;
  "git pull")
    AUDIT_OPERATION="git-pull"
    block "检测到在任务分支上直接 git pull（无 --ff-only / --rebase）。任务分支同步固定使用 rebase；请由 Agent 依据规则运行 scripts/sync-task-from-origin.sh sync --json。"
    ;;
esac

# Bash: 标准发布审查包入口。缺授权或缺显式 create/update 模式时硬拦；合规时静默放行。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes publish-review-package.sh; then
  AUDIT_OPERATION="publish-package"
  if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes publish-review-package.sh --user-authorized; then
    block "发布审查包入口缺少 --user-authorized。必须先获得用户明确授权。"
  fi
  publish_mode="$(printf '%s' "$COMMAND" | python3 "$PRETOOL" publish-review-mode 2>/dev/null || true)"
  case "$publish_mode" in
    create) allow ;;
    update)
      if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes publish-review-package.sh --pr-snapshot; then
        block "已有 PR 更新入口缺少 --pr-snapshot。Agent 必须先通过 Gitee MCP 读取并规范化 PR 快照。"
      fi
      allow
      ;;
    *) block "发布入口必须且只能选择 --create-pr 或 --update-pr <正整数 PR 编号>。" ;;
  esac
fi

# Bash: 标准同步入口是规则驱动的显式操作，不需要发布授权；Hook 只静默放行。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes sync-task-from-origin.sh; then
  AUDIT_OPERATION="sync-task"
  allow
fi

# 旧本地 master 集成入口已废止。必须在 commit-task 放行之前拦截复合命令。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes merge-task-to-local-master.sh; then
  AUDIT_OPERATION="merge-local-master"
  block "本地 master 集成入口已废止。任务经目标 release PR 合入；紧急生产 hotfix 另获授权。"
fi

# Bash: release 分支管理入口。list/current 为只读；create/activate 必须带 --user-authorized。
# 放在 merge-task 之后、commit-task 之前：授权型检查先于无条件放行，避免复合命令短路。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh; then
  AUDIT_OPERATION="release-branch"
  if printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh create \
    || printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh activate; then
    if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh --user-authorized; then
      block "release 分支 create/activate 是发布动作，缺少 --user-authorized。必须先获得用户明确授权。"
    fi
  elif ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh list \
    && ! printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes manage-release-branch.sh current; then
    block "release 分支管理入口只允许 list/current 只读调用；create/activate 必须带 --user-authorized。"
  fi
  allow
fi

# Bash: 标准本地任务验收入口（worktree 工单分支 commit，本地可逆，非发布动作）。
# 出现即放行，不校验 --user-authorized；提交仍在独立任务 worktree 内。
if [ -n "$COMMAND" ] && printf '%s' "$COMMAND" | python3 "$PRETOOL" invokes commit-task-for-review.sh; then
  AUDIT_OPERATION="commit-task"
  allow
fi

# Bash: cleanup-task-worktree.sh 依靠脚本自身校验目标 release 已包含任务 HEAD、工作区干净、路径正确。

# Gitee: 创建 PR。只校验发布审查包形态，不做二次确认。
if [ "$TOOL_NAME" = "mcp__gitee-ent__create_enterprise_repo_pull" ]; then
  AUDIT_OPERATION="create-pr"
  DRAFT=$(extract_json_value "draft")
  TARGET_BRANCH=$(extract_json_value "target_branch")
  SOURCE_BRANCH=$(extract_json_value "source_branch")

  case "$DRAFT" in
    true|false) ;;
    *) block "创建 Gitee PR 时必须显式传 draft=true 或 draft=false。" ;;
  esac

  case "$TARGET_BRANCH" in
    release/?*) ;;
    *) block "普通任务发布审查包只允许创建指向 release/* 的 PR；生产 hotfix 须独立授权流程。" ;;
  esac

  case "$SOURCE_BRANCH" in
    feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
    *) block "创建 Gitee PR 时 source_branch 必须是工单分支。" ;;
  esac

  validate_publish_marker "$SOURCE_BRANCH" "$TARGET_BRANCH" "$DRAFT"

  allow
fi

# Gitee: 合并 PR。先校验合并方法（纯参数错优先报），再校验授权凭证。
# squash/rebase 检查原由独立 hook block-squash-merge.sh 承担，但多 hook 执行顺序
# 不保证按配置数组顺序，squash 错误可能被掩盖为“缺凭证”误导。现并入此处，
# 在凭证校验前阻断，保证纠正信号精准（无论客户端 hook 执行顺序）。
if [ "$TOOL_NAME" = "mcp__gitee-ent__merge_enterprise_pull" ]; then
  AUDIT_OPERATION="merge-pr"
  MERGE_METHOD="$(extract_json_value "merge_method")"
  case "$MERGE_METHOD" in
    squash|rebase) audit 2 "blocked-policy" ;;
  esac
  check_merge_method_and_block "$MERGE_METHOD"
  validate_action_authorization merge-pr
  allow
fi

# Gitee: 创建仓库 release。必须持有 AI 自动生成且绑定具体 tag 的一次性凭证。
if [ "$TOOL_NAME" = "mcp__gitee-ent__create_enterprise_repo_release" ]; then
  AUDIT_OPERATION="create-release"
  validate_action_authorization create-release
  allow
fi

allow
