#!/usr/bin/env bash
# Codex PreToolUse wrapper for the shared Claude hook scripts.
#
# .claude/hooks remains the policy authority. This wrapper only adapts output
# that Claude Code supports but Codex PreToolUse currently does not.

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

tmp_out="$(mktemp)"
tmp_err="$(mktemp)"
cleanup() {
  rm -f "$tmp_out" "$tmp_err"
}
trap cleanup EXIT

bash "$script" >"$tmp_out" 2>"$tmp_err"
exit_code=$?

stdout="$(cat "$tmp_out")"
stderr="$(cat "$tmp_err")"

if [ "$exit_code" -eq 0 ] && printf '%s' "$stdout" | grep -qE '"permissionDecision"[[:space:]]*:[[:space:]]*"ask"'; then
  cat >&2 <<EOF
BLOCKED: this action requires explicit user confirmation.

Codex PreToolUse does not support permissionDecision=ask, so the shared Claude
confirmation hook is converted to a hard stop instead of failing open.

Run the action manually after confirming it is intended.
EOF
  exit 2
fi

if [ -n "$stdout" ]; then
  printf '%s' "$stdout"
fi
if [ -n "$stderr" ]; then
  printf '%s' "$stderr" >&2
fi

exit "$exit_code"
