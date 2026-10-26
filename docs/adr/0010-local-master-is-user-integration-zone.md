# ADR-0010：本地 master 是用户本地集成区，Agent 写入任务必须进 task worktree

- **状态**：已被 [ADR-0115](0115-local-release-code-baseline.md) 替代。以下保留历史决策记录。
- **日期**：2026-07-09
- **决策者**：JJNNReno（与 Codex 经 `/grill-with-docs` 会话共同得出）
- **更新**：
  - 2026-07-12，任务 Work Tree 基线改为同步后的本地 `master`，以保留团队本地优先的模块化开发方式。
  - 2026-07-12，任务验收 commit 门槛移除（IK0E1A）：完成子 issue 即直接走 `commit-task-for-review.sh` 落盘 commit（无需 `--user-authorized`），用户确认环节后移到 merge 本地 master 前。
  - 2026-07-14，PreToolUse Hook 的 merge/pull 拦截改为分支感知（IK0SPN）：`mode_task_acceptance_git` 调用 `current_branch()` 区分 master 集成区与任务分支，master 上 `git merge origin/master` 和 `git pull` 不再被拦截，消除此前 master 双方分叉时 Hook 硬拦与无标准入口放行之间的死锁。任务分支上仍拦截并指向 `sync-task-from-origin.sh`。
  - 2026-07-25，文档白名单窄例外（[ADR-0025](0025-doc-on-master-allowlist.md)）：AI 可在本地 master 直改散文规格文档（根 `CONTEXT.md` + `docs/**/*.md`），落盘走 `scripts/commit-spec-on-master.sh -m "<描述>"`；规则源（`.claude/`）、代码、`docs/**/*.json` 契约仍必须走 task worktree。（⚠️ **该直提入口 2026-09-10 已废止**，见下方 2026-09-25 更新——本条仅存历史记录，勿照此执行。）
  - 2026-07-26，本地个人配置窄例外：根 `CLAUDE.local.md` 与 `.codex/config.toml` 仅在 `git check-ignore` 明确命中时允许 Agent 在本地 master 直改；两者保持未跟踪，其他 ignored 文件仍硬拦。
  - 2026-08-11，任务分支普通 commit/push/merge 改为放行；保护分支、发布审查包、错误同步方式与本地 master 合入授权仍由 Hook 兜底。
  - 2026-09-25，散文文档直改例外收口（[ADR-0025](0025-doc-on-master-allowlist.md) 修正一）：`commit-spec-on-master.sh` 已于 2026-09-10 废止为指路桩，散文文档（根 `CONTEXT.md` + `docs/**/*.md`）现与代码同路，走 `--type docs` task worktree → `commit-task-for-review.sh -m "docs: <描述>"` → 用户授权后 `publish-review-package.sh --user-authorized --create-pr`。**Agent 无任何 master 直改授权；唯一的 master 直写例外是下方本地个人配置。**（`block-master-edit.sh` 的 doc 白名单是否撤除另行决策。）

> 授权交互方式已由 [ADR-0012](0012-agent-noninteractive-authorization.md) 更新：标准入口带 `--user-authorized` 时无二次确认；任务分支普通 Git 操作放行，保护分支、发布审查包和本地 master 合入绕过仍由 Hook 硬拦。

## 背景

PRD 会拆成多个子 issue。旧流程把每个 Agent 可写任务和工单分支绑定得过紧，容易被理解为“子 issue 完成即可推 PR/合并”；同时旧脚本把本地 `master` 当作 `origin/master` 的干净镜像，限制了用户在本地 `master` 上自由调整、commit、集成多个子任务的工作方式。

## 决策

本地 `master` 是**用户本地集成区**：用户可以在这里开发、commit、整理或集成本地改动，Agent 不自动清理、stash、rebase 或发布。Agent 执行写入任务必须先使用唯一入口创建独立 task worktree 和结构化中文工单分支。

本地个人 Agent 配置是窄例外：Agent 可以直接写根 `CLAUDE.local.md` 与 `.codex/config.toml`，但必须同时满足精确路径与 `git check-ignore` 命中。例外不扩展到 `.env`、其他 ignored 文件、相似文件名或未忽略的同名文件；个人配置不得暂存、提交或输出其中凭证。

入口要求主 checkout 位于干净的 `master`，先 fetch `origin/master`，再按历史关系执行最小同步：本地包含远程则不改写，本地落后则 fast-forward，双方分叉则普通 merge。冲突时自动 abort 且不创建 Work Tree。同步成功后记录精确 SHA，并从该 SHA 创建任务分支，从而同时保留本地领先提交与远程最新提交。

Agent 完成子 issue 后直接通过 `scripts/commit-task-for-review.sh -m "<message>"` 在任务分支落盘 commit（本地可逆，无需授权门槛），默认交付一个 commit 和验证结果。用户确认 commit 无问题后，Agent 才能通过 `scripts/merge-task-to-local-master.sh --user-authorized <任务分支>` 以 `git merge --no-ff` 合入用户本地 `master`；合入前本地 `master` 必须干净。用户决定发布时，仍通过同一入口从本地 `master` 当前状态创建结构化中文发布包装 Work Tree，再推 PR 到 `origin/master`。PR 合并进远程 `master` 必须单独授权。

## 后果

- 用户保留本地 `master` 的自由度，可把多个子 issue 先集成到本地再统一发布模块 PR。
- Agent 写入仍被隔离在 task worktree，不会污染用户本地集成区。
- 个人可以在不修改团队规则内容的前提下，由 Agent 自动维护当前仓库的 Claude Code 与 Codex 本地配置；精确路径和 Git ignore 双重校验防止例外扩大。
- `scripts/start-task-worktree.py` 是同步、命名与创建的唯一逻辑入口；`.sh` 仅负责跨环境寻找 Python 3。
- 创建前要求本地 `master` 干净，但不要求它与远程完全相同；本地 ahead 是合法且必须保留的状态。
- merge 冲突会中止开工，不允许 Agent 绕过同步后直接写入。
- 本地任务验收 commit 的标准入口仍是推荐检查点；任务分支普通 commit/push/merge 不需要发布授权。本地 `master` 合入有标准入口和 Hook 兜底，带授权参数无交互放行。
- 发布和远程合并仍受发布授权 Hook 约束，禁止 Agent 擅自创建/更新 PR、合并 PR、创建 release 或直推保护分支。
- 新发布包装统一使用 task Work Tree 和 `cleanup-task-worktree.sh`；策略升级前已有的主 checkout 发布包装分支可用 `cleanup-release-branch.sh` 完成收尾，不引入迁移状态机。
