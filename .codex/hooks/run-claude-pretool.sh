#!/usr/bin/env bash

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

if [ "$script_name" = "block-master-edit.sh" ]; then
  input="$(cat)"
  pretool="$root/.claude/hooks/lib/pretool.py"
  if ! normalized_inputs="$(printf '%s' "$input" | python3 "$pretool" normalize-codex-apply-patch)"; then
    echo "BLOCKED: unable to parse Codex apply_patch targets." >&2
    exit 2
  fi

  while IFS= read -r normalized_input; do
    printf '%s' "$normalized_input" | bash "$script"
    exit_code=$?
    if [ "$exit_code" -ne 0 ]; then
      exit "$exit_code"
    fi
  done <<EOF
$normalized_inputs
EOF
  exit 0
fi

exec bash "$script"
