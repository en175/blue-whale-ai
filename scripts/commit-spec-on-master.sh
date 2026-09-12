#!/usr/bin/env bash
# DEPRECATED（2026-09-10 废止）：本地 master 禁止直接 commit——含散文文档。
# 原 ADR-0025「doc-on-master 直提」例外通道与红线冲突：PR 审合前不合入 master，
# 本地集成区同理不提前吃未审内容；且未推送的 master 直提会被开工入口的
# 「本地领先保留」卷进后续任务分支，污染每个 PR（2026-09-09 实测两次）。
# 本入口废止为指路桩（pre-commit 层硬拦另行决策，不在本通道范围）。
#
# 文档改动的标准路径（与代码同路）：
#   1) scripts/start-task-worktree.sh --type docs --no-issue --summary <6–15字中文简述>
#   2) 工单分支内编辑后：bash scripts/commit-task-for-review.sh -m "docs: <描述>"
#   3) 用户授权后：scripts/publish-review-package.sh --user-authorized --create-pr
#      （工程面 docs/chore 直进 master；提 PR 目标 = 最近 release 批次 + master 交用户手选）
#
# 人类确需在本地 master 直提：自行标准 git commit（自担未推送提交被卷进任务分支的代价）。

cat >&2 <<EOF
❌ commit-spec-on-master: 该入口已废止——本地 master 不再经此通道落盘文档直提。
   改用：scripts/start-task-worktree.sh --type docs --no-issue --summary <中文简述>
        → 工单分支上 bash scripts/commit-task-for-review.sh -m "docs: <描述>"
        → 用户授权后 scripts/publish-review-package.sh --user-authorized --create-pr
EOF
exit 1
