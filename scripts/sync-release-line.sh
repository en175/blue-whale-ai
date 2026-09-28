#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/scripts/lib/python3-command.sh"
select_python3_command || { echo "sync-release-line: 需要 Python 3。" >&2; exit 1; }
export PYTHONIOENCODING=utf-8
exec "${PYTHON3_COMMAND[@]}" "$ROOT/scripts/sync-release-line.py" "$@"
