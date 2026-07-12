#!/usr/bin/env bash
# Compatibility wrapper. All workflow logic lives in start-task-worktree.py.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$ROOT/scripts/start-task-worktree.py"

# 探测 python3，但跳过 Microsoft Store 的 app execution alias 桩
# （WindowsApps\python3.exe 会让 command -v 命中，exec 却弹 Store / 报错）。
python3_path="$(command -v python3 2>/dev/null || true)"
if [ -n "$python3_path" ]; then
  case "$python3_path" in
    *WindowsApps*) : ;;  # Store 桩，落到 py launcher
    *) exec python3 "$ENTRY" "$@" ;;
  esac
fi

if command -v py >/dev/null 2>&1; then
  exec py -3 "$ENTRY" "$@"
fi

echo "❌ start-task-worktree: 未找到可用的 Python 3。" >&2
if [ -n "$python3_path" ]; then
  echo "   检测到的 python3 是 Microsoft Store 桩（${python3_path}），请安装真正的 Python 3 或使用 py -3。" >&2
else
  echo "   macOS/Linux 请使用 python3，Windows 请使用 py -3。" >&2
fi
exit 1
