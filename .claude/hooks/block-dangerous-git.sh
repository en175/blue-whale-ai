#!/usr/bin/env bash
# Claude Code PreToolUse hook — 拦截 AI 的破坏性 git 操作（仅本项目）
# 零依赖（不依赖 jq，用 grep/sed 解析 JSON）。
#
# 拦截清单：
#   - 裸 --force / -f 的 git push（任何分支，无差别拦）
#   - 对保护分支（master/main）的 force-with-lease 强推
#   - git reset --hard
#   - git clean -f / -fd
#   - git branch -D（强删分支）
#   - git checkout . / git restore .（丢弃工作区改动）
#
# 放行清单（rebase 工作流必需）：
#   - 对 feature/* fix/* hotfix/* docs/* chore/* 等工单分支的 git push --force-with-lease
#     （feature 分支是 AI 的私有作业区，rebase 后需强推；--force-with-lease
#      本身有安全网：远程被别人动过会自动拒绝。）
#
# 设计原则：master 受保护、合并走 PR；工单分支私有，rebase 后允许 --force-with-lease。
# 退出码 2 = 阻断 Claude 执行该命令。

# 从 stdin 读 PreToolUse 的 JSON 输入
INPUT=$(cat)
# 提取 .tool_input.command（grep 取值行，去引号）；jq 不可用时的零依赖兜底
COMMAND=$(printf '%s' "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

[ -z "$COMMAND" ] && exit 0

# ============================================================
# push 的精细化处理：区分 force-with-lease（feature 分支放行）与裸 --force（全拦）
# ============================================================
if printf '%s' "$COMMAND" | grep -qE 'git[[:space:]]+push'; then
  # force 标记检测（字符串包含，直观可靠）
  case "$COMMAND" in
    *--force-with-lease*) has_force_lease=1 ;; *) has_force_lease=0 ;;
  esac
  # 裸 --force / -f：命中 force 但不是 force-with-lease
  case "$COMMAND" in
    *--force-with-lease*) has_bare_force=0 ;;
    *--force*|*" -f "*|*" -f") has_bare_force=1 ;;
    *) has_bare_force=0 ;;
  esac

  # 含任何 force 标记才需要判断；普通 push 直接放行
  if [ "$has_force_lease" -gt 0 ] || [ "$has_bare_force" -gt 0 ]; then
    # 推断 push 目标分支名：取 push 后第一个形如 xxx/yyy 或含冒号的 refspec，否则回退当前分支
    target_ref=$(printf '%s' "$COMMAND" \
      | sed -E 's/^.*git[[:space:]]+push//' \
      | tr ' ' '\n' \
      | grep -E '(feature|fix|hotfix|docs|chore)/|^[^[:space:]]+:[^[:space:]]+' \
      | tail -n1 \
      | sed -E 's/^.*://')
    # 无显式 refspec → 当前分支
    if [ -z "$target_ref" ]; then
      target_ref=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    fi

    is_feature=0
    case "$target_ref" in
      feature/*|fix/*|hotfix/*|docs/*|chore/*) is_feature=1 ;;
    esac

    # 规则 1：裸 --force（无 -with-lease）→ 无条件拦
    if [ "$has_bare_force" -gt 0 ] && [ "$has_force_lease" -eq 0 ]; then
      cat >&2 <<EOF
BLOCKED: 裸 --force 被拦截。
  命令: $COMMAND

本项目禁止 AI 使用裸 --force / -f（会无脑覆盖远程历史，无视他人改动）。
- rebase 后强推 feature 分支：改用 git push --force-with-lease
- master 受保护，合并走 PR，任何强推都被拦
- 详见 CLAUDE.md「提交与审查」
EOF
      exit 2
    fi

    # 规则 2：force-with-lease 但目标非工单分支（含 master/main/当前在 master）→ 拦
    if [ "$has_force_lease" -gt 0 ] && [ "$is_feature" -eq 0 ]; then
      cat >&2 <<EOF
BLOCKED: 对非工单分支的 force-with-lease 被拦截。
  命令: $COMMAND
  推断目标: ${target_ref:-（当前分支，疑似保护分支）}

--force-with-lease 仅允许用于 feature/* fix/* hotfix/* docs/* chore/* 工单分支（rebase 后强推）。
- master/main 等保护分支禁止强推，合并走 PR
- 若你在工单分支但被误判，确认分支名以 feature//fix//hotfix//docs//chore/ 开头
- 详见 CLAUDE.md「提交与审查」
EOF
      exit 2
    fi

    # 规则 3：force-with-lease + 工单分支 → 放行
    # （落入下方通用危险模式检查，不再被 force 规则拦）
  fi
fi

# ============================================================
# 其余破坏性操作（非 push 类）
# ============================================================
DANGEROUS_PATTERNS=(
  'git[[:space:]]+reset[[:space:]]+.*--hard'
  'git[[:space:]]+clean[[:space:]]+.*-f'
  'git[[:space:]]+branch[[:space:]]+.*-D'
  'git[[:space:]]+checkout[[:space:]]+\.'
  'git[[:space:]]+restore[[:space:]]+\.'
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if printf '%s' "$COMMAND" | grep -qE "$pattern"; then
    cat >&2 <<EOF
BLOCKED: 危险 git 操作被拦截。
  命令: $COMMAND
  匹配: $pattern

本项目禁止 AI 执行破坏性 git 操作（硬重置/清空/强删分支/丢弃改动）。
- 推代码: 用普通 git push（推到 feature 分支走 PR）
- master 受保护，合并走 PR
- 详见 CLAUDE.md「提交与审查」
EOF
    exit 2
  fi
done

exit 0
