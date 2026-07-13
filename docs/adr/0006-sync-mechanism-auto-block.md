# ADR-0006：同步机制 = 自动阻断（不自动同步）—— pre-commit 软提醒 + pre-push 硬拦

- **状态**：Accepted
- **日期**：2026-07-05
- **决策者**：JJNNReno（与 Claude Code 经 `/grill-with-docs` 会话共同得出）
- **更新**：2026-07-12，开工同步由 [ADR-0010](0010-local-master-is-user-integration-zone.md) 的唯一 Work Tree 入口完成；发布前被阻断后的显式恢复由 [ADR-0013](0013-open-pr-update-state-machine.md) 定义。本文保留提醒与阻断策略。

## 背景

[ADR-0003](0003-no-direct-push-to-master.md) 确立「禁直推 master、合并只在 Gitee 服务端」，[ADR-0004](0004-branch-naming.md) 确立分支命名白名单。两者定了**合并的入口与命名**，但留一个机制问题：

> 远程 master 小时级有新合并。本地基于旧 master 建的工单分支，**不会自动跟随** master。同步（fetch + rebase）若靠人/AI 记忆执行，会忘——忘到 push 时才发现落后几十个提交，rebase 冲突爆炸。

现状（决策前）：

- `pre-push` hook 已硬拦「落后工单分支 push」（出口铁闸，已实现）。
- `pre-commit` hook **无**落后检测——commit 时不知道自己落后，一路攒到 push 才暴露。

核心疑问（会话来源）：同步该靠**人手动**还是**机器自动**？「自动」在 git 工作流里能落地成什么形态？

## 决策

### 根本上限（贯穿全部决策）

**rebase 的冲突解决不可全自动。** 冲突是语义判断（队友改了这段、我也改了，留谁的），机器自动合并 = 默默选一边 = 引入静默错误。git 故意不提供「自动解冲突」。机器能做的是**保证你不能跳过同步**，不是**替你解决冲突**。

### D1. 先建分支，后写代码（非先改再开分支）

Agent 写入任务前，通过唯一入口同步干净的本地 `master` 与 `origin/master`，再从同步后的精确 SHA 创建工单分支。用户可以在本地 `master` 工作区开发、commit、整理；Agent 不把本地 `master` 当任务写入区。

理由：Agent 任务区需要可重复、可隔离的基线，同时团队本地模块化开发要求保留尚未推送的本地提交。并行任务的开工流程见 [`docs/agents/worktree-workflow.md`](../agents/worktree-workflow.md)。

### D2. 同步 = 自动阻断（B），非自动同步（A）

| 形态 | 行为 | 判定 |
|---|---|---|
| **A 自动同步** | 机器替你 fetch + rebase，撞冲突机器自解 | **否决**。冲突语义判断机器做不了，自动合 = 默默选边 = 「乱掉」真发生。 |
| **B 自动阻断** ✅ | Hook/入口检测落后并停止；Agent 依据规则显式调用同步入口，冲突不自动选边 | 采纳。机器保证「跳不过同步」，标准入口只负责可恢复 rebase/abort，不替人解决语义冲突。 |

### D3. pre-commit 落后检测 = 软提醒（不硬拦）

`pre-commit` 每次 commit 静默 `fetch`，工单分支落后 `origin/master` 时 `echo` 提示「⚠️ 落后 N 提交」，**不拦 commit**。

理由：

1. **职责分层**：pre-commit 管「commit 本身合不合规」（生成物、前后端契约——拦）；pre-push 管「能不能上远程」（落后——铁闸）。两层不重叠。
2. **commit 是存档行为**，不该被远程状态打断。落后状态不影响 commit 本身正确性。
3. **一致性**：与 pre-commit 现有的 `npm run lint`（前端 `blue_whale_web`）/ `mvn test`（后端 `blue_whale_server`）同档，皆软提醒。
4. 铁闸在 pre-push，软提醒漏掉不会事故。

### D4. pre-push 硬拦（出口铁闸，已实现）

`pre-push` 每次 push 自动 `fetch`，工单分支落后 `origin/master` → `exit 1` 拦截，提示先 rebase。已实现于 `.githooks/pre-push`。

阻断后不是让 Hook 自动 rebase，也不是让 Agent临场选择 merge。Agent 依据 `CLAUDE.md` 主动运行 `scripts/sync-task-from-origin.sh sync --json`；入口在显式调用内建立恢复点、执行 rebase、冲突自动 abort。正常恢复状态机见 [ADR-0013](0013-open-pr-update-state-machine.md)。

### D5. 不加 escalation（纯两层）

软提醒被忽略时，**不**加「连续 N 次落后硬拦」或「落后超阈值硬拦」的升级机制。

理由：

1. escalation 优化「冲突颗粒度」，非「防事故」。事故已被 pre-push 防住。
2. 引入阈值/状态 = 复杂度，违背 simplicity（`CLAUDE.md`「Simplicity First」）。
3. AI 场景软提醒不会被无限忽略（AI 读提示即 act）；持续忽略的根因是流程执行不力，该修 CLAUDE.md，非加 hook。
4. 阈值是拍脑袋数，为低频极端场景加常态复杂度，不值。

## 考虑过的备选

- **A（自动同步）**：机器自动 rebase 解冲突。否决——见 D2，引入静默错误。
- **pre-commit 硬拦落后**：否决——见 D3，commit 存档不该被远程状态打断，且铁闸已在 pre-push。
- **escalation（忽略次数 / 落后幅度硬拦）**：否决——见 D5，复杂度不值。

## 后果

- **正面**：同步机制化（不靠记忆）——三层防线 `AI 指令（前置）+ pre-commit 软提醒（早冒信号）+ pre-push 硬拦（不可跳过）`。冲突早冒、小颗粒。文档（README/CLAUDE.md/commit-and-review）与 hook 代码一致。
- **职责不变**：文档驱动 Agent 主动调用标准同步入口；Hook 只提醒/阻断，不推进正常流程。
- **负面 / 代价**：
  - 每次 commit 多一次 `git fetch origin master`（静默、秒级、失败放行），轻微延迟。
  - 软提醒可能被忽略——由 pre-push 铁闸兜底，不会事故。
  - 冲突解决仍须人/AI 介入（机器不替你解）。

## 参考

- 会话来源：`/grill-with-docs` 决策树（D1–D5）
- 上游决策：[ADR-0003](0003-no-direct-push-to-master.md)（禁直推 master）、[ADR-0004](0004-branch-naming.md)（分支命名）
- 规则源：`README.md` §1「工作流」、`CLAUDE.md`「提交与审查·远程-本地同步」、[docs/agents/commit-and-review.md](../agents/commit-and-review.md)「Hook 兜底清单」
- 代码实现：`.githooks/pre-commit`（软提醒）、`.githooks/pre-push`（硬拦）
- 恢复状态机：[ADR-0013](0013-open-pr-update-state-machine.md)、`scripts/sync-task-from-origin.py`
