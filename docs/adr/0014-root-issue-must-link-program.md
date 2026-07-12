# ADR-0014：根 issue 必须归属项目（program_id 非空且非 0）—— hook 硬拦

- **状态**：Accepted
- **日期**：2026-07-12
- **决策者**：KimJohn（Issue IK0FRR）

## 背景

事件：根 issue **IK0FL6** / **IK0FL7** 创建后仅仓库 Issues 页可见，企业工作台「项目管理（Blue-Whale-AI）」找不到。排查：两工作项 `program_id=0`。本仓 54 个工作项中 39 个 `program_id=0`，游离于项目管理之外。

根因：[`docs/agents/issue-tracker.md`](../agents/issue-tracker.md) 创建约定只要求传 `project_id`（仓库维度），`block-issue-without-repo.sh` 的根 issue 校验也**只查 `project_id`**，从未约束 `program_id`（项目维度）。子 issue 校验已含 `program_id`（[ADR-0008](0008-sub-issues-must-inherit-repo.md)），但根 issue 漏了。Agent/人照规范走，根 issue `program_id=0` 游离。

这是配置/流程缺陷，非 MCP bug。

## 决策

### 根本约束

**Blue-Whale 的所有根 Gitee issue 都归属于 Blue-Whale-AI 项目。** `program_id` 非空且非 0 是硬性要求，与 `project_id` 对称（[ADR-0007](0007-issue-must-link-repo.md)）。

### D1. 防御形态 = 规范前置 + Hook 兜底

延续 [ADR-0007](0007-issue-must-link-repo.md) D1 / [ADR-0008](0008-sub-issues-must-inherit-repo.md) D3 的范式：文档讲清规则，PreToolUse hook 拦「根 issue 缺 program_id」。纯文档（A）防不住自觉漏发；纯 hook（C）拦时操作者不知怎么改。

### D2. Hook 拦截策略 = 根 issue 缺 `program_id` 硬拦

`block-issue-without-repo.sh` 根 issue 创建校验从「只查 `project_id`」扩展为「`project_id` + `program_id` 都非空且非 0」。`program_id` 缺失 / 为空 / = 0 → `exit 2` 硬拦。

- 根 issue = 无 `parent_id` 的 `create_enterprise_issue`。
- 子 issue 的 `program_id` 校验已在 [ADR-0008](0008-sub-issues-must-inherit-repo.md) D3 覆盖，不重复。
- 任何显式 `program_id=0`（含 `update`）全局拦，对称 `project_id=0`（[ADR-0007](0007-issue-must-link-repo.md) D2）—— 防御 update 时显式清空项目归属。
- 普通 `update_enterprise_issue`（改标题/标签/状态）不要求重复传 `program_id`，避免误拦。

### D3. 只校验「非空且非 0」，不白名单 883843

hook 判断 `program_id` 是否**存在、非空、且 ≠ 0**，**不校验它是否等于 Blue-Whale-AI 项目 ID**（883843）。与 [ADR-0007](0007-issue-must-link-repo.md) D3 对 `project_id` 的处理完全对称：

1. 真故障是「传 0 或没传」，二者在 Gitee 端语义等价（都 = 无关联）。
2. 「传错值」是低频，根因是文档/记忆里 ID 错——hook 白名单同样来自文档，文档错则白名单跟着错，拦错放对。
3. 不硬编码 → 零维护，规避「将来项目重组要改 hook」的债。

> `program_id` 在 MCP schema 里是 **number**；hook 正则兼容 number（`883843` 无引号）与 string（`"883843"`）两种 JSON 形态（真实调用是 number，string 仅防御性兼容），与 `project_id` 一致。

### D4. program_id 的值从哪来 = 动态查，不写死文档

[`docs/agents/issue-tracker.md`](../agents/issue-tracker.md) 不硬编码 `883843`，写「项目 ID，用 `list_programs` 查」。对齐 [ADR-0007](0007-issue-must-link-repo.md) D5：文档不持有易腐的数字 ID，只持有获取方法。

## 考虑过的备选

- **A 仅文档兜底**：否决——见 D1，纯自觉防不住。
- **校验 `program_id == 883843`（写死白名单）**：否决——见 D3，防不住文档写错的根因，反成绊脚石。

## 后果

- **正面**：根 issue 创建即归属项目，企业「项目管理」不再漏工单；防御机制化（不靠记忆）；与 `project_id` 处理对称，hook 逻辑统一。
- **代价**：每次 `create_enterprise_issue` 根 issue 多一次 `program_id` 非零校验（纯 JSON 解析，毫秒级）。
- Codex 侧经 `.codex/hooks/run-claude-pretool.sh` shim 复用同一 `block-issue-without-repo.sh`，无需额外改（双平台自动覆盖）。

## 参考

- 触发事件：`IK0FL6` / `IK0FL7`（2026-07-12），追踪 issue `IK0FRR`
- 上游决策：[ADR-0007](0007-issue-must-link-repo.md)（project_id 必传）、[ADR-0008](0008-sub-issues-must-inherit-repo.md)（子 issue 继承 program_id）
- 规则源：[`docs/agents/issue-tracker.md`](../agents/issue-tracker.md) §「定位」/「操作约定」
- 代码实现：`.claude/hooks/block-issue-without-repo.sh`、`.claude/settings.json` + `.codex/hooks.json`（PreToolUse matcher）
- 测试：`scripts/test-hooks.sh` Slice 2
