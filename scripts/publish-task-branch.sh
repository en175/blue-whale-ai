#!/usr/bin/env bash
# Deprecated: use scripts/publish-review-package.sh --user-authorized.

set -euo pipefail

cat >&2 <<EOF
❌ publish-task-branch 已废弃。

发布审查包必须使用唯一入口：
  scripts/publish-review-package.sh --user-authorized

该入口会在 Claude Code Hook 中触发一次用户确认；确认后推送当前工单分支，
随后创建 target=master 的 draft PR。
EOF
exit 2
