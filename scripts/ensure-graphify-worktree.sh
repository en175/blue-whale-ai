#!/usr/bin/env bash
# Build or refresh Graphify output for the current task worktree.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
ROOT_PARENT="$(cd "$ROOT/.." && pwd)"
if [ "$(basename "$ROOT_PARENT")" = "blue-whale-worktrees" ]; then
  WORKTREE_BASE="$ROOT_PARENT"
else
  WORKTREE_BASE="$ROOT_PARENT/blue-whale-worktrees"
fi

fail() {
  echo "❌ ensure-graphify-worktree: $*" >&2
  exit 1
}

case "$ROOT" in
  "$WORKTREE_BASE"/*) ;;
  *) fail "请在 $WORKTREE_BASE 下的任务 worktree 内执行。" ;;
esac

command -v graphify >/dev/null 2>&1 || fail "找不到 graphify 命令。请先安装/配置 Graphify。"

cd "$ROOT"
graphify update .

[ -f graphify-out/graph.json ] || fail "graphify update 完成后仍未发现 graphify-out/graph.json。"

echo "✅ 当前任务 worktree 的 Graphify 图谱已就绪：$ROOT/graphify-out/graph.json"
