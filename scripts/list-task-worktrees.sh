#!/usr/bin/env bash
# Read-only report for managed task worktrees.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
source "$ROOT/scripts/lib/python3-command.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

if [ ! -d "$WORKTREE_BASE" ]; then
  echo "未发现任务 worktree 目录：$WORKTREE_BASE"
  exit 0
fi

python_available=0
select_python3_command && python_available=1

found=0
printf '%s\n' "任务 worktree 巡检（只读）：$WORKTREE_BASE"
printf '%s\n' ""

for path in "$WORKTREE_BASE"/*; do
  [ -d "$path" ] || continue
  if ! git -C "$path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    continue
  fi

  found=1
  branch="$(git -C "$path" symbolic-ref --short HEAD 2>/dev/null || echo "detached")"
  dirty="clean"
  [ -n "$(git -C "$path" status --porcelain)" ] && dirty="dirty"

  target_branch=""
  if [ "$python_available" -eq 1 ]; then
    target_branch="$("${PYTHON3_COMMAND[@]}" "$path/scripts/lib/task_metadata.py" read \
      --worktree "$path" --field target_branch 2>/dev/null || true)"
  fi
  merged="unknown"
  if [ -n "$target_branch" ] &&
     git -C "$path" fetch --no-tags origin "refs/heads/$target_branch" >/dev/null 2>&1; then
    fetched_sha="$(git -C "$path" rev-parse --verify 'FETCH_HEAD^{commit}' 2>/dev/null || true)"
    remote_line="$(git -C "$path" ls-remote --exit-code --heads origin \
      "refs/heads/$target_branch" 2>/dev/null || true)"
    remote_sha="${remote_line%%[[:space:]]*}"
    if [ -n "$fetched_sha" ] && [ "$fetched_sha" = "$remote_sha" ]; then
      if git -C "$path" merge-base --is-ancestor HEAD "$fetched_sha" 2>/dev/null; then
        merged="merged"
      else
        merged="not-merged"
      fi
    fi
  fi

  remote="absent"
  if [ "$branch" != "detached" ] && git -C "$path" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    remote="present"
  fi

  printf '路径: %s\n' "$path"
  printf '  分支: %s\n' "$branch"
  printf '  工作区: %s\n' "$dirty"
  printf '  目标发布线: %s\n' "${target_branch:-元数据不可用}"
  printf '  目标发布线包含任务: %s\n' "$merged"
  printf '  远程源分支: %s\n' "$remote"
  if [ "$dirty" = "clean" ] && [ "$merged" = "merged" ]; then
    printf '  建议: 可进入该 worktree 执行 scripts/cleanup-task-worktree.sh\n'
  elif [ "$dirty" = "dirty" ]; then
    printf '  建议: 先处理未提交改动\n'
  elif [ "$merged" = "unknown" ]; then
    printf '  建议: 保留，核对任务元数据或远端状态后重试\n'
  else
    printf '  建议: 保留，等待 PR 合并或继续处理审查反馈\n'
  fi
  printf '\n'
done

if [ "$found" -eq 0 ]; then
  echo "未发现由本项目管理的任务 worktree。"
fi
