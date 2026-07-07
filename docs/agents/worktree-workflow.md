# 并行任务 worktree 工作流

> 本文是并行 Agent Session 的任务隔离单一权威源。命中：准备改代码、发布任务分支、PR 合并后清理、巡检遗留 worktree。

## 原则

- `master` 只做只读调查和 `origin/master` 的可刷新镜像。
- 可写任务必须先创建独立 task worktree 和工单分支。
- 所有 task worktree 固定放在主仓同级目录：`../blue-whale-worktrees/`。
- 一个 task worktree 只承载一个任务分支，用完即清理。
- `origin/master` 是任务分支的权威基线；本地 `master` 只做健康镜像。

## 开工

在主 checkout 执行：

```bash
scripts/start-task-worktree.sh <branch-name> <worktree-dir-name>
```

示例：

```bash
scripts/start-task-worktree.sh docs/补全并行worktree规范 docs-补全并行worktree规范
```

脚本会先调用 `scripts/sync-master.sh`：

- `git fetch origin`
- 确认当前是主 checkout 的 `master`
- 确认 `master` 工作区干净
- 确认本地 `master` 没有 ahead/diverged
- behind 时只做 `git merge --ff-only origin/master`
- 从 `origin/master` 创建 task worktree

如果 `master` dirty/ahead/diverged，脚本会硬停，不会 stash、不会带走改动。

## dirty master SOP

发现本地 `master` 有改动时：

1. 禁止继续创建 task worktree。
2. 禁止自动 stash。
3. Agent 必须报告 `git status --short`。
4. 用户确认归属后再处理：
   - 属于某个任务：迁移到对应 task worktree。
   - 属于误改/生成物：确认后清理。
   - 属于用户未完成工作：保留，换一个干净 checkout 开任务。

## Codebase Memory MCP

创建 task worktree 后、做代码检索或代码修改前，Agent 必须为当前 task worktree 建立 Codebase Memory MCP 索引：

```text
index_repository(repo_path="<task-worktree-path>", mode="fast|moderate|full")
index_status(project="<task-worktree-project>") == ready
```

规则：

- 不得用主 checkout 的 Codebase Memory 索引替代 task worktree 索引。
- MCP 不可用或索引失败时，必须停止并报告。
- 小改动默认 `fast`；需要语义检索用 `moderate`；大型架构分析用 `full`。

## Graphify

Graphify 是按需强制，不是所有任务的启动门槛。

当任务涉及架构分析、跨文件关系、代码库导航，或 Agent 准备使用 `graphify query/path/explain` 时，必须先在当前 task worktree 内执行：

```bash
scripts/ensure-graphify-worktree.sh
```

禁止用主 checkout 的 `graphify-out/` 替代 task worktree 图谱。

## 发布分支

开发完成后，Agent 先报告本地验证结果和待发布分支，等待用户明确授权发布审查包。获得授权后，在 task worktree 内执行：

```bash
scripts/publish-task-branch.sh
```

脚本只做 Git 安全检查和推分支：

- 当前必须是工单分支。
- 工作区必须干净。
- 当前分支必须包含最新 `origin/master`。
- 推送当前分支到远程。

脚本不创建 Gitee PR。推送后按 `.gitee/PULL_REQUEST_TEMPLATE.md` 在 Gitee 创建 **draft PR**，目标分支为 `master`。创建 PR 后必须停下来交给开发者审查；发布审查包授权不覆盖合并。

PR 未合并前，本地分支、远程源分支和 task worktree 都保留，以便处理审查反馈。

## PR 合并后清理

PR 已经合并进 `origin/master` 后，在该任务的 task worktree 内执行：

```bash
scripts/cleanup-task-worktree.sh
```

脚本会：

- `git fetch origin`
- 确认当前分支已被 `origin/master` 包含
- 确认工作区干净
- 删除远程源分支（如仍存在）
- 同步主 checkout 的 `master`
- 删除当前 task worktree
- 删除本地任务分支
- `git fetch --prune`

如果 PR 尚未合并、工作区 dirty、当前路径不在 `../blue-whale-worktrees/`，脚本会失败并停止。

## 巡检

在主 checkout 执行：

```bash
scripts/list-task-worktrees.sh
```

它只读报告 `../blue-whale-worktrees/` 下的任务状态，不删除任何东西。

报告分类：

- clean + merged：可进入该 worktree 执行 cleanup。
- dirty：先处理未提交改动。
- not-merged：保留，等待 PR 合并或继续处理审查反馈。
