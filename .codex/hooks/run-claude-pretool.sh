#!/usr/bin/env bash
# Codex lifecycle wrapper for the shared Claude hook scripts.
#
# .claude/hooks remains the policy authority. Shared hooks use the common
# no-output allow / exit-2 block contract, so this wrapper is intentionally
# transparent for both PreToolUse and PostToolUse.

set -u

if [ "$#" -ne 1 ]; then
  echo "BLOCKED: run-claude-pretool.sh requires exactly one hook script name." >&2
  exit 2
fi

script_name="$1"
case "$script_name" in
  */*|""|.*)
    echo "BLOCKED: invalid hook script name: ${script_name}" >&2
    exit 2
    ;;
esac

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
script="$root/.claude/hooks/$script_name"

if [ ! -f "$script" ]; then
  echo "BLOCKED: shared hook script not found: $script" >&2
  exit 2
fi

exec bash "$script"
