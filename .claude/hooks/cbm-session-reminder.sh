#!/usr/bin/env bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)" || exit 0
bash "$ROOT/.claude/hooks/cbm-discovery-gate.sh"
exit 0
