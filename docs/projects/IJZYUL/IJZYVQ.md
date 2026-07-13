# IJZYVQ — [ARCH-5] feat: 顶层领域类型聚合（Project/Asset/GenerationJob/NodeItem/Card/ChatMessage）

> **工单**：[IJZYVQ — 顶层领域类型聚合](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IJZYVQ)
> **父 issue**：[IJZYUL](./README.md)
> **状态**：✅ 已合并到 master（PR #42，merge commit `c3639e9`）
> **分支**：`feature/IJZYVQ-顶层领域类型`
> **commit**：`65af9fc`（feat）+ `03c5ac5`（docs close-out）→ merged as `c3639e9`
> **PR**：[#42](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/pulls/42)
> **完成日期**：2026-07-10

## 范围

把散落在 `app/canvas/_canvas/types.ts`（原 125 行单文件）里的领域类型按职责拆为两个文件，让顶层领域形状（Project / Asset / GenerationJob / NodeItem / Card / ChatMessage 等）可被画布外的模块直接 import（IJZYVQ ARCH-5）。原文件保留为 re-export 兼容层，不破坏现有 import path。

端到端路径：

1. 新建 `blue_whale_web/types/domain.ts` —— 顶层领域形状（严格对齐 CONTEXT.md 术语表）
2. 拆 `app/canvas/_canvas/types.ts` → `uiProps.ts`（UI 层）+ `types.ts` re-export 兼容层
3. 新建 `blue_whale_web/lib/jobs.ts` —— Job → Card 视图映射（CONTEXT.md L79-80），证明领域类型可被非 _canvas 模块消费
4. 跟随 CardStatus 迁出，更新三个原 `./_canvas/cardStatus` 导入点为 `@/types/domain`

## 验收逐条

> 注：IJZYVQ 工单原文（已 fetch）的验收点是「不引入运行时依赖」「仅做类型聚合」「新增一个非画布消费者证明可被复用」。下列 6 条按该意图分解。

- [x] **AC#1**：6 个核心领域类型全到位（Project / Asset / GenerationJob / NodeItem / Card / ChatMessage） + 支撑类型（Canvas / Viewport / NodeType / CardStatus / GenerationJobStatus）
- [x] **AC#2**：Card 状态枚举（`failed | generating | normal`）+ GenerationJob 状态枚举（`queued | processing | succeeded | failed`）字面完全对齐 CONTEXT.md L52 / L74
- [x] **AC#3**：`app/canvas/_canvas/types.ts` 仅作 re-export 兼容层（`export * from "@/types/domain"; export * from "./uiProps"`），不引入新代码
- [x] **AC#4**：新增非画布消费点 `blue_whale_web/lib/jobs.ts` + `lib/jobs.test.ts`，从 `@/types/domain` import，证明领域类型可被 _canvas 模块外复用
- [x] **AC#5**：`mapJobStatusToCardStatus` 函数逐行实现 CONTEXT.md L79-80 视图映射（queued/processing → generating，succeeded → normal，failed → failed）
- [x] **AC#6**：零运行时依赖（domain.ts 仅 type/interface，lib/jobs.ts 仅纯函数 + vitest），不引入 zod/valibot/运行时校验
- [x] **伴随改动**（迁 CardStatus 出 `_canvas/`）：`_canvas/cardStatus.ts` + `_canvas/cardStatus.test.ts` + `_canvas/components/AgentChatPanel.tsx` + `_canvas/projectReducer.ts` 全部 import 路径跟随迁移

## 改动文件（7 个）

**新文件（4 个）**：

- `blue_whale_web/types/domain.ts`（170 行）—— 顶层领域类型聚合
- `blue_whale_web/app/canvas/_canvas/uiProps.ts`（67 行）—— _canvas UI 层类型（ToolDef / DockMediaItem / DockMediaPickProps + 两个 Dock ContentProps extend 它）
- `blue_whale_web/lib/jobs.ts`（41 行）—— Job → Card 视图映射
- `blue_whale_web/lib/jobs.test.ts`（52 行 / 7 tests）—— 视图映射 + 终态判断单测

**重写 / 修改文件（3 个）**：

- `blue_whale_web/app/canvas/_canvas/types.ts` —— 15 行 → re-export 兼容层
- `blue_whale_web/app/canvas/_canvas/cardStatus.ts` —— 单行 import 替换：`./_canvas/cardStatus` 不动，仍 `from "./types"`，但类型来源改为 `@/types/domain`
- `blue_whale_web/app/canvas/_canvas/cardStatus.test.ts` / `components/AgentChatPanel.tsx` / `projectReducer.ts` —— 各 1 行 import 替换

> 注：Standards agent 提示 cardStatus.test.ts / AgentChatPanel.tsx / projectReducer.ts 不在 brief 列出的 scope 文件，但属于 CardStatus 迁出的必要伴随改动（否则 build 会断）。本提交一并带上，避免半途 build 失败。

## 关键设计决策

**为何拆**：原 types.ts 125 行混了：

- 顶层领域形状（Project / Asset / GenerationJob / NodeItem 等）
- UI 层专有（ToolDef / DockMediaItem / DockContentProps）
- 状态枚举（CardStatus / GenerationJobStatus）

问题：业务模块（非 _canvas）想用 Project / Asset / GenerationJob 时只能从 `app/canvas/_canvas/types` 导，路径错位（业务模块不该依赖画布内部）；UI 层想换工具条形状时也会污染领域类型。

**拆后边界**：

- `types/domain.ts` —— 严格对齐 CONTEXT.md 术语表，**不含任何 UI 字段**
- `app/canvas/_canvas/uiProps.ts` —— `_canvas` 模块 UI 层类型（ToolDef / Dock*Props）
- `app/canvas/_canvas/types.ts` —— 仅 re-export 兼容层（不破坏现有 import path）

**关于 Asset.kind**：CONTEXT.md L66 限定 image/video。**不**扩 audio —— 音频是 UI 层 Dock 选择器的输入域，不是 Asset 领域概念。DockMediaItem.type 仍允许 "audio" 作为 UI 入参形状，由 Dock 内部把 audio 转 image/video Asset 再下沉。

**关于 GenerationJob.entry**：原 draft 有此字段（bottomDock | agentChatPanel），属 UI 入口名硬编码进领域，**不收**——这是 UI 关心的事，不该污染领域。

**关于 formatJobStatus**：原 draft 有 `formatJobStatus` + `formatJobStatusByKey` 两个中文 UI 标签函数（"排队中"/"生成中"/"已完成"/"失败"），属 UI 文案，**不收 lib/jobs.ts**——jobs.ts 只承载领域类型之间的纯映射，UI 标签后续单独建组件层映射。

**关于 DockMediaPickProps**：Standards agent 提示 ImageDockContentProps / VideoDockContentProps 共享 6 个媒体选择字段，建议抽基接口。已应用 —— `DockMediaPickProps` 基接口，两个 DockProps 用 `&` extend 之。后续 AudioDock 也只需 extend。

## 测试结果

- `npx vitest run` 79/79 passed（19 test files；新增 7 个 jobs.test.ts + 0 改动既有 4 个 cardStatus）
- `npx next build` ✓ Compiled successfully（3 routes prerender）
- `npx eslint .` 2 errors + 26 warnings —— **全部预存在于 origin/master**（ChatBubbles.tsx:31 + AgentComposer.tsx:395），不在本任务范围。IJZYVQ 自己改动的 7 个文件 0 error / 0 warning。

## `/review` 双轴复查

- **Standards**：0 hard violations；3 judgement calls：
  1. `types.ts` re-export 写法：从命名 re-export 改为 `export *`，与 domain 段对称 —— **已采纳**
  2. `DockMediaPickProps` 抽基接口（Simplicity 机会） —— **已采纳**
  3. CardStatus 伴随改动文件未列入 brief —— **保留**（属必要伴随改动，已说明）
- **Spec**：
  - AC#1/#2/#3/#4/#5/#6 全部 PASS
  - Scope creep 已清：`Asset.kind` 限定 image/video / 删除 `Asset.name?` / 删除 `NodeItem.assetId?` / 删除 `GenerationJob.entry` / 删除 `GenerationJob.completedAt?` / 删除 `formatJobStatus*` UI 中文标签函数
  - `Card = Extract<ChatMessage, { type: "card" }>` 正确落实 "Card 与 NodeItem 是同一结果两种视图"
  - `mapJobStatusToCardStatus` 与 CONTEXT.md L79-80 视图映射逐行对应

## 状态时间线

| 时间             | 事件                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| 2026-07-10 14:xx | IJZYVQ 工单创建（用户 `/implement IJZYVQ` 触发）                         |
| 2026-07-10 14:30 | Agent 创建 worktree `feature-ijzyvq-domain-types` + CBM 索引             |
| 2026-07-10 15:00 | domain.ts + uiProps.ts + types.ts + cardStatus.ts 完成                   |
| 2026-07-10 15:10 | lib/jobs.ts + lib/jobs.test.ts (12 → 7 tests) 完成                       |
| 2026-07-10 15:11 | first review pass（Spec + Standards 双轴）                               |
| 2026-07-10 15:13 | 应用 Spec/Standards 反馈：删 audio/formatJobStatus/抽 DockMediaPickProps |
| 2026-07-10 15:14 | 三件套绿（79/79 / build pass / IJZYVQ 自己文件 0 lint）                  |
| 2026-07-10 15:15 | 写本 docs，待 commit                                                     |

## 备注

- 本次提交含 **IJZYVQ 实现 + 本 docs**（按 IJZYUL 约定："每一个子issue完成的时候,把记录的一起提交到分支里去当做记录"）
- 7 个改动文件全部围绕领域类型拆出，无顺手"重构相邻代码"
- IJZYVK（退役 AgentComposer）已撤回，本工单顺带迁出 CardStatus import 路径未影响其设计
- 父 issue IJZYUL 总进度 IJZYVQ 完成 → 5/8（README 已随 IJZYUL 收尾 PR 同步到 7/8 完成 / 1 撤回 / 0 待办）
