---
name: implement-spec
description: "Implement a specification in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The goal is a PR which implements the entire spec on a single branch.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for **maximum concurrency**.

## Steps

1. Read the spec and tickets. Read enough to understand the task graph. 本仓适配：先解析工单拓扑——父规格单下通常已切分子工单（to-tickets 产物）。Gitee `search=<父单号>` 查不到子工单（子工单标题是 `【前端|后端】<标题>`，空结果不代表无子）；用 `list_enterprise_issues(project_id, state="open", per_page=100)` 客户端筛 `parent_id == 父单数字 id`（详见 `docs/agents/issue-tracker.md`「操作约定·查子工单」）。子工单是任务图节点：按其 `Blocked by` 声明确定 frontier 与串行依赖，不按父单正文自行切阶段；每张子工单独立实施、验证、留痕、流转状态。

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create a branch, and a draft PR. The PR should be marked as 'closing' the spec issue and tickets.

4. Use **implementer subagents** to implement each ticket. Each implementer subagent should work in its own worktree, on its own branch.

5. Once an **implementer subagent** completes, merge its work to the PR branch with a **merger subagent**.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, run /code-review on the PR branch. Fix all issues raised by the code review in a single **implementer subagent**.

8. Mark the PR as ready for review.

9. Clean up all **implementer subagent** worktrees.

本仓适配（worktree 与提交，2026-09-26 IKIMN8 实证）：仓 Hook 硬拦无元数据 worktree 的提交——任务 worktree 只能由 `scripts/start-task-worktree.sh` 建立，提交只能走 `scripts/commit-task-for-review.sh`（详见 `docs/agents/git-workflow.md`）。步骤 4/5/9 的多 worktree 并行设计不变，在本仓按以下方式落地：

- 父规格单先建集成 worktree（`--issue <父单号>`），其分支即 PR 分支。
- 每个 implementer 子代理用开工入口建自己的 worktree（`--issue <子单号>`，子单状态随入口自动流转）；建后先 `git merge <集成任务分支>` 补入先遣票产出的基础设施（Hook 只拦 merge `origin/master` 与 `origin/release`，合本地任务分支放行），再实施、自跑定向测试、提交。
- merger 子代理把子单分支 merge 回集成分支；全部合完后在集成 worktree 跑收口与 PR 阶段验证（`node scripts/verify-change-scope.mjs run --stage pr`）。
- 步骤 9 的清理对每个任务 worktree 跑 `scripts/cleanup-task-worktree.sh`。
- 纯后端工单子 worktree 零额外成本（mvn 直接可用，`~/.m2` 共享）；涉及 backend/web 依赖的票需先在该 worktree 跑一次 `pnpm install --frozen-lockfile`。
- 轻量变体（可选）：frontier 票为纯机械复制且父代理已核对文件集不相交时，可共用集成 worktree 并发只改文件不提交，由父代理统一验证后逐票提交。文件集无法确认不相交时回退上面的标准形态。
