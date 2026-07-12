#!/usr/bin/env bash
# Claude Code PreToolUse hook — 拦截 AI 直推 master/main
# JSON 与 shell 命令解析委托给 lib/pretool.py，避免转义引号和 git 全局选项绕过。
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

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PRETOOL="$HOOK_DIR/lib/pretool.py"
COMMAND=$(printf '%s' "$INPUT" | python3 "$PRETOOL" value command 2>/dev/null || true)

[ -z "$COMMAND" ] && exit 0

# 非 git push 命令直接放行
if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" has-git-push; then
  exit 0
fi

target_ref=$(printf '%s' "$COMMAND" | python3 "$PRETOOL" protected-push-target 2>/dev/null || true)

# 显式目标或隐式当前分支 = master/main → 无条件拦
case "$target_ref" in
  master|main)
    cat >&2 <<EOF
BLOCKED: 直推 ${target_ref} 被拦截。
  命令: $COMMAND

本项目禁止 AI 直接 push 到 master/main（最高红线）。
- 所有进 master 的改动统一走：开分支 → 推分支 → Gitee 建 PR → 服务端合并
- 用户授权合并也走流程（分支→PR→合并），不绕过 PR
- hotfix/* 同样走分支→PR，无特权
- 详见 CLAUDE.md「Gitee 工作流」与 docs/agents/commit-and-review.md
EOF
    exit 2
    ;;
esac

exit 0
