# ADR-0025：文档白名单——AI 可在本地 master 直改散文规格文档

- **状态**：已被 [ADR-0115](0115-local-release-code-baseline.md) 替代。散文文档不再直写本地 master；以下保留历史决策记录。
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

## 修正一（2026-09-25）：落盘入口废止——散文文档改与代码同路

> 依 [ADR-0084](0084-generation-worker-java-runtime.md) 文末「修正」体例记录。本文上方标题、「决策」「威胁模型边界」「验收」等历史正文**保持原样不改写**——其中出现的 `scripts/commit-spec-on-master.sh` 提及（白名单一致性、落盘入口、`--no-renames` 兜底、验收步骤②）**均已随该入口废止而失效**，现状以本节为准。标题中「AI 可在本地 master 直改」与其「状态」字段的处置见本节末「待决」。

**触发**：`scripts/commit-spec-on-master.sh` 已于 **2026-09-10 废止为指路桩**（打印说明后 `exit 1`），而本 ADR 与多份规则源（`CLAUDE.md`、`docs/README.md`、`docs/agents/*.md`、`docs/skills/README.md`）仍在指向该命令——规则指一条必然失败的路，违背最高红线 8「文档驱动、Hook 兜底」。本次把落盘入口统一为现行路径。

**已钉实的事实**（如实记录，供后来者判断代价）：

- **废止动因**（桩头注释原文口径）：本地 master 直提与红线冲突——「PR 审合前不合入 master，本地集成区同理不提前吃未审内容」；且未推送的 master 直提会被开工入口的「本地领先保留」卷进后续任务分支，污染每个 PR（2026-09-09 实测两次）。
- **落盘通道断，但 Edit 白名单仍在**：`block-master-edit.sh` 对 master 上的 `CONTEXT.md` / `docs/*.md` 仍判 `allowed-doc-allowlist` 并放行。二者叠加**形成死结**：AI 可在本地 master 改文档（hook 放行）→ 无入口落盘 → 本地 master 不干净 → 开工入口直接拒绝（`start-task-worktree.py` 的 `git status --porcelain` 门：「本地 master 工作区不干净，不能同步或创建 Work Tree」）。这是本次把规则源口径改为「散文文档不得在 master 直改」的直接依据。
- 三个替代入口均已核实可用：`start-task-worktree.sh`（`ALLOWED_TYPES` 含 `docs`，支持 `--no-issue`）、`commit-task-for-review.sh -m`、`publish-review-package.sh --user-authorized --create-pr`（默认目标 master，允许 `--target-branch release/*`）。

**决策**

1. **散文文档落盘改为与代码同路**（三步）：`scripts/start-task-worktree.sh --type docs --no-issue --summary <6–15字中文简述>` → 工单分支内编辑后 `bash scripts/commit-task-for-review.sh -m "docs: <描述>"` → 用户授权后 `scripts/publish-review-package.sh --user-authorized --create-pr`。工程面 docs PR 直进 master，不经 release 批次。
2. **规则源同步收口**：`CLAUDE.md`（路由表、红线 4、写入前自检）与 `docs/README.md`、`docs/agents/{git-workflow,worktree-workflow,domain,commit-and-review}.md`、`docs/skills/README.md` 中「AI 可在本地 master 直改散文文档」的授权语句一并移除，改为上述三步。
3. **本文决策正文的存废不动**：白名单本身是否从 `block-master-edit.sh` 撤除，属 hook 层行为变更，**另行决策**——废止桩头注释亦明示「pre-commit 层硬拦另行决策，不在本通道范围」。在另行决策前，hook 白名单与规则源口径的这段残留窗口仍然存在（规则源更严，hook 更宽，符合「文档驱动、Hook 兜底」的分层）。

**后果**

- 原决策「doc 不困在未合并分支」的收益，改由「docs 同路 + PR 目标 master」承接；代价是散文文档也需一次 worktree + PR 往返。
- `docs/**/*.json` 契约、fixtures、`.claude/` 规则源、代码本就不在例外内，本次无变化。
- 人类若确需本地 master 直提（ADR-0010 的用户集成区语义），仍可自行标准 git commit，自担未推送提交被卷进任务分支的代价——这是**人**的通道，不是 Agent 的授权。

**待决（归决策者，本修正不代为拍板）**

本 ADR 的「状态」字段目前仍是 `Accepted`，而其唯一落盘入口已不存在；标题亦仍写「AI 可在本地 master 直改散文规格文档」。两个候选处置：

1. **标 `Superseded by ADR-0010`（或 `Superseded`）**：读者一眼看到本决策整体退场，不会误按标题行事。代价是 ADR-0025 的 hook 白名单事实上仍在生效（`allowed-doc-allowlist` 未撤），标 Superseded 会让「白名单还在」失去文档依据；且标题与状态不一致（标题说直改，状态说被取代）。
2. **保持 `Accepted` + 修正一段落说明入口废止（现状）**：与 ADR-0084「状态 Accepted 含修正 N」的既有体例一致，历史正文不动；代价是状态行需读者下翻到修正段才理解「入口已死」，标题仍有误导性。

若同时撤除 `block-master-edit.sh` 的 doc 白名单（另行决策），选项 1 的代价即消失——两项宜合并拍板。
