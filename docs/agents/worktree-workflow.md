# Agent 任务区与本地发布线

本文说明日常任务的代码基线、独立写入区、验证、PR 和清理。发布线换期与生产 hotfix 的授权边界见 [git-workflow.md](git-workflow.md)。

## 先同步再读取

依赖仓库代码的任务，包括只读调查、调试和审查，先进入当前本地发布线工作树。用 `scripts/manage-release-branch.sh current --json` 核对活动分支及目录，再执行：

```bash
scripts/sync-release-line.sh --json
```

入口抓取同名远端 release，并使本地已提交历史包含本次抓取的远端提交。本地领先时保留原提交，远端领先时快进，分叉无冲突时合并。冲突、远端不可达或同步会覆盖未提交文件时停止。报告实际状态，不声称代码已更新。同步后核对该目录的 CBM 索引与覆盖范围。只读结论若涉及 dirty 文件，分别说明已提交基线和未提交内容。

`master` 与 `origin/master` 代表生产版本。当前发布线由发布负责人一次授权启用；新候选不能按日期自动切换。旧任务和 PR 不自动迁移。

## 写入任务

任何可能改动仓库的普通任务都运行唯一入口。散文文档和 chore 也走同一路径。入口可在任意本地检出（主检出区或发布线工作树）调用，起点与调用目录无关：

```bash
scripts/start-task-worktree.sh --type <feature|fix|hotfix|docs|chore> (--issue <工单号>|--no-issue) --summary <6–15字中文简述> --target-branch <master|dev|test|release>
```

入口抓取远端后固定从 `origin/master` 的精确提交建立中文任务分支和独立 worktree。`--target-branch` 必填，声明这条任务之后 PR 合入哪条分支；它不参与起点选择。当前检出区的未提交文件不会复制到任务区。任务区的 Git 私有目录保存 `task_branch`、`target_branch` 和 `start_sha`。读取方式：

```bash
python3 scripts/lib/task_metadata.py read --json
```

缺少或不一致的元数据会阻断提交安全判断、验证、发布和清理。旧任务区只可在核对真实目标与起点、获得人类授权后运行 `task_metadata.py repair --target-branch <master|dev|test|release> --start-sha <SHA> --user-authorized`。不得静默回退 master。

macOS、Linux 和 Git Bash 使用 `.sh`；Windows PowerShell/CMD 可用 `py -3 scripts/start-task-worktree.py ...`。Windows 的真实 Git Bash 与 Python launcher 兼容性仍需在 Windows 机器上人工验证。

任务分支内用 `scripts/commit-task-for-review.sh -m "<message>"` 保存可审查提交。`--amend` 只在分支已有起点之后的任务提交时可用，不能改写起点。普通任务不在 master 或 release 目录直接编辑和提交。仅 Git 已忽略的根 `CLAUDE.local.md`、`.codex/config.toml` 可在本地 master 修改，不得提交或输出凭证。

## 验证与发布

提交后先按 [testing-strategy.md](testing-strategy.md) 运行收口验证，读取 `check --json`。**任务起点是 `origin/master`，目标分支可能领先**——目标上有 master 尚未合入的提交时，PR 阶段验证会返回 `PR_TARGET_NOT_SYNCED`。发布前先抓取任务记录的目标分支；若任务分支落后，运行：

```bash
scripts/sync-task-from-origin.sh sync --target-branch <master|dev|test|release> --json
```

它为原提交建立恢复点并针对该目标 rebase；冲突时自动 abort。推送前失败可按入口状态 rollback；进入 push 状态后须核对远端 SHA，不能自动回滚。目标前进或 HEAD 变化后重新运行 `node scripts/verify-change-scope.mjs run --stage pr`。验证凭证绑定任务起点、有效 diff 基线、目标远端 SHA、HEAD、文件集合与输入。

发布入口要求工作区干净、目标与元数据一致、远端目标包含任务起点，且 PR 阶段凭证有效。若本地 release 的领先提交尚未进入远端，该入口拒绝推送，避免把其他任务的提交带入 PR：

```bash
scripts/publish-review-package.sh --user-authorized --create-pr --target-branch <master|dev|test|release> --json
# 草稿参数及依据见 git-workflow.md「PR 草稿条件与回读」
```

入口成功后，Agent 用 Gitee 创建 source/target 与发布标记一致的 PR，并显式传 `draft=true` 或 `draft=false`。Hook 比较标记中的 `draft`、source 和 target，也核对远端源 HEAD 与目标 SHA。提交变化时重新验证和发布。创建成功的 PostToolUse 才消费标记；失败或旧标记缺字段时不放行。用户授权修订已有 PR 时，运行 `--update-pr <编号> --pr-snapshot <临时JSON>`。快照记录 opened、source、target、head、conflict、changed_files 与 fetched_at。推送后回读 PR，运行 `scripts/verify-pr-update.sh`，成功后再 finalize 同步恢复点。

PR 创建后保留本地任务分支、远端源分支和 task worktree 处理审查反馈。合并 PR 需要单独授权；不能把 `can_merge=true` 当作合并许可。

## 清理

PR 合入元数据记录的目标 release 后，在任务 worktree 内运行：

```bash
scripts/cleanup-task-worktree.sh
```

入口抓取远端目标，核对任务 HEAD 已被包含、工作区干净，并复核远端 SHA 没有变化。通过后只删除本地 task worktree 和本地任务分支，保留远端任务源分支。任务未合入、远端不可达或分支发生变化时停止。

`master`、旧 release 工作树、历史分支和 dirty 文件不由本入口清理。`scripts/list-task-worktrees.sh` 只用于只读巡检。`scripts/commit-spec-on-master.sh` 已废止，`scripts/merge-task-to-local-master.sh` 是历史入口，不用于日常发布线任务。

本流程由 [ADR-0115](../adr/0115-local-release-code-baseline.md) 确认，替代 [ADR-0010](../adr/0010-local-master-is-user-integration-zone.md) 的本地 master 集成区规则和 [ADR-0025](../adr/0025-doc-on-master-allowlist.md) 的散文直写例外。
