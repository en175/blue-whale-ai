#!/usr/bin/env bash
# Publish the current task branch as the first half of a review package.
# The shared hook requires --user-authorized and then allows this entrypoint
# without another prompt. Creating the PR remains a separate Gitee MCP action.

set -euo pipefail

AUTHORIZED=0
for arg in "$@"; do
  case "$arg" in
    --user-authorized)
      AUTHORIZED=1
      ;;
    -h|--help)
      cat <<EOF
用法: scripts/publish-review-package.sh --user-authorized

发布审查包入口：
  1. 校验当前工单分支
  2. 校验工作区干净且包含最新 origin/master
  3. 推送当前工单分支
  4. 由 Agent 随后创建 target=master 的 PR，并停下来等待开发者审查
EOF
      exit 0
      ;;
    *)
      echo "❌ publish-review-package: 不支持的参数：$arg" >&2
      exit 2
      ;;
  esac
done

if [ "$AUTHORIZED" != 1 ]; then
  echo "❌ publish-review-package: 缺少 --user-authorized。必须先获得用户明确授权发布审查包。" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"

fail() {
  echo "❌ publish-review-package: $*" >&2
  exit 1
}

branch="$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
case "$branch" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*) ;;
  "") fail "当前不是分支状态。" ;;
  *) fail "当前分支不是工单分支：$branch" ;;
esac

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  git -C "$ROOT" status --short >&2
  fail "工作区不干净。请先提交或处理改动，再发布审查包。"
fi

git -C "$ROOT" fetch origin

if ! git -C "$ROOT" merge-base --is-ancestor origin/master HEAD; then
  fail "当前分支落后 origin/master。请先执行 git rebase origin/master，验证后再发布。"
fi

if git -C "$ROOT" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  git -C "$ROOT" push --force-with-lease -u origin "$branch"
else
  git -C "$ROOT" push -u origin "$branch"
fi

# 标记写到 git common dir + branch slug，与 confirm-release-action.sh 查找路径对称：
# common dir 对主 checkout 与所有 worktree 是同一物理路径 → 不依赖 Claude session 启动位置；
# branch slug → 并行发布任务标记不互相覆盖。
slug="$(printf '%s' "$branch" | tr '/' '%')"
common="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
case "$common" in
  "") common="$ROOT/.git" ;;
  /*) ;;
  *)  common="$ROOT/$common" ;;
esac
marker_path="$common/agent-release-review-package-$slug"
mkdir -p "$common"
umask 077
cat >"$marker_path" <<EOF
branch=$branch
target=master
created_at=$(date +%s)
EOF

cat <<EOF
✅ 分支已推送：$branch

下一步：
  1. 创建 Gitee PR：$branch → master
  2. 按 .gitee/PULL_REQUEST_TEMPLATE.md 填写实现范围、风险、测试结果和审查重点
  3. PR 创建后停下来，等待开发者审查
  4. PR 合并后运行 scripts/cleanup-task-worktree.sh；仅策略升级前已有的主 checkout 发布分支使用旧清理入口
EOF
