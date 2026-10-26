#!/usr/bin/env bash

cat >&2 <<EOF
❌ commit-spec-on-master: 该入口已废止——本地 master 不再经此通道落盘文档直提。
   改用：scripts/start-task-worktree.sh --type docs --no-issue --summary <中文简述>
        → 工单分支上 bash scripts/commit-task-for-review.sh -m "docs: <描述>"
        → 用户授权后 scripts/publish-review-package.sh --user-authorized --create-pr
EOF
exit 1
