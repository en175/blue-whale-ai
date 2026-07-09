# ADR-0010：本地 master 是用户本地集成区，Agent 写入任务必须进 task worktree

- **状态**：Accepted
- **日期**：2026-07-09
- **决策者**：JJNNReno（与 Codex 经 `/grill-with-docs` 会话共同得出）

## 背景

PRD 会拆成多个子 issue。旧流程把每个 Agent 可写任务和工单分支绑定得过紧，容易被理解为“子 issue 完成即可推 PR/合并”；同时旧脚本把本地 `master` 当作 `origin/master` 的干净镜像，限制了用户在本地 `master` 上自由调整、commit、集成多个子任务的工作方式。

## 决策

本地 `master` 是**用户本地集成区**：用户可以在这里开发、commit、整理或集成本地改动，Agent 不自动清理、stash、rebase、发布，也不假定它必须干净。Agent 执行写入任务必须使用独立 task worktree 和工单分支，默认从 `origin/master` 创建。

Agent 完成子 issue 后停在任务验收分支，默认交付未提交 diff 和验证结果。用户确认后，Agent 才能通过 `scripts/commit-task-for-review.sh --user-authorized -m "<message>"` 在任务分支 commit，并通过 `scripts/merge-task-to-local-master.sh --user-authorized <任务分支>` 以 `git merge --no-ff` 合入用户本地 `master`；合入前本地 `master` 必须干净。用户决定发布时，再从本地 `master` 当前状态创建发布包装分支，推 PR 到 `origin/master`。PR 合并进远程 `master` 必须单独授权。

## 后果

- 用户保留本地 `master` 的自由度，可把多个子 issue 先集成到本地再统一发布模块 PR。
- Agent 写入仍被隔离在 task worktree，不会污染用户本地集成区。
- `scripts/start-task-worktree.sh` 不再同步或要求本地 `master` 干净；`.githooks/pre-commit` 不再禁止本地 `master` commit。
- 本地任务验收 commit 与本地 `master` 合入也有标准入口和 hook 确认，避免 Agent 擅自越过未提交 diff 的默认终点。
- 发布和远程合并仍受发布授权 hook 约束，禁止 Agent 擅自 push、开 PR 或合并 PR。
