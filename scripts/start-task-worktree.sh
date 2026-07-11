#!/usr/bin/env bash
# Compatibility wrapper. All workflow logic lives in start-task-worktree.py.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$ROOT/scripts/start-task-worktree.py"

if command -v python3 >/dev/null 2>&1; then
  exec python3 "$ENTRY" "$@"
fi

if command -v py >/dev/null 2>&1; then
  exec py -3 "$ENTRY" "$@"
fi

echo "❌ start-task-worktree: 未找到 Python 3。macOS 请使用 python3，Windows 请使用 py -3。" >&2
exit 1
