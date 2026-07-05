#!/usr/bin/env bash
# Claude Code PreToolUse hook — 拦截 AI 用 squash/rebase 合并 PR
# 零依赖（grep/sed 解析 JSON，同 block-dangerous-git.sh）。
#
# 拦截：mcp__gitee__merge_pull 的 merge_method 为 squash / rebase
# 放行：merge（或缺省，Gitee 默认 merge）
#
# 为什么：squash/rebase 合并改写 commit sha → 本地 git branch -d 误判"未合并"
# → 叠加 block-dangerous-git.sh 拦 -D → AI 无法清理本地分支（死锁）。
# merge 保留原 sha，-d 正常工作。项目合并惯例 = merge（实证 master 历史全 2-parent merge commit）。
#
# 配套：settings.json PreToolUse matcher = mcp__gitee__merge_pull。
# 退出码 2 = 阻断 Claude 执行该工具调用。

# 从 stdin 读 PreToolUse 的 JSON 输入
INPUT=$(cat)
# 提取 tool_input.merge_method（grep 取值行，去引号）；jq 不可用时的零依赖兜底
METHOD=$(printf '%s' "$INPUT" | grep -o '"merge_method"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"merge_method"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

# 缺省（未传 merge_method，Gitee 默认 merge）→ 放行
[ -z "$METHOD" ] && exit 0

case "$METHOD" in
  squash|rebase)
    cat >&2 <<EOF
BLOCKED: PR 合并方法 ${METHOD} 被拦截。
  merge_method: ${METHOD}

本项目 PR 合并用 merge（非 squash/rebase）：
- squash/rebase 改写 commit sha → 本地 git branch -d 误判"未合并"
- 叠加 block-dangerous-git.sh 拦 git branch -D → 本地分支删不掉（死锁）
- merge 保留原 commit sha，git branch -d 正常工作
- 实证：master 历史 PR 全为 2-parent merge commit

改法：merge_method=merge（或不传，Gitee 默认 merge）。
详见 docs/agents/commit-and-review.md「合并方法」。
EOF
    exit 2
    ;;
esac

exit 0
