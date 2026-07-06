# ADR-0007：所有 Gitee issue 必须关联仓库（project_id 非空且非 0）—— hook 硬拦

- **状态**：Accepted
- **日期**：2026-07-06
- **决策者**：JJNNReno（与 Claude Code 经 `/grill-me` 会话共同得出）

## 背景

事件：issue **IJZ5WA**（PRD：blue_Whale 前端 MVP）创建后，在企业工作项列表可见，但**仓库 Issues 页（`gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues`）找不到**。

根因：该 issue 创建时 `project_id=0`（未关联任何仓库），飘在企业顶层。仓库 Issues 页只展示关联到该仓库（`project_id` 命中）的工单，故不可见。

为何没传 `project_id`：[`docs/agents/issue-tracker.md`](../agents/issue-tracker.md) 的「创建 issue」步骤只写了传 `enterprise_id` + `title/body/labels`，**规则从未要求传 `project_id`**。操作者（AI/人）照规则走，必然漏发。

> 订正注（2026-07-06，PR !13）：本段 `body/labels` 为当时的文档原文；issue-tracker.md 后已修正为 `description`/`label_ids`（MCP 实际入参）。本 ADR 的决策（必传 `project_id`）不受影响。

### 命名不一致（本 ADR 顺带修）

排查根因时发现：仓库内文档与 `.claude/settings.json` 全部用 MCP 前缀 `mcp__gitee__*`，但 `.mcp.json` 注册的 server 实际名为 `gitee-ent`，真实工具前缀是 `mcp__gitee-ent__*`。

后果：`.claude/hooks/block-squash-merge.sh` 的 PreToolUse matcher 写成 `mcp__gitee__merge_enterprise_pull`，**从未匹配到真实工具**（应为 `mcp__gitee-ent__merge_enterprise_pull`）。该「禁 squash/rebase 合并」铁闸一直是死代码，从未生效。本 ADR 配套 PR 一并修活。

## 决策

### 根本约束

**Blue-Whale 的所有 Gitee issue 都归属于 blue-whale-ai 仓库。** 不存在也不打算要「企业级、无仓库」工单（[`docs/agents/issue-tracker.md`](../agents/issue-tracker.md) §1「本仓库的 issue 和 PRD 存放在 Gitee 仓库的 Issues 中」）。故 `project_id` 非空且非 0 是硬性要求，非可选（`0` 是 Gitee 的「无关联」哨兵，见 D3）。

### D1. 防御形态 = 规范前置 + Hook 兜底（B）

| 形态 | 行为 | 判定 |
|---|---|---|
| **A 仅文档** | issue-tracker.md 补「必传 project_id」，靠人/AI 自觉 | **否决**。纯靠自觉，IJZ5WA 式漏发仍会发生。 |
| **B 文档 + Hook** ✅ | 文档讲清规则，PreToolUse hook 拦「缺 project_id」 | 采纳。对齐 [ADR-0006](0006-sync-mechanism-auto-block.md) 的「规范前置 → Hook 兜底」防御顺序。 |
| **C 仅 Hook** | 规则硬编码进 hook，不动文档 | 否决。hook 拦时操作者不知为何、不知怎么改。 |

理由：本仓 Gitee 协作哲学统一为「高频硬约束写文档 + Hook 兜底」（见 `CLAUDE.md`「Gitee 工作流」）。漏发仓库属高频操作失误，套这套范式。

### D2. Hook 拦截策略 = 缺 `project_id` 硬拦（A）

`project_id` 缺失 / 为空 / = 0 → `exit 2` 硬拦（铁闸）。三者语义等价（均 = 无关联）。

不采用「软提醒（exit 0 + 警告）」。理由：漏发后果（PRD 在仓库 Issues 页消失、团队找不到）严重程度不亚于「落后于 origin/master 的 push」，后者已被 pre-push 硬拦（[ADR-0006](0006-sync-mechanism-auto-block.md) D4），同等对待。

### D3. 只校验「非空且非 0」，不校验「值正确」

hook 判断 `project_id` 是否**存在、非空、且 ≠ 0**，**不校验它是否等于 blue-whale-ai 的 ID**。

