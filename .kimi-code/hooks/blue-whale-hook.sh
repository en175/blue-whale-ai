#!/usr/bin/env bash
set -u

if [ "$#" -ne 1 ]; then
  exit 0
fi

script_name="$1"
case "$script_name" in
  */*|""|.*)
    exit 0
    ;;
esac

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
  exit 0
fi

if [ ! -f "$root/.kimi-code/hooks.toml" ]; then
  exit 0
fi

script="$root/.claude/hooks/$script_name"
if [ ! -f "$script" ]; then
  exit 0
fi

exec bash "$script"
