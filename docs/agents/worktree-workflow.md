# Agent 任务区

本文说明日常任务的代码基线、独立写入区、验证、PR 和清理。分支模型与晋级顺序见 [branch-naming.md](branch-naming.md) 与 [git-workflow.md](git-workflow.md)；生产 hotfix 的授权边界见 [git-workflow.md](git-workflow.md)。

## 基线

`master` 与 `origin/master` 是唯一基线。`dev`、`test`、`release` 是三条环境分支，只接收来自开工分支的 PR 合入，彼此不合并，也不接收 master 直接合入。每次 `release` 发版后由人把 `release` 合回 `master`；此后从 master 拉出的新开工分支自然带上已完成的功能。

不要用环境分支当起点。开工分支的起点永远是 `origin/master`。

## 只读任务

依赖仓库代码的只读任务，包括只读调查、调试和审查，在主检出区或任一任务区运行：

```bash
git fetch origin --prune
git log --oneline -5 origin/master
```

工作区可以 dirty，只读结论应分别说明已提交基线和未提交内容。同步后核对该目录的 CBM 索引与覆盖范围。

## 写入任务

任何可能改动仓库的普通任务都在主检出区运行唯一开工入口。散文文档和 chore 也走同一路径：

```bash
scripts/start-task-worktree.sh --type <feature|fix|hotfix|docs|chore> (--issue <工单号>|--no-issue) --summary <6–15字中文简述> --target-branch <master|dev|test|release>
```

入口抓取远端后固定从 `origin/master` 的精确提交建立中文任务分支和独立 worktree。`--target-branch` 必填，声明这条开工分支先发往哪条分支；它不参与起点选择，也不限制之后逐级改投。调用目录的未提交文件不会复制到任务区。任务区的 Git 私有目录保存 `task_branch`、`target_branch` 和 `start_sha`。读取方式：

```bash
python3 scripts/lib/task_metadata.py read --json
```

缺少或不一致的元数据会阻断提交安全判断、验证、发布和清理。旧任务区只可在核对真实目标与起点、获得人类授权后运行 `task_metadata.py repair --target-branch <master|dev|test|release> --start-sha <SHA> --user-authorized`。不得静默回退 master。

macOS、Linux 和 Git Bash 使用 `.sh`；Windows PowerShell/CMD 可用 `py -3 scripts/start-task-worktree.py ...`。Windows 的真实 Git Bash 与 Python launcher 兼容性仍需在 Windows 机器上人工验证。

任务分支内用 `scripts/commit-task-for-review.sh -m "<message>"` 保存可审查提交。`--amend` 只在分支已有起点之后的任务提交时可用，不能改写起点。普通任务不在 master 检出区直接编辑和提交。仅 Git 已忽略的根 `CLAUDE.local.md`、`.codex/config.toml` 可在本地 master 修改，不得提交或输出凭证。

## 验证与发布

提交后先按 [testing-strategy.md](testing-strategy.md) 运行收口验证，读取 `check --json`。

任务是**同一条分支依次发 PR**，不是合并环境分支：

```bash
node scripts/verify-change-scope.mjs run --stage pr --target-branch dev
scripts/publish-review-package.sh --user-authorized --create-pr --target-branch dev --json
# 开发环境验证通过后，同一条分支再发 test，测试通过后再发 release
```

验证凭证绑定目标分支、该目标的远端 SHA、HEAD、文件集合与输入。**每次改投新目标都要带新目标重跑 `run`**，凭证不跨目标复用。三个目标互不包含，因此不需要 rebase 到目标分支，也不需要目标分支包含任务起点。

发布入口要求工作区干净、目标在白名单内，且 PR 阶段凭证覆盖当前目标。目标不是 `dev`/`test`/`release`（即 `master` 或 `release/<批次>`）时，入口额外要求当前分支已包含远端目标，避免把目标上的未知提交带进 PR：

```bash
scripts/publish-review-package.sh --user-authorized --create-pr --target-branch <master|dev|test|release> --json
# 草稿参数及依据见 git-workflow.md「PR 草稿条件与回读」
```

入口成功后，Agent 用 Gitee 创建 source/target 与发布标记一致的 PR，并显式传 `draft=true` 或 `draft=false`。Hook 比较标记中的 `draft`、source 和 target，也核对远端源 HEAD 与目标 SHA。提交变化时重新验证和发布。创建成功的 PostToolUse 才消费标记；失败或旧标记缺字段时不放行。用户授权修订已有 PR 时，运行 `--update-pr <编号> --pr-snapshot <临时JSON>`。快照记录 opened、source、target、head、conflict、changed_files 与 fetched_at。推送后回读 PR，运行 `scripts/verify-pr-update.sh`，成功后再 finalize 同步恢复点。

PR 创建后保留本地任务分支、远端源分支和 task worktree 处理审查反馈。合并 PR 需要单独授权，只用 `merge`。

- 合入 `dev` 后不清理任务区：同一条分支还要继续发 `test` 和 `release`。
- 任务分支落后目标、需要先把目标上的提交纳入时，才运行 `scripts/sync-task-from-origin.sh sync --target-branch <分支> --json`；它针对该目标 rebase 并重建同步恢复点，冲突时自动 abort。

## 清理

任务分支合入**最后一级目标**（通常是 `release`）后，在任务 worktree 内运行：

```bash
scripts/cleanup-task-worktree.sh
```

入口抓取远端目标，核对任务 HEAD 已被包含、工作区干净，并复核远端 SHA 没有变化。通过后只删除本地 task worktree 和本地任务分支，保留远端任务源分支。元数据仍记录开工时声明的目标，若该目标不是最终合入的那一级，清理会以「远端目标尚未包含任务提交」停止——此时不做清理，或在授权后运行 `task_metadata.py repair` 把目标改成实际合入的分支再清理。

`master`、环境分支工作树、历史分支和 dirty 文件不由本入口清理。`scripts/list-task-worktrees.sh` 只用于只读巡检。`scripts/commit-spec-on-master.sh` 已废止，`scripts/merge-task-to-local-master.sh` 是历史入口，不用于日常任务。

本流程由 [ADR-0133](../adr/0133-environment-branches.md) 确认，替代 [ADR-0115](../adr/0115-local-release-code-baseline.md) 的本地发布线批次基线和 [ADR-0010](../adr/0010-local-master-is-user-integration-zone.md) 的本地 master 集成区规则。
