# Agent 任务区与用户本地集成区工作流

> 本文是 Agent 写入任务隔离、本地验收合入、发布包装分支的单一权威源。命中：准备改代码、完成子 issue、合入用户本地 master、发布 PR、PR 合并后清理、巡检遗留 worktree。

## 原则

- 本地 `master` 是**用户本地集成区**：用户可以在这里开发、commit、整理或集成本地改动。
- Agent 不得把本地 `master` 当任务写入区；Agent 可写任务必须先创建独立 task worktree 和工单分支。
- 所有 task worktree 固定放在主仓同级目录：`../blue-whale-worktrees/`。
- 一个 task worktree 只承载一个任务分支，用完即清理。
- `origin/master` 是 Agent 任务分支的默认权威基线；除非用户明确要求，task worktree 不基于本地 `master` 创建。

## 开工

在主 checkout 执行：

```bash
scripts/start-task-worktree.sh <branch-name> <worktree-dir-name>
```

示例：

```bash
scripts/start-task-worktree.sh docs/补全并行worktree规范 docs-补全并行worktree规范
```

脚本会：

- `git fetch origin master`
- 从 `origin/master` 创建 task worktree
- 不要求本地 `master` 干净、同步或不 ahead

如果用户明确要求“基于我本地 master 当前状态开分支”，这不是默认 task worktree 流程，应按“发布包装分支”或一次性迁移流程单独处理。

## 用户本地集成区

本地 `master` 由用户控制。Agent 看到它 dirty、ahead 或 diverged 时，不自动 stash、清理、rebase、发布，也不把这些状态当作开新 task worktree 的阻塞条件。

只有进入“合入任务验收分支”动作前，本地 `master` 必须是干净工作区；若不干净，Agent 只报告 `git status --short`，等待用户决定。

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

## 子 issue 完成

Agent 完成子 issue 后停在任务 worktree 分支上，默认交付：

- 未提交 diff
- 验证结果
- 用户 review / 微调入口

Agent 不自动 commit、不自动合入本地 `master`、不自动推送、不自动开 PR。

## 合入用户本地集成区

用户确认任务验收分支无问题后，Agent 可以在明确确认下执行本地合入；用户也可以手动合入。Agent 执行时：

1. 确认本地 `master` 工作区干净；不干净则报告状态并停止。
2. 在任务验收分支上创建本地 commit：

```bash
scripts/commit-task-for-review.sh --user-authorized -m "<commit-message>"
```

3. 切回本地 `master`。
4. 合入任务分支，保留子 issue 边界：

```bash
scripts/merge-task-to-local-master.sh --user-authorized <任务分支>
```

5. 如有 merge conflict，Agent 可在本次合入授权范围内解决并运行验证；解决后停在本地 `master` 汇报结果，不继续远程发布。

Claude/Codex hook 会拦住或确认直接 `git commit`、非 `--ff-only` 的直接 `git merge` 以及缺少 `--user-authorized` 的本地验收入口，避免 Agent 跳过默认的未提交 diff 验收点。

## 发布包装分支

多个子 issue 可先合入用户本地 `master`。用户决定发布时，从本地 `master` 当前状态创建发布包装分支：

```bash
git checkout master
git checkout -b feature/<PRD-or-module>-release
```

发布包装分支负责适配远程 `origin/master`。若它与 `origin/master` 冲突或测试失败，修复只发生在发布包装分支，不回写用户本地 `master`。

### 发布包装分支合并后清理

发布包装分支合并进 `origin/master` 后，其形态是「主 checkout 上的本地分支」（不在 task worktree 内），`cleanup-task-worktree.sh` 只认 worktree 路径形态、在此 fail。用专用入口清理：

```bash
scripts/cleanup-release-branch.sh --user-authorized <发布包装分支>
```

脚本在主 checkout 的本地 `master` 上执行，会：

- 校验在主 checkout（非 task worktree）、当前在 `master`、工作区干净
- 校验分支名命中白名单前缀（`feature/ fix/ hotfix/ docs/ chore/`）、本地分支存在
- `fetch origin master` 并用 `merge-base --is-ancestor` 确认已合并进 `origin/master`
- 删本地分支 + 删远程源分支（`ls-remote` 探活后才删）+ `git fetch --prune`

与 `## PR 合并后清理 task worktree` 的区别：那个入口管 **task worktree 形态**（删 worktree + 任务分支 + 远程源分支），本入口管 **主 checkout 发布包装分支形态**（只删分支，无 worktree）。两者按形态分流，不要混用。本地分支删除用 `update-ref -d`（非 `branch -d`），因为本地 `master` 作为用户集成区可能落后 `origin/master`，`branch -d` 的「已合入当前 HEAD」判定会误拒已合并分支。

## 发布审查包

用户明确授权发布审查包后，在待发布工单分支执行：

```bash
scripts/publish-review-package.sh --user-authorized
```

脚本是发布审查包的唯一标准入口，会在 Claude Code Hook 中触发一次用户确认。它只做 Git 安全检查和推分支：

- 当前必须是工单分支（task worktree 分支或发布包装分支）。
- 工作区必须干净。
- 当前分支必须包含最新 `origin/master`。
- 推送当前分支到远程；远程分支已存在时使用 `--force-with-lease` 安全更新。

禁止直接执行 `git push` 绕过该入口；直接 push 会被 Hook 硬拦。旧脚本 `scripts/publish-task-branch.sh` 已废弃，只会提示改用标准入口。

脚本不创建 Gitee PR。推送成功后会写入短期发布标记；随后按 `.gitee/PULL_REQUEST_TEMPLATE.md` 在 Gitee 创建 PR，目标分支为 `master`。创建 PR Hook 会校验并消费该标记，同时要求 `draft` 非 true、`target_branch=master`、`source_branch` 与发布标记一致，不二次确认。PR 创建后必须停下来交给开发者审查；发布审查包授权不覆盖合并。

**标记位置契约**：发布标记按来源分支隔离，存于 git common dir（`<repo>/.git/agent-release-review-package-<branch-slug>`，分支名中的 `/` 转义为 `%`）。common dir 对主 checkout 与所有 task worktree 是**同一物理路径**，因此 **Claude session 在主 checkout 还是 worktree 启动均对称生效**——标记读写不依赖 session 启动位置。此契约修复了「主 checkout session + cd worktree 跑发布」时建 PR 被误拦的缺陷（标记写在 worktree git path、hook 在主仓 git path 找不到）。

PR 未合并前，本地分支、远程源分支和 task worktree 都保留，以便处理审查反馈。

## PR 合并后清理 task worktree

PR 已经合并进 `origin/master` 后，在该任务的 task worktree 内执行：

```bash
scripts/cleanup-task-worktree.sh
```

脚本会：

- `git fetch origin`
- 确认当前分支已被 `origin/master` 包含
- 确认工作区干净
- 删除远程源分支（如仍存在）
- 删除当前 task worktree
- 删除本地任务分支
- `git fetch --prune`

如果 PR 尚未合并、工作区 dirty、当前路径不在 `../blue-whale-worktrees/`，脚本会失败并停止。脚本不再同步用户本地 `master`；用户自行决定何时把远程 `master` 同步回本地集成区。

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
