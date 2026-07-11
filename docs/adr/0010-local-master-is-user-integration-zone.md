# ADR-0010：本地 master 是用户本地集成区，Agent 写入任务必须进 task worktree

- **状态**：Accepted
- **日期**：2026-07-09
- **决策者**：JJNNReno（与 Codex 经 `/grill-with-docs` 会话共同得出）
- **更新**：2026-07-12，任务 Work Tree 基线改为同步后的本地 `master`，以保留团队本地优先的模块化开发方式。

> 授权交互方式已由 [ADR-0012](0012-agent-noninteractive-authorization.md) 更新：标准入口带 `--user-authorized` 时无二次确认，直接 Git 绕过仍由 Hook 硬拦。

## 背景

PRD 会拆成多个子 issue。旧流程把每个 Agent 可写任务和工单分支绑定得过紧，容易被理解为“子 issue 完成即可推 PR/合并”；同时旧脚本把本地 `master` 当作 `origin/master` 的干净镜像，限制了用户在本地 `master` 上自由调整、commit、集成多个子任务的工作方式。

## 决策

本地 `master` 是**用户本地集成区**：用户可以在这里开发、commit、整理或集成本地改动，Agent 不自动清理、stash、rebase 或发布。Agent 执行写入任务必须先使用唯一入口创建独立 task worktree 和结构化中文工单分支。

入口要求主 checkout 位于干净的 `master`，先 fetch `origin/master`，再按历史关系执行最小同步：本地包含远程则不改写，本地落后则 fast-forward，双方分叉则普通 merge。冲突时自动 abort 且不创建 Work Tree。同步成功后记录精确 SHA，并从该 SHA 创建任务分支，从而同时保留本地领先提交与远程最新提交。

Agent 完成子 issue 后停在任务验收分支，默认交付未提交 diff 和验证结果。用户确认后，Agent 才能通过 `scripts/commit-task-for-review.sh --user-authorized -m "<message>"` 在任务分支 commit，并通过 `scripts/merge-task-to-local-master.sh --user-authorized <任务分支>` 以 `git merge --no-ff` 合入用户本地 `master`；合入前本地 `master` 必须干净。用户决定发布时，再从本地 `master` 当前状态创建发布包装分支，推 PR 到 `origin/master`。PR 合并进远程 `master` 必须单独授权。

## 后果

- 用户保留本地 `master` 的自由度，可把多个子 issue 先集成到本地再统一发布模块 PR。
- Agent 写入仍被隔离在 task worktree，不会污染用户本地集成区。
- `scripts/start-task-worktree.py` 是同步、命名与创建的唯一逻辑入口；`.sh` 仅负责跨环境寻找 Python 3。
- 创建前要求本地 `master` 干净，但不要求它与远程完全相同；本地 ahead 是合法且必须保留的状态。
- merge 冲突会中止开工，不允许 Agent 绕过同步后直接写入。
- 本地任务验收 commit 与本地 `master` 合入有标准入口和 Hook 兜底；带授权参数无交互放行，直接 Git 绕过硬拦。
- 发布和远程合并仍受发布授权 hook 约束，禁止 Agent 擅自 push、开 PR 或合并 PR。
- 主 checkout 发布包装分支合并进 `origin/master` 后，有标准清理入口 `scripts/cleanup-release-branch.sh --user-authorized <branch>`，删本地分支 + 远程源分支 + `fetch --prune`，填补 `cleanup-task-worktree.sh` 只认 task worktree 路径形态的 gap。
