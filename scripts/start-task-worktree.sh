#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENTRY="$ROOT/scripts/start-task-worktree.py"

. "$ROOT/scripts/lib/python3-command.sh"

export PYTHONIOENCODING=utf-8

if select_python3_command; then
  exec "${PYTHON3_COMMAND[@]}" "$ENTRY" "$@"
fi

echo "❌ start-task-worktree: 未找到可用的 Python 3。" >&2
python3_path="$(command -v python3 2>/dev/null || true)"
if [ -n "$python3_path" ]; then
  echo "   检测到的 python3 是 Microsoft Store 桩（${python3_path}），请安装真正的 Python 3 或使用 py -3。" >&2
else
  echo "   macOS/Linux 请使用 python3，Windows 请使用 py -3。" >&2
fi
exit 1
