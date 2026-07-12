# Agent 任务区与用户本地集成区工作流

> 本文是 Agent 写入任务隔离、本地验收合入、发布包装分支的单一权威源。命中：准备改代码、完成子 issue、合入用户本地 master、发布 PR、PR 合并后清理、巡检遗留 worktree。

## 原则

- 本地 `master` 是**用户本地集成区**：用户可以在这里开发、commit、整理或集成本地改动。
- Agent 不得把本地 `master` 当任务写入区；Agent 可写任务必须先创建独立 task worktree 和工单分支。
- 所有 task worktree 固定放在主仓同级目录：`../blue-whale-worktrees/`。
- 一个 task worktree 只承载一个任务分支，用完即清理。
- task worktree 基于同步后的本地 `master` 精确 SHA 创建，以同时保留个人本地更新和最新远程更新。
- 只读调查、研究、设计和审查不需要 task worktree；任务一旦可能写入仓库内容或改变 Git 状态，必须先执行本流程。

## 开工

在主 checkout 执行：

```bash
scripts/start-task-worktree.sh --type <类型> (--issue <工单号>|--no-issue) --summary <中文简述>
```

示例：

```bash
scripts/start-task-worktree.sh --type docs --no-issue --summary 补全工作树使用规范
```

脚本会：

- 校验当前是主 checkout 的干净 `master`，且没有 merge/rebase/cherry-pick/revert 正在进行；不满足时停止，不自动 abort、stash 或清理
- 校验并生成白名单前缀 + 结构化中文分支名
- `git fetch origin master`
- 本地已包含远程时保留本地 HEAD；本地落后时 `--ff-only`；分叉时普通 merge
- merge 冲突时自动 `git merge --abort`，不创建分支或 Work Tree
- 记录同步后的精确 `master` SHA，并从该 SHA 创建 task worktree

脚本生成 Work Tree 目录名，Agent 不需要设计路径。macOS/Linux/Git Bash 可使用 `.sh` 薄包装；Windows PowerShell/CMD 使用 `py -3 scripts/start-task-worktree.py ...`。两者运行同一个 Python 标准库实现。

### Windows（Git Bash）手动验证

`.sh` wrapper 在 Git Bash 下探测 Python 3 的顺序为 `python3`（命中 Microsoft Store 桩则跳过）→ `py -3` → 报错引导。CI 矩阵不覆盖 Windows，以下步骤需在 Windows 手动执行并记录结果。

前置：已装真正的 Python 3（python.org 安装包或 Microsoft Store 正式版），`py` launcher 随安装可用；Git Bash（Git for Windows 自带）。

1. 确认 `py -3` 可用、未被 Store 桩遮蔽：

   ```bash
   py -3 --version
   ```

   预期打印 `Python 3.x.x`。若报「Python was not found」，说明 Store 的 `python3` 应用执行别名在 PATH 最前，需在「设置 → 应用 → 高级应用设置 → 应用执行别名」关闭 `python3`/`python`，或保证 `py -3` 在 PATH 中早于 `WindowsApps`。

2. 在主 checkout（Git Bash）运行开工入口，验证结构化中文分支生成：

   ```bash
   bash scripts/start-task-worktree.sh --type chore --no-issue --summary 补全工作树使用规范
   ```

   预期退出码 0，stdout 含「已创建中文任务分支：chore/补全工作树使用规范」与 Work Tree 路径。

3. 验证 UTF-8 中文分支名往返：

   ```bash
   git -C <Work-Tree-路径> branch --show-current
   ```

   预期正确打印 `chore/补全工作树使用规范`，中文无乱码；随后推送时 pre-push 接受该中文名（pre-push 拒绝/接受的逻辑由 `scripts/tests/test_start_task_worktree.py` 黑盒覆盖，Windows 侧只需确认中文名不被 Git Bash 编码损坏）。

4.（可选）验证 Store 桩检测：临时把 `WindowsApps` 放到 PATH 最前再跑步骤 2，预期 wrapper 跳过桩、改走 `py -3` 成功；临时移除 `py` 后再跑，预期非零退出且 stderr 含「Microsoft Store 桩」引导。

每次 Windows 环境的 Python/Git Bash 升级或开工入口改动后，执行人在此记录通过结果（日期 + Python 版本 + Git Bash 版本）。

## 用户本地集成区

本地 `master` 由用户控制。Agent 不自动 stash、清理、rebase 或发布。开工入口只在主 checkout 干净时同步：保留本地 ahead 提交，并融合 `origin/master`；dirty 或合并冲突都会停止并保留原状态。

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

Agent 完成子 issue 后直接走提交入口落盘 commit（无需用户先确认/授权），停在 commit 等 review。默认交付：

