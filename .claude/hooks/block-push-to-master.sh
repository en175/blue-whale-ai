#!/usr/bin/env bash
# Claude Code PreToolUse hook — 拦截 AI 直推 master/main
# 零依赖（grep/sed 解析 JSON，与 block-dangerous-git.sh 一致风格）。
#
# 拦截对象：
#   - git push ... master / main（含普通 push 与 force-with-lease）
#   - git push origin（无显式 refspec 但当前分支是 master/main）
#
# 为什么拦：项目合并惯例 = 开分支 → 推分支 → Gitee 建 PR → 服务端合并。
#   任何对 master/main 的本地 push 都绕过 PR 流程，污染主干历史。
#   兜底：Gitee 端保护分支 + 文档约束。本地 hook 补最后一道闸。
#   决策见 docs/adr/0003-no-direct-push-to-master.md
#
# 放行：
#   - 对 feature/* fix/* hotfix/* docs/* chore/* 工单分支的 push
#   - git push --force-with-lease 到工单分支（rebase 后强推场景）
#     备注：force-with-lease 到 master 的拦截在 block-dangerous-git.sh
#
# 退出码 2 = 阻断 Claude 执行该命令。

# 从 stdin 读 PreToolUse 的 JSON 输入
INPUT=$(cat)
# 提取 .tool_input.command（grep 取值行，去引号）；jq 不可用时的零依赖兜底
COMMAND=$(printf '%s' "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

[ -z "$COMMAND" ] && exit 0

# 非 git push 命令直接放行
if ! printf '%s' "$COMMAND" | grep -qE 'git[[:space:]]+push'; then
  exit 0
fi

# 推断 push 目标 refspec（取 push 后第一个形如 xxx/yyy 或 ref:ref 的 token）
target_ref=$(printf '%s' "$COMMAND" \
  | sed -E 's/^.*git[[:space:]]+push//' \
  | tr ' ' '\n' \
  | grep -E '(feature|fix|hotfix|docs|chore)/|^[^[:space:]]+:[^[:space:]]+|^(master|main)$' \
  | tail -n1 \
  | sed -E 's/^.*://')

# 显式目标 = master/main → 无条件拦
case "$target_ref" in
  master|main)
    cat >&2 <<EOF
BLOCKED: 直推 ${target_ref} 被拦截。
  命令: $COMMAND

本项目禁止 AI 直接 push 到 master/main（最高红线）。
- 所有进 master 的改动统一走：开分支 → 推分支 → Gitee 建 PR → 服务端合并
- 自审合也走流程（分支→PR→合并），不绕过 PR
- hotfix/* 同样走分支→PR，无特权
- 详见 CLAUDE.md「Gitee 工作流」与 docs/adr/0003
EOF
    exit 2
    ;;
esac

# 无显式 refspec → 当前分支决定
if [ -z "$target_ref" ]; then
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  case "$current_branch" in
    master|main)
      cat >&2 <<EOF
BLOCKED: 直推 ${current_branch} 被拦截。
  命令: $COMMAND
  当前分支: ${current_branch}

本项目禁止 AI 在 master/main 分支执行 git push。
- 切换到工单分支（feature/* fix/* hotfix/* docs/* chore/*）后再 push
- 或在命令中显式指定远程 refspec（git push origin <branch>）
- 详见 CLAUDE.md「Gitee 工作流」
EOF
      exit 2
      ;;
  esac
fi

exit 0
