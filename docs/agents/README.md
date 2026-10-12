# docs/agents 索引

> 本目录是**人 + AI 协作的散装 SOP 库**——不命中就不用读,命中就来查。
> 与 CLAUDE.md 的关系:CLAUDE.md 列「高频硬约束」,本目录放「低频细节 + 命中时查的手册」。
> 维护原则:每篇文档自己就是单一权威源,改文档必须同步改它引用的 hook / 脚本(见 [hooks/README.md](hooks/README.md) 变更检查清单)。

---

## 何时查哪篇

| 场景 | 文档 |
|---|---|
| **开 PR / 提交代码** | [commit-and-review.md](commit-and-review.md) |
| **开新分支** | [branch-naming.md](branch-naming.md) |
| **Agent 任务区 / 本地集成 / task worktree 生命周期** | [worktree-workflow.md](worktree-workflow.md) |
| **创建 / 跟进 Issue** | [issue-tracker.md](issue-tracker.md) |
| **打 / 改标签** | [triage-labels.md](triage-labels.md) |
| **改工单状态（需求 / 任务 / 缺陷）** | 人看 [gitee-workflow.md](gitee-workflow.md)；Agent 看 [gitee-workflow-agent.md](gitee-workflow-agent.md) |
| **维护 / 新增 Claude Code 拦截器** | [hooks/README.md](hooks/README.md) |

---

## 文档之间的引用

- [branch-naming.md](branch-naming.md) ↔ [commit-and-review.md](commit-and-review.md):分支前缀 vs Conventional Commits type 区分(刻意不统一,见 branch-naming.md)
- [worktree-workflow.md](worktree-workflow.md) → [ADR-0009](../../adr/0009-parallel-agent-worktrees.md):并行 Agent Session 的 task worktree 隔离
- [worktree-workflow.md](worktree-workflow.md) → [ADR-0115](../adr/0115-local-release-code-baseline.md):当前发布线基线与 Agent 任务区边界；替代 [ADR-0010](../adr/0010-local-master-is-user-integration-zone.md)
- [hooks/README.md](hooks/README.md) → [commit-and-review.md](commit-and-review.md):「合并方法」一节
- [hooks/README.md](hooks/README.md) → [ADR-0003](../../adr/0003-no-direct-push-to-master.md):「禁止直推 master」决策
- [branch-naming.md](branch-naming.md) → [ADR-0004](../../adr/0004-branch-naming.md):分支命名决策
- [branch-naming.md](branch-naming.md) → [ADR-0006](../../adr/0006-sync-mechanism-auto-block.md):远程-本地同步机制

---

## 新增文档时

1. 在本文件「何时查哪篇」表格加一行
2. 必要时在「文档之间的引用」加交叉链接
3. 改完在 CLAUDE.md「命中以下情况」段(如有)同步加触发条件
