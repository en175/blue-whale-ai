#!/usr/bin/env bash
# Compatibility wrapper. All synchronization logic lives in sync-task-from-origin.py.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$ROOT/scripts/sync-task-from-origin.py"
. "$ROOT/scripts/lib/python3-command.sh"

# Windows 下子进程 python（inherit 管道）默认按 GBK 编码输出，中文会被
# 写成 GBK 字节；父进程按 utf-8 解码会崩溃。强制 UTF-8 与 Python 源码内
# reconfigure(utf-8) 对齐；POSIX 环境下 PYTHONIOENCODING 同样只是把本就
# 默认的 utf-8 显式化，不影响其他操作系统。
export PYTHONIOENCODING=utf-8

if select_python3_command; then
  exec "${PYTHON3_COMMAND[@]}" "$ENTRY" "$@"
fi

echo "❌ sync-task-from-origin: 未找到可用的 Python 3。" >&2
exit 1
