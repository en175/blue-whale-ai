#!/usr/bin/env bash

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=lib/merge-method-check.sh
. "$HOOK_DIR/lib/merge-method-check.sh"

METHOD=$(printf '%s' "$INPUT" | grep -o '"merge_method"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"merge_method"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

[ -z "$METHOD" ] && exit 0

check_merge_method_and_block "$METHOD"
exit 0
