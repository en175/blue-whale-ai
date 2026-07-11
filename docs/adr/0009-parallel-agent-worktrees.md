# ADR-0009：并行 Agent Session 使用独立 task worktree

- **状态**：Accepted
- **日期**：2026-07-07
- **决策者**：JJNNReno（与 Codex 经 `/grill-me` 会话共同得出）
- **更新**：2026-07-12，D1/D3 的基线规则以 [ADR-0010](0010-local-master-is-user-integration-zone.md) 为准；task worktree 隔离仍然有效。

## 背景

既有 Git 规范已经禁止直推 `master`，要求所有进入 `master` 的改动走分支、PR、服务端合并。但多 Session 并行时仍有一个更早的隔离问题：

> 多个 Agent Session 如果先在同一个本地 `master` 工作区修改文件，再到推送前创建分支，就会共享同一个工作区、index、未跟踪文件和生成物。

这会导致任务之间互相污染。即使最后推送到不同远程分支，污染已经发生在本地写入阶段。

## 决策

### D1. 可写任务前置隔离

Agent 一旦进入可写阶段，必须先创建独立 task worktree 和工单分支。`master` 是否允许用户本地开发由 [ADR-0010](0010-local-master-is-user-integration-zone.md) 重新定义；本 ADR 保留的是“Agent 写入任务必须隔离”的决策。

任务分支从同步后的本地 `master` 精确 SHA 创建。本地 dirty 会阻断；ahead 被保留；diverged 先普通 merge，冲突则 abort 并停止。

### D2. 固定 task worktree 目录

所有 task worktree 固定在主仓同级目录：

```text
../blue-whale-worktrees/
```

脚本只创建、巡检、清理这个目录下的 worktree。禁止在主仓内部创建任务 worktree。

### D3. 同步与创建是同一个原子开工入口

现行决策见 [ADR-0010](0010-local-master-is-user-integration-zone.md)：不再提供独立 `sync-master.sh`。`start-task-worktree.py` 在创建前完成 fetch、历史关系判断、fast-forward/merge 和精确 SHA 捕获，避免同步与创建之间出现另一套流程或错误基线。

### D4. 发布和清理分离

任务完成后先发布分支：

```bash
scripts/publish-review-package.sh --user-authorized
```

该脚本只推送分支，不创建 PR，不删除本地 worktree。

PR 合并后再清理：

```bash
scripts/cleanup-task-worktree.sh
```

清理脚本必须证明当前分支已被 `origin/master` 包含、工作区干净，才删除远程源分支、本地分支和 task worktree。

### D5. 增加只读巡检

为降低遗忘成本，提供：

```bash
scripts/list-task-worktrees.sh
```

该脚本只报告哪些 worktree 已合并、未合并或 dirty，不自动删除。

### D6. Codebase Memory MCP 是代码检索准入

Codebase Memory MCP 索引绑定具体 root path。task worktree 是新路径，不能复用主 checkout 索引。

创建 task worktree 后、代码检索或修改前，Agent 必须对该 worktree 执行 `index_repository`，并确认 `index_status=ready`。

### D7. Graphify 按需强制

Graphify 使用频率低于 Codebase Memory MCP，不作为所有任务的启动门槛。但一旦任务要用 Graphify，必须先在当前 task worktree 内执行：

```bash
scripts/ensure-graphify-worktree.sh
```

禁止用主 checkout 的 `graphify-out/` 代替 task worktree 图谱。

## 考虑过的备选

- **继续允许先在 master 改，推送前再建分支**：否决。它只解决远程分支归属，不解决本地并行写入污染。
- **打开 Session 就强制创建 worktree**：否决。只读调查不需要可写隔离，成本不必要。
- **自动 stash dirty master**：否决。dirty 文件可能是用户工作、Agent 残留或生成物，语义必须由人/Agent 显式判断。
- **Graphify 作为所有任务启动门槛**：否决。它是按需导航工具，默认强制会增加小任务成本。

## 后果

- 正面：多个 Agent Session 可以并行开发而不共享可写工作区。
- 正面：开工基线同时包含用户本地 `master` 的未推送提交和最新 `origin/master`。
- 正面：PR 未合并前保留 task worktree，便于处理审查反馈；PR 合并后有标准清理入口。
- 代价：每个可写任务多一个 worktree 目录，且代码检索前需要单独建立 Codebase Memory MCP 索引。

## 参考

- [ADR-0003：禁止直推 master](0003-no-direct-push-to-master.md)
- [ADR-0004：分支命名规范](0004-branch-naming.md)
- [ADR-0006：同步机制 = 自动阻断](0006-sync-mechanism-auto-block.md)
- [`docs/agents/worktree-workflow.md`](../agents/worktree-workflow.md)
