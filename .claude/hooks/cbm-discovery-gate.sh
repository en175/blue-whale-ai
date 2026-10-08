#!/usr/bin/env bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)" || exit 0
python3 "$ROOT/.claude/hooks/lib/cbm_context.py" 2>/dev/null
exit 0
