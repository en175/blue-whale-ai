# Blue-Whale 前端

一个面向 AI Agent / Canvas 交互的纯客户端单页应用（SPA）。当前为纯前端 DEMO，
生成能力用 mock/临时方案，未对接后端。

## Language

**Canvas**:
应用的核心交互界面（工作台），承载素材节点编排、视口变换、Agent 创作。
路由 `app/canvas/`：`page.tsx` 为编排层，UI 实现在 `app/canvas/_canvas/` 子模块下。
_Avoid_: 画布（口语可用，文档中用 Canvas）、编辑器（指代不同概念）

**AgentChatPanel**:
Canvas 右侧的 Agent 对话面板（右侧对话区）。承载消息列表、输入器（Composer）、
技能面板与模式/模型选择。对应 `app/canvas/_canvas/components/AgentChatPanel.tsx`。
_Avoid_: 对话区（口语可用，文档中用 AgentChatPanel）、编排器、Agent 面板

**AgentComposer**（历史术语，已废弃）:
曾指 Canvas 中与 Agent 交互的编排组件，对应旧文件 `components/AgentComposer.tsx`。
Canvas 现已改用 AgentChatPanel，此术语不再用于指代当前右侧对话面板。

**NodeItem**（画布素材节点）:
画布上的一个素材单元（图片或文本），对应 `NodeItem` 类型（`_canvas/types.ts`）。
承载位置、尺寸、内容，可被选中、删除、带入 Dock 再创作，或 @ 进 AgentChatPanel。

**Card**（对话卡片消息）:
AgentChatPanel 消息流里的一种消息形态（`ChatMessage` 的 `card` 变体），
表示一次生成结果（图片/视频）。**Card 与 NodeItem 是同一生成结果的两种视图**：
Card 是结果在对话流里的呈现，NodeItem 是同一结果在画布上的呈现。
_Avoid_: 把 Card 与 NodeItem 当作两个独立概念。

**BottomDock**（底部生成 Dock）:
Canvas 底部的生成工具面板，由 `LeftToolbar` 的 ai-image / ai-video 工具触发，
含 image / video 两种 mode。它是**纯生成工具**：手填参数（模型、比例、分辨率、
时长、数量、联网搜索等）做确定式生成，不涉及对话流。
对应 `_canvas/components/dock/`。

**生成能力的两个入口（职责边界不同，非同一功能）**:
- **BottomDock**：纯生成工具，参数驱动，不暴露对话上下文。
- **AgentChatPanel**：编排 + 生成，对话/技能/上下文驱动，不暴露细粒度参数。
两者产物都是 Card / NodeItem，但**职责边界不同、是两个独立功能**，
后续对接后端应为两套独立的生成路径，不应强行合并为同一 API。

**Project**（项目，顶层聚合根）:
领域的顶层概念。一个 Project **包含** 一个 Canvas 及其 AgentChatPanel 对话历史。
切换 Project 即切换画布与对话。对应 `Project` 类型（`_canvas/types.ts`）。
_Avoid_: 把 Canvas 当作顶层概念（它是 Project 的组成部分）。

**聚合层级**: `Project` ⊇ { `Canvas`(节点集合 + 视口), `AgentChatPanel 消息流` }。
对话历史归属于 Project，不归属于 Canvas 本身。

**Card 生命周期状态**: `generating` → `normal` | `failed`。
失败后的恢复策略为**对话内原地重试**（在 card 上重发同一 prompt/参数）。
DEMO 阶段不区分失败原因，所有 `failed` card 均可原地重试；后端对接后再细分
（积分不足/审核拒绝/超时等）。

**Spike**:
为验证某个高风险点而做的最小可运行验证，**不是正式功能交付**。
_Avoid_: 原型、demo、试验（这些含义更宽）
