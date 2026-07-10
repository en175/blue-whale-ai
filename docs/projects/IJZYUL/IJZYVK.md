# IJZYVK — [ARCH-3] refactor: 退役 AgentComposer 历史包袱

> **工单**：[IJZYVK — 退役 AgentComposer 历史包袱](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IJZYVK)
> **父 issue**：[IJZYUL](./README.md)
> **状态**：❌ 已撤回（wontfix）
> **Gitee Issue 状态**：closed，label=`wontfix`
> **Gitee 关闭时间**：2026-07-10

## 范围（最初提案）

退役已被 AgentChatPanel 取代的历史组件 `components/AgentComposer.tsx`（78KB）。按 `CONTEXT.md` 领域术语表，**AgentComposer 是废弃术语**，Canvas 已用 AgentChatPanel。当前组件文件疑似残留，需清退。

端到端路径：grep 全仓引用 → 替换残留引用 → 删除文件 → 验证首页与 `/canvas` 行为不变。

## 撤回原因

**完整撤回 IJZYVK**：

1. **本地集成测试发现 `app/page.tsx` 首页仍引用 AgentComposer**：原 IJZYUL 父 issue 背景判断"已用 AgentChatPanel 取代"不完整；首页（`/` 路由）的 PromoCapsule + QuickTags + TemplateCards 三大区块仍由 AgentComposer 渲染，AgentChatPanel 不覆盖首页结构
2. **重构风险溢出**：删除 AgentComposer 会迫使首页 `app/page.tsx` 重写，超出原 issue acceptance "退役" 范围（属于「重构首页」而非「清退组件」）
3. **术语表约束反向**：CONTEXT.md 虽标注 AgentComposer 为废弃术语，但代码实际依赖未完成迁移；强制退役会引入行为变更而非纯删除

## 撤回流程（2026-07-10）

1. Agent 完成 IJZYVK 实现：
   - worktree `feature/ijzyvk-retire-agent-composer`
   - 删除 `components/AgentComposer.tsx`
   - 替换首页 import
   - 创建 PR #39
2. 用户在 PR review 阶段要求"将 AgentComposer 放回来"
3. 完整撤回流程：
   - git 撤回 IJZYVK 分支（git reset --hard 到 IJZYVK 之前的本地 master）
   - 手动到 Gitee 网页删除远程 source branch `feature/ijzyvk-retire-agent-composer`
   - `mcp__gitee__update_issue` 关 IJZYVK 工单 + 打 `wontfix` 标签
4. IJZYVK 状态变为 wontfix，不在主流程阻塞后续子 issue

## 后续建议

- **新子 issue（待开）**：在 IJZYUL 之外另开 `首页迁移至 AgentChatPanel` 工单，作为 IJZYVK 的替代切片
- 关键词：迁移 `app/page.tsx` 从 AgentComposer 到 AgentChatPanel 路由结构

## 教训

- 「退役」类 issue 触发前需全仓 grep import 站点 + 跑动静态分析，**不能仅凭术语表判断组件未用**
- 父 issue 描述的"背景"如果是人工判断，必须验证一次再开子 issue
- "顺手重构相邻代码" 边界：IJZYVK 的 acceptance 之一是"如首页也在迁移范围内，一并替换"——这条留下伏笔导致 review 阶段认知不一致

## 状态时间线

| 时间 | 事件 |
|---|---|
| 2026-07-09 17:20 | IJZYVK 工单创建，label=`ready-for-agent` |
| 2026-07-10 09:30 (估计) | Agent 在 worktree 完成 IJZYVK 实现 + commit |
| 2026-07-10 (上午) | PR #39 创建 |
| 2026-07-10 (中午前) | 用户要求"将 AgentComposer 放回来" |
| 2026-07-10 10:56 | Gitee Issue state=closed，label=wontfix |