- 子 issue 的一个 commit（稳定可 review、可 revert 的检查点）
- 验证结果
- 用户 review / 微调入口

Agent 不自动合入本地 `master`、不自动推送、不自动开 PR。

## 合入用户本地集成区

用户确认任务验收分支上的 commit 无问题后，Agent 可以在明确确认下执行本地合入；用户也可以手动合入。Agent 执行时：

1. 确认本地 `master` 工作区干净；不干净则报告状态并停止。
2. 切回本地 `master`。
3. 合入任务分支，保留子 issue 边界：

```bash
scripts/merge-task-to-local-master.sh --user-authorized <任务分支>
```

4. 如有 merge conflict，Agent 可在本次合入授权范围内解决并运行验证；解决后停在本地 `master` 汇报结果，不继续远程发布。

Claude/Codex hook 会硬拦直接 `git commit`、非 `--ff-only` 的直接 `git merge` 以及缺少 `--user-authorized` 的合入本地 master 入口，并指引 Agent 改走标准入口；提交入口出现即放行，合入入口带授权参数无交互放行。

## 发布包装 Work Tree

多个子 issue 可先合入用户本地 `master`。用户决定发布时，仍通过同一个开工入口从同步后的本地 `master` 创建结构化中文发布包装 Work Tree：

```bash
scripts/start-task-worktree.sh --type feature --no-issue --summary 发布模块版本更新
```

发布包装分支负责适配远程 `origin/master`。若同步冲突，入口 abort 且不创建；创建后的测试或发布修复只发生在该 Work Tree，不回写用户本地 `master`。

PR 合并后在该 Work Tree 运行 `scripts/cleanup-task-worktree.sh`，与普通任务使用同一清理流程。

策略升级前已经存在的主 checkout 发布包装分支不要求迁移；其合并后仍使用旧清理入口收尾，但不得再以这种形态创建新分支：

```bash
scripts/cleanup-release-branch.sh --user-authorized <发布包装分支>
```

## 发布审查包

用户明确授权发布审查包后，在待发布工单分支执行：

```bash
scripts/publish-review-package.sh --user-authorized
```

脚本是发布审查包的唯一标准入口。`--user-authorized` 表示 Agent 已从当前对话取得明确授权，Claude Code 与 Codex Hook 均无二次弹框放行。它只做 Git 安全检查和推分支：

- 当前必须是结构化中文任务/发布包装 Work Tree 分支；策略升级前已存在的远程旧分支可完成收尾。
- 工作区必须干净。
- 当前分支必须包含最新 `origin/master`。
- 推送当前分支到远程；远程分支已存在时使用 `--force-with-lease` 安全更新。

禁止直接执行 `git push` 绕过该入口；直接 push 会被 Hook 硬拦。旧脚本 `scripts/publish-task-branch.sh` 已废弃，只会提示改用标准入口。

脚本不创建 Gitee PR。推送成功后会写入短期发布标记；随后按 `.gitee/PULL_REQUEST_TEMPLATE.md` 在 Gitee 创建 PR，目标分支为 `master`。创建 PR Hook 在 PreToolUse 校验该标记（`draft` 非 true、`target_branch=master`、`source_branch` 与发布标记一致），PostToolUse 创建成功后消费，不二次确认。PR 创建失败（404 / 网络 / 参数错）不消耗标记，可原地重试（见 [ADR-0011](../adr/0011-release-marker-consume-after-pr-success.md)）。PR 创建后必须停下来交给开发者审查；发布审查包授权不覆盖合并。

**标记位置契约**：发布标记按来源分支隔离，存于 git common dir（`<repo>/.git/agent-release-review-package-<branch-slug>`，分支名中的 `/` 转义为 `%`）。common dir 对主 checkout 与所有 task worktree 是**同一物理路径**，因此 **Claude session 在主 checkout 还是 worktree 启动均对称生效**——标记读写不依赖 session 启动位置。此契约修复了「主 checkout session + cd worktree 跑发布」时建 PR 被误拦的缺陷（标记写在 worktree git path、hook 在主仓 git path 找不到）。

PR 未合并前，本地分支、远程源分支和 task worktree 都保留，以便处理审查反馈。

合并 PR 必须在当前对话中另获明确授权。Agent 自动生成绑定企业、仓库和 PR ID 的一次性凭证后调用 MCP；PreToolUse 按 `tool_use_id` 原子占用凭证，避免并发复用，只有 `tool_response.isError=false` 的明确成功 PostToolUse 才消费。失败或畸形结果释放占用并保留凭证。合并成功授权同时覆盖按分支形态执行上述安全清理，不再单独询问。

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
