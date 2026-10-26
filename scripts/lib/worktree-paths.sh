#!/usr/bin/env bash

worktree_paths_resolve_base() {
  local root="$1"
  local parent
  parent="$(cd "$root/.." && pwd)"
  if [ "$(basename "$parent")" = "blue-whale-worktrees" ]; then
    printf '%s' "$parent"
  else
    printf '%s' "$parent/blue-whale-worktrees"
  fi
}
