# ADR-0006：同步机制 = 自动阻断（不自动同步）—— pre-commit 软提醒 + pre-push 硬拦

- **状态**：Superseded（历史决策保留）
- **日期**：2026-07-05
- **决策者**：JJNNReno（与 Claude Code 经 `/grill-with-docs` 会话共同得出）
- **更新**：2026-07-12，开工同步由 [ADR-0010](0010-local-master-is-user-integration-zone.md) 的唯一 Work Tree 入口完成；发布前被阻断后的显式恢复由 [ADR-0013](0013-open-pr-update-state-machine.md) 定义。
- **替代**：2026-08-11，任务分支日常 push 不再因落后 `origin/master` 被阻断；同步硬门槛后移到创建/更新 PR 前，由 `scripts/publish-review-package.sh` 按实际目标分支校验并指向 `scripts/sync-task-from-origin.sh`。本文关于 pre-push 落后硬拦的 D2、D4 及相关后果仅作为历史记录，不再是现行规则。

> **现行规则**：普通任务分支落后仍可 push；创建/更新 PR 前必须包含实际目标基线。权威流程见 [`docs/agents/git-workflow.md`](../agents/git-workflow.md)，验证策略见 [`docs/agents/testing-strategy.md`](../agents/testing-strategy.md)。

## 背景

[ADR-0003](0003-no-direct-push-to-master.md) 确立「禁直推 master、合并只在 Gitee 服务端」，[ADR-0004](0004-branch-naming.md) 确立分支命名白名单。两者定了**合并的入口与命名**，但留一个机制问题：

> 远程 master 小时级有新合并。本地基于旧 master 建的工单分支，**不会自动跟随** master。同步（fetch + rebase）若靠人/AI 记忆执行，会忘——忘到 push 时才发现落后几十个提交，rebase 冲突爆炸。

现状（决策前，历史）：

- `pre-push` hook 当时已硬拦「落后工单分支 push」（出口铁闸）；该行为已于 2026-08-11 移除。
- `pre-commit` hook **无**落后检测——commit 时不知道自己落后，一路攒到 push 才暴露。

核心疑问（会话来源）：同步该靠**人手动**还是**机器自动**？「自动」在 git 工作流里能落地成什么形态？

## 决策

### 根本上限（贯穿全部决策）

**rebase 的冲突解决不可全自动。** 冲突是语义判断（队友改了这段、我也改了，留谁的），机器自动合并 = 默默选一边 = 引入静默错误。git 故意不提供「自动解冲突」。机器能做的是**保证你不能跳过同步**，不是**替你解决冲突**。

### D1. 先建分支，后写代码（非先改再开分支）

Agent 写入任务前，通过唯一入口同步干净的本地 `master` 与 `origin/master`，再从同步后的精确 SHA 创建工单分支。用户可以在本地 `master` 工作区开发、commit、整理；Agent 不把本地 `master` 当任务写入区。

理由：Agent 任务区需要可重复、可隔离的基线，同时团队本地模块化开发要求保留尚未推送的本地提交。并行任务的开工流程见 [`docs/agents/worktree-workflow.md`](../agents/worktree-workflow.md)。

### D2. 同步 = 自动阻断（B），非自动同步（A）（已被替代）

| 形态 | 行为 | 判定 |
|---|---|---|
| **A 自动同步** | 机器替你 fetch + rebase，撞冲突机器自解 | **否决**。冲突语义判断机器做不了，自动合 = 默默选边 = 「乱掉」真发生。 |
| **B 自动阻断** ✅ | Hook/入口检测落后并停止；Agent 依据规则显式调用同步入口，冲突不自动选边 | 当时采纳。2026-08-11 后仅在创建/更新 PR 的发布入口阻断，普通 push 不阻断；标准同步入口仍只负责可恢复 rebase/abort，不替人解决语义冲突。 |

### D3. pre-commit 落后检测 = 软提醒（不硬拦）

`pre-commit` 每次 commit 静默 `fetch`，工单分支落后 `origin/master` 时 `echo` 提示「⚠️ 落后 N 提交」，**不拦 commit**。

理由：

