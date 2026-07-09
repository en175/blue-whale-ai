# Gitee 工作流

> 防御顺序：规范前置 → Hook 兜底。Hook 违规时会拦截并在错误信息中指路到对应文档。

## 发布授权（最高红线）

- 未经用户明确授权，禁止 `git push`、创建 PR、合并 PR、创建 release、删除远程源分支。
- "继续""可以""你处理吧"这类泛化许可不算发布授权——必须明确包含发布/推送/开 PR/合并意图。
- 发布审查包（推送+开 PR）唯一入口：`scripts/publish-review-package.sh --user-authorized`。
- 合并 PR 须另获授权，仍只用 merge 方法。
- PR 创建后停下来交给开发者审查，不自作主张合并。

## 禁直推 master（最高红线）

- 禁止 `git push origin master`。全走 分支 → PR → merge。`hotfix/*` 无特权。
- 低风险 PR 可在用户授权后用 Gitee MCP 合并；高风险 PR 必须人手动合。
- 根因：`docs/adr/0003-no-direct-push-to-master.md`

## 合并策略

- 只用 merge（禁 squash/rebase）。Gitee MCP `merge_enterprise_pull` 不传或 `merge_method=merge`。
- Gitee merge 默认不删源分支，MCP 也无 `prune_source_branch` 参数。PR 合并后跑 `scripts/cleanup-task-worktree.sh` 清理。

## 分支命名

- 前缀必须在白名单内（hook 强制）。不在白名单 → `--force-with-lease` 被拦；落后 `origin/master` → push 被拦。
- 完整规则：`docs/agents/branch-naming.md`，决策：`docs/adr/0004-branch-naming.md`

## Task Worktree

- Agent 改文件前必须在主 checkout 跑 `scripts/start-task-worktree.sh <branch> <worktree-dir>`。
- Worktree 默认从 `origin/master` 创建，固定在 `../blue-whale-worktrees/`。
- 本地 `master` 是用户集成区，Agent 不得写入。
- 子 issue 完成后停在未提交 diff，用户确认后才提交。
- 提交流程：`scripts/commit-task-for-review.sh --user-authorized -m "<message>"` → `scripts/merge-task-to-local-master.sh --user-authorized <branch>`
- 完整流程：`docs/agents/worktree-workflow.md`，决策：`docs/adr/0010-local-master-is-user-integration-zone.md`

## Codebase Memory MCP

- 创建 task worktree 后，必须先对该 worktree 跑 `index_repository(repo_path=<task-worktree>)` 并确认 `index_status=ready`。
- 不得用主 checkout 索引替代。

## 远程-本地同步

- 动 git 前先 `git fetch origin`。落后 push 会被 pre-push hook 硬拦。
- 工单分支落后 → `git rebase origin/master`。解不动 `git rebase --abort`。
- 强推仅工单分支放行：`git push --force-with-lease`。裸 `--force`、对 master 强推被拦。
- 机制兜底：pre-commit 软提醒、pre-push 硬拦。见 `docs/adr/0006-sync-mechanism-auto-block.md`

## Commit 规范

- Conventional Commits：`<type>: <描述>`，type 用 `feat` / `fix` / `docs` / `refactor` / `chore`。
- 一次提交只干一件事。
- `feat`（commit type）≠ `feature`（分支前缀），刻意不统一。

## 禁碰/禁提交

- 不碰生成物：`graphify-out/`、`dist/`、`target/`、`.next/`、`__pycache__/`、`node_modules/`
- 不提交：生成物、`.claude/settings.local.json`、密钥凭证（`.env`、`*.key`、`*.pem`）
- `.claude/` 团队协作目录进仓（`settings.json` + `hooks/`），仅 `settings.local.json` 不进。
