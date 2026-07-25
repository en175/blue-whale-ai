# ADR-0025：文档白名单——AI 可在本地 master 直改散文规格文档

- **状态**：Accepted
- **日期**：2026-07-25
- **决策者**：JJNNReno（经 `/grilling` 会话共同得出）
- **修订**：[ADR-0010](0010-local-master-is-user-integration-zone.md)（窄例外）

## 背景

ADR-0010 规定本地 `master` 是用户集成区，Agent 写入必须进 task worktree，由 `block-master-edit.sh` 在 Edit/Write 层硬拦 master。

实际工作暴露一个失败模式：Agent 在工单分支写规格文档（CONTEXT.md / ADR / docs），分支忘记合入本地 master；下个 task worktree 从本地 master 的 SHA 切出，看不到那份文档 → 关键决策与规格约束丢失 → 后续模型执行偏差。根因不是「写错了 doc」，而是「doc 困在未合并分支」。

## 决策

给 ADR-0010 开一个**窄例外**：AI 可以在本地 master 直接 Edit/Write **散文规格文档**，无需开 task worktree。

白名单（与 `block-master-edit.sh`、`scripts/commit-spec-on-master.sh` 保持一致）：

- 根 `CONTEXT.md`（领域语言权威源）
- `docs/**/*.md`（纯记录散文：ADR、agent 配置、研究、规范说明等）

落盘入口：`scripts/commit-spec-on-master.sh -m "<描述>"`。它校验当前在 master、工作区改动全在白名单内，以 `docs:` 前缀 commit；**不 push、不开 PR**。远程同步搭现有发布流程的车（`publish-review-package.sh`）。

## 不在例外内（仍必须走 task worktree）

- `.claude/` 全部——hooks、settings、rules、`CLAUDE.md`：**规则源**。让 AI 在 master 直改这些 = 让 AI 改自己的护栏（self-dealing）。
- `scripts/`、所有代码（`*.py` `*.ts` `*.java` 等）：改行为。
- `docs/**/*.json`（schema 契约、测试夹具）、`docs/**/*.pdf`：虽在 `docs/` 下，但不是散文，改了 = 改契约 / 行为。

## 威胁模型边界

本白名单**只防意外漂移，不防对抗性 AI**。护栏基于 `file_path` 字符串匹配，不解析符号链接目标，存在以下已知边界（有意接受）：

- **符号链接绕过**：若 `docs/foo.md` 是指向 `src/a.py` 或 `.claude/` 的符号链接，hook 只解析父目录（`docs` 是真目录）放行；后续 OS 跟随 symlink 写入目标。需 AI 先创建恶意 symlink，属对抗行为，out of scope。
- **`git mv` / raw git 绕过**：AI 经 Bash 跑 `git mv`、`git commit` 等不经过 Edit/Write 的操作不在本 hook 覆盖面（`commit-spec-on-master.sh` 用 `--no-renames` 兜底 rename 这一种，其余 raw git 仍可绕过）。
- **Bash 直写**：AI 经 Bash（`echo > src/a.py`、`tee` 等）改文件不触发 Edit/Write hook。

护栏目标是防止 AI **意外**把约束文档困在分支或误改 master 代码，不是阻止决心要绕过的 AI。对抗场景由发布授权门（红线 #1 / #2）和审计日志兜底。

## 后果

- 正向：散文规格文档始终在本地 master 同步；下个 task worktree 切出即可见；消除「忘合并分支 → 约束丢失」。
- 让渡：AI 能在 master 写入（限散文）。风险由白名单边界 + 脚本范围校验兜住：规则源 / hooks / scripts / 代码 / 契约仍硬拦；脚本拒绝混入非白名单改动。
- 本地 master commit 不是发布；推送 / PR / 合并仍受红线 #1 / #2 和现有授权门约束。
- 三端（Claude Code / ZCode / Codex）复用同一份 `block-master-edit.sh`，白名单一处生效；Codex 经 `run-claude-pretool.sh` wrapper 的 `apply_patch → file_path` 适配同样生效。

## 时序自洽

本决策的落地工单改的是 `block-master-edit.sh`（非 doc），必须走 task worktree（旧规则下 doc 仍不能直改 master）。工单合入本地 master 后，本例外才生效。不构成递归矛盾。

## 验收

合并后：① AI Edit `CONTEXT.md` → 放行；② `commit-spec-on-master.sh` 落本地 master；③ AI Edit 代码 / `.claude/` → 仍硬拦；④ `check-hook-contracts.py` 绿；⑤ `test-hooks.sh` 含 doc 白名单黑盒夹具通过。