1. **历史职责分层**：当时 pre-commit 管「commit 本身合不合规」，pre-push 管「能不能上远程」（落后——铁闸）。现行职责调整为 pre-push 只守保护分支与分支命名，PR 发布入口负责目标基线铁闸。
2. **commit 是存档行为**，不该被远程状态打断。落后状态不影响 commit 本身正确性。
3. **一致性**：与 pre-commit 现有的 `npm run lint`（前端 `blue_whale_web`）/ `mvn test`（后端 `blue_whale_server`）同档，皆软提醒。
4. 当时铁闸在 pre-push；现行铁闸已后移到创建/更新 PR 前，软提醒漏掉不会绕过发布门禁。

### D4. pre-push 硬拦（已被替代）

历史行为：`pre-push` 每次 push 自动 `fetch`，工单分支落后 `origin/master` → `exit 1` 拦截，提示先 rebase。

现行行为：`.githooks/pre-push` 只阻断直推 `master/main` 和首次 push 的不合规分支名；普通任务分支落后仍可 push。创建/更新 PR 前，`scripts/publish-review-package.sh` fetch 实际目标分支并校验任务 HEAD 是否包含该基线，不满足则返回 `NEEDS_SYNC`，由 Agent 显式运行同步入口。

阻断后不是让 Hook 自动 rebase，也不是让 Agent临场选择 merge。Agent 依据 `CLAUDE.md` 主动运行 `scripts/sync-task-from-origin.sh sync --json`；入口在显式调用内建立恢复点、执行 rebase、冲突自动 abort。正常恢复状态机见 [ADR-0013](0013-open-pr-update-state-machine.md)。

### D5. 不加 escalation（纯两层）

软提醒被忽略时，**不**加「连续 N 次落后硬拦」或「落后超阈值硬拦」的升级机制。现行策略同样不在日常 push 增加 escalation。

理由：

1. escalation 优化「冲突颗粒度」，非「防事故」。历史上由 pre-push 防住；现行由 PR 发布门禁防住。
2. 引入阈值/状态 = 复杂度，违背 simplicity（`CLAUDE.md`「Simplicity First」）。
3. 持续忽略提醒不应靠日常 push 阻断治理；发布入口会在真正需要同步的 PR 节点给出确定纠偏。
4. 阈值是拍脑袋数，为低频极端场景加常态复杂度，不值。

## 考虑过的备选

- **A（自动同步）**：机器自动 rebase 解冲突。否决——见 D2，引入静默错误。
- **pre-commit 硬拦落后**：否决——见 D3，commit 存档不该被远程状态打断；现行铁闸位于 PR 发布入口。
- **escalation（忽略次数 / 落后幅度硬拦）**：否决——见 D5，复杂度不值。

## 后果

- **历史正面**：同步机制化（不靠记忆）。当时采用 `AI 指令 + pre-commit 软提醒 + pre-push 硬拦`；现行采用 `AI 指令 + 可选软提醒 + PR 发布入口硬校验`，避免日常协作 push 被远端基线打断。
- **职责不变**：文档驱动 Agent 主动调用标准同步入口；Hook 只提醒/阻断，不推进正常流程。
- **负面 / 代价**：
  - 每次 commit 多一次 `git fetch origin master`（静默、秒级、失败放行），轻微延迟。
  - 软提醒可能被忽略——由 PR 发布门禁兜底，不会绕过合并前同步。
  - 冲突解决仍须人/AI 介入（机器不替你解）。

## 参考

- 会话来源：`/grill-with-docs` 决策树（D1–D5）
- 上游决策：[ADR-0003](0003-no-direct-push-to-master.md)（禁直推 master）、[ADR-0004](0004-branch-naming.md)（分支命名）
- 规则源：`README.md` §1「工作流」、`CLAUDE.md`「提交与审查·远程-本地同步」、[docs/agents/commit-and-review.md](../agents/commit-and-review.md)「Hook 兜底清单」
- 代码实现：`.githooks/pre-commit`（软提醒）、`.githooks/pre-push`（保护分支与分支命名）、`scripts/publish-review-package.sh`（PR 前目标基线硬校验）
- 恢复状态机：[ADR-0013](0013-open-pr-update-state-machine.md)、`scripts/sync-task-from-origin.py`
