#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Blue-Whale 开发环境初始化 ==="
echo ""

git config core.hooksPath .githooks
echo "✅ git hooks 已配置：core.hooksPath = .githooks（仅本项目）"
echo "   生效的 hook："
echo "   - pre-commit：禁提交生成物 + 前端 lint 软提醒 + 后端 py_compile 软提醒 + 工单分支落后软提醒 + 错误码改码注释对账（staged 含 error-codes.ts 时，允许用户本地 master commit）"
echo "   - commit-msg：Conventional Commits 规范校验"
echo "   - pre-push：禁直推 master/main + 首次 push 的非结构化中文分支名拦截（普通任务分支落后仍可 push）"
echo "     运行依赖：Python 3（macOS/Linux 使用 python3；Windows Git Bash 使用 py -3）"
echo "   - post-commit/post-checkout：graphify 知识图谱自动重建"
echo ""

chmod +x .githooks/* .claude/hooks/*.sh scripts/*.sh 2>/dev/null || true
echo "✅ hook / workflow 脚本权限已就绪"
mode_changes="$(git diff --summary -- .githooks .claude/hooks scripts | sed -n '/mode change/p' || true)"
if [ -n "$mode_changes" ]; then
  echo "⚠️  初始化后发现可执行权限未提交到仓库，当前工作区会显示 mode change："
  printf '%s\n' "$mode_changes" | sed 's/^/   /'
  echo "   请在 chore 分支提交这些权限位，避免后续初始化反复产生 dirty 状态。"
fi
echo ""

echo "✅ Claude guardrails 已随仓库就绪（.claude/settings.json + .claude/hooks/）"
echo "   - block-dangerous-git.sh：拦 AI 破坏性 git（裸 --force / reset --hard / branch -D / checkout . 等）"
echo "   - block-push-to-master.sh：拦 AI 直推 master/main（与 .githooks/pre-push 形成双层防护，AI 走 MCP 合并 / 本地 git push 都挡）"
echo "   - confirm-release-action.sh：拦 AI 用 squash/rebase 合并 PR（强制 merge）；拦发布动作缺授权/缺标准入口"
echo "   - block-issue-without-repo.sh：拦 AI 创建仓库不可见 issue / 子 issue 未继承父项归属"
echo "   个人配置请放 .claude/settings.local.json"
echo ""

echo "=== 后续步骤（按需执行）==="
echo "  export GITEE_ACCESS_TOKEN=<你的 Gitee 私人令牌>   # 写进 ~/.zshrc 持久化"
echo "  pnpm install --frozen-lockfile                     # workspace 依赖（首次必装）"
echo ""
echo "=== 完成。提交/推送时 hook 自动生效 ==="