> **number 语义修订（code review 发现）**：`project_id` 在 MCP schema 里是 **number** 类型，Gitee 用 **`0`** 表示「无关联」（正是 IJZ5WA 故障形态——`project_id:0`）。number 类型无「空字符串」概念，故「未关联」的哨兵值是 `0`，校验 `≠ 0` 不属于「校验值是否正确」范畴（那指的是校验是否等于某个具体仓库 ID），而是把 number 的「缺失哨兵」排除。同时 hook 正则须兼容 number（`48854568` 无引号）与 string（`"48854568"`）两种 JSON 形态——真实调用是 number，string 形态仅防御性兼容。

理由：

1. **真故障是「传 0 或没传」**（高频、已发生一次），二者在 Gitee 端语义等价（都解析为无关联）。校验「非空且非 0」精确命中。
2. **「传错值」是低频**，且其根因（文档/记忆里 ID 错）是校验具体值**无法**覆盖的——hook 的白名单同样来自文档，文档错则白名单跟着错，拦错放对。
3. 不硬编码具体值 → 单仓库/多仓库都成立，零维护（规避「将来拆多仓库要改 hook」的债）。

### D4. 错误信息 = 照 squash hook 范式，不写死 ID 值

hook 拦截时 stderr 输出 `BLOCKED:` + 根因 + 改法，指路 [`docs/agents/issue-tracker.md`](../agents/issue-tracker.md)。

错误信息**不写死** `project_id=48854568` 这个值，只说「project_id（值见 issue-tracker.md）」。理由：单一事实源在文档（文档持有「用 `list_enterprise_repositories` 查」的方法），hook 不持有 ID。详见 D5。

### D5. project_id 的值从哪来 = 动态查，不写死文档

[`docs/agents/issue-tracker.md`](../agents/issue-tracker.md) 不硬编码 `48854568`，写「blue-whale-ai 仓库的 ID，用 `mcp__gitee-ent__list_enterprise_repositories` 查」。

理由：文档不持有易腐的数字 ID，只持有获取方法。~~与既有 `enterprise_id` 硬编码不一致~~ 此前 `enterprise_id` 曾硬编码 `16660949`，与本决策不一致；该不一致已由 [issue IJZ6XD](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IJZ6XD) 统一为动态查（`enterprise_id` 也改用 `list_enterprises` 查，见 [`issue-tracker.md`](../agents/issue-tracker.md) §末段），取值方式现已全文一致。

## 考虑过的备选

- **A 仅文档兜底**：否决——见 D1，纯自觉防不住。
- **校验 `project_id == 48854568`（写死白名单）**：否决——见 D3，防不住文档写错的根因，反成绊脚石。
- **企业级工单逃生口（body 加 `no-repo` 标记放行）**：否决——YAGNI，尚不存在的需求不为它买单（`CLAUDE.md`「Simplicity First」）。

## 后果

- **正面**：issue 创建即关联仓库，仓库 Issues 页不再漏工单；防御机制化（不靠记忆）；顺带修活 squash 合并铁闸（死代码上线）。
- **负面 / 代价**：
  - 每次 `create_enterprise_issue` 调用多一次 hook 校验（纯 JSON 解析，毫秒级）。
  - ~~`enterprise_id`（硬编码）与 `project_id`（动态查）取值方式不一致——已知技术债，待后续统一。~~ 已由 [IJZ6XD](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IJZ6XD) 统一为动态查，技术债已还。
  - 将来若拆多仓库，hook 的「非空且非 0」语义仍成立，无需改；但文档需补多仓库 project_id 取值说明。

## 参考

- 会话来源：`/grill-me` 决策树（D1–D5）
- 上游决策：[ADR-0006](0006-sync-mechanism-auto-block.md)（防御顺序 = 规范前置 + Hook 兜底）
- 规则源：[`docs/agents/issue-tracker.md`](../agents/issue-tracker.md) §「约定（按操作）」、`CLAUDE.md`「Gitee 工作流」「Gitee Issue 与 MCP 工具」
- 代码实现：`.claude/hooks/block-issue-without-repo.sh`、`.claude/settings.json`（PreToolUse matcher）
- 触发事件：issue **IJZ5WA**（2026-07-06）
