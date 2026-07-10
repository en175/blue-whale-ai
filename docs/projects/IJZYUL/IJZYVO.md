# IJZYVO — [ARCH-4] refactor: 拆 SkillPanel 巨型组件

> **工单**：[IJZYVO — 拆 SkillPanel 巨型组件](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IJZYVO)
> **父 issue**：[IJZYUL](./README.md)
> **状态**：✅ 已合并到 origin/master
> **分支**：`feature/IJZYVO-拆SkillPanel组件`
> **commit**：`fe2196c refactor: 拆 SkillPanel 巨型组件为 7 个子组件`
> **PR**：[#40](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/pulls/40)（KimJohn → master，merge commit `b5d438e`）
> **完成日期**：2026-07-10
> **Gitee Issue 状态**：closed（PR #40 合并后由用户手动关闭）

## 范围

拆分巨型组件 `components/SkillPanel.tsx`（60KB / 783 行），按子职责拆为多文件，主入口 ≤ 300 行。端到端路径：从 `/canvas` 触发 skills 面板 → 确认 UI 子区块独立 → 验证每个子组件功能完整 → 单元测试覆盖各子组件。

## 验收逐条

- [x] 主入口 `SkillPanel.tsx` ≤ 300 行（实测 131 行），仅做编排与状态聚合
- [x] 拆出至少 3 个独立子组件（实测 7 个），每个 ≤ 300 行（实测 20–115 行）：
  - `components/skill/data.ts`（361 行 — 数据层，单独允许略超）
  - `components/skill/SkillPanelHeader.tsx`（68 行）
  - `components/skill/MySkillCard.tsx`（71 行）
  - `components/skill/LibrarySkillCard.tsx`（75 行）
  - `components/skill/LibraryContent.tsx`（82 行）
  - `components/skill/CreateSkillContent.tsx`（115 行）
  - `components/skill/UseButton.tsx`（20 行 — 原子按钮）
  - `components/skill/MoreButton.tsx`（20 行 — 原子按钮）
- [x] 每个新子组件至少有 1 个 vitest 单元测试（用 `@testing-library/react`，参考已有 `components/auth/LoginModal.test.tsx` 写法）—— 实际 14 个新测试覆盖 7 个子组件
- [x] 手动打开 `/canvas` → 触发技能面板 → 滚动 / 选中 / 搜索等行为与拆分前完全一致（JSX 逐行对照原 SkillPanel.tsx，className / role / aria-* 完整保留）
- [x] 不改变 SkillPanel 对外 props 契约（`SkillPanelProps.isOpen / onClose / onUseSkill` 零变更，AgentChatPanel 调用点 diff = 0 行）
- [x] 拆分过程中不顺手"重构相邻代码"（CLAUDE.md 外科手术原则）—— diff 16 文件全部在 SkillPanel.tsx + 新 components/skill/ 目录

## 改动文件（16 个）

**实现文件（9 个）**：
- `blue_whale_web/components/SkillPanel.tsx` — 主入口（-698 / +24 → 131 行）
- `blue_whale_web/components/skill/data.ts` — 类型 + MY_SKILLS + LIBRARY_SKILLS + SKILL_MD_TEMPLATE
- `blue_whale_web/components/skill/SkillPanelHeader.tsx`
- `blue_whale_web/components/skill/MySkillCard.tsx`
- `blue_whale_web/components/skill/LibrarySkillCard.tsx`
- `blue_whale_web/components/skill/LibraryContent.tsx`
- `blue_whale_web/components/skill/CreateSkillContent.tsx`
- `blue_whale_web/components/skill/UseButton.tsx`
- `blue_whale_web/components/skill/MoreButton.tsx`

**测试文件（7 个）**：
- `blue_whale_web/components/skill/SkillPanelHeader.test.tsx`（2 tests）
- `blue_whale_web/components/skill/MySkillCard.test.tsx`（2 tests）
- `blue_whale_web/components/skill/LibrarySkillCard.test.tsx`（3 tests）
- `blue_whale_web/components/skill/LibraryContent.test.tsx`（2 tests）
- `blue_whale_web/components/skill/CreateSkillContent.test.tsx`（3 tests）
- `blue_whale_web/components/skill/UseButton.test.tsx`（1 test）
- `blue_whale_web/components/skill/MoreButton.test.tsx`（1 test）

## 关键设计决策

**为何拆**：原 SkillPanel.tsx 783 行单文件含 30+ MY_SKILLS 数据 + 6+ LIBRARY_SKILLS 数据 + SKILL_MD 模板 + 3 个 tab 渲染分支 + state 管理 + Escape 副作用。无法独立测试子行为，无法在不打开 60KB 文件的前提下复用子 UI 块。

**考虑过的替代方案**：
1. **保持单文件但抽 hook 抽数据** — 不解决"无法独立测子 UI"和"阅读体积"两个核心痛点，弃
2. **抽 3 个 tab 内容组件** — 但 30 个 MY_SKILLS 单卡在 my tab 里循环，每张卡样式高度重复；不抽卡则 LibraryContent 仍会是 200+ 行
3. **再细拆 MySkillCard 内子按钮为 UseButton / MoreButton 原子** — judgement call：UseButton 含 AtSign icon + 文字 + onClick，MoreButton 含 Ellipsis icon + aria-label；只用一次的 20 行原子块严格说可内联。保留原子化的理由：未来 MySkillCard / LibrarySkillCard 可能共用"直接使用"按钮；提前 20 行隔离避免后续开新卡时再来一次 inline-then-extract

**SkillTab 类型位置**：从 SkillPanelHeader.tsx 挪到 `data.ts`，因为 SkillPanel 主入口 + CreateSkillContent 都依赖此类型放最稳。

## 测试结果

- `npm run build` ✓ Compiled，3 routes prerender
- `npm run test` 72/72 passed（18 test files；原 58 + 新 14）
- `npm run lint` 0 issues

## `/review` 双轴复查

- **Standards**：0 hard violations；2 judgement calls（UseButton/MoreButton 原子抽象可考虑内联、tabBtn 函数可改为 map）—— 不阻塞
- **Spec**：6/6 PASS，0 scope creep

## 状态时间线

| 时间 | 事件 |
|---|---|
| 2026-07-09 17:20 | IJZYVO 工单创建，label=`ready-for-agent` |
| 2026-07-10 10:00 (估计) | Agent 创建 worktree + CBM 索引 |
| 2026-07-10 (中午前) | Agent 完成 7 子组件拆分 + 14 个测试 + 3 件套绿 |
| 2026-07-10 12:00 | commit `fe2196c` 到 feature/IJZYVO-拆SkillPanel组件 |
| 2026-07-10 12:01 | PR #40 创建，assignee=banfield |
| 2026-07-10 13:37 | Gitee Issue state=closed |
| 2026-07-10 (下午) | PR #40 合并到 origin/master（merge commit `b5d438e`） |

## 备注

- 本 PR 为纯前端 refactor，对外 props 契约零变，调用点 diff = 0
- 16 个变更文件全部在 SkillPanel.tsx 主入口 + 新 components/skill/ 子目录，未触及任何相邻代码（layout / page / 其他组件）
- SkillPanel 主入口文件从 60KB 缩到约 4KB，单文件可读性显著提升
- 远程 source branch `feature/IJZYVO-拆SkillPanel组件` 已在 origin/master 内，本地 worktree 待 cleanup