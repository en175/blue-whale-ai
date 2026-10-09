#!/usr/bin/env bash

check_merge_method_and_block() {
  local method="$1"
  case "$method" in
    squash|rebase)
      cat >&2 <<EOF
BLOCKED: PR 合并方法 ${method} 被拦截。
  merge_method: ${method}

本项目 PR 合并用 merge（非 squash/rebase）：
- squash/rebase 改写 commit sha → 本地 git branch -d 误判"未合并"
- 叠加 block-dangerous-git.sh 拦 git branch -D → 本地分支删不掉（死锁）
- merge 保留原 commit sha，git branch -d 正常工作
- 实证：master 历史 PR 全为 2-parent merge commit

改法：merge_method=merge（或不传，Gitee 默认 merge）。
详见 docs/agents/commit-and-review.md「合并方法」。
EOF
      exit 2
      ;;
  esac
}
