# Blue-Whale 前端

一个面向 AI Agent / Canvas 交互的纯客户端单页应用（SPA）。当前处于从
Next.js + React 向 Vite + Vue3 整体重写的迁移期，详见
[ADR-0001](./docs/adr/0001-migrate-react-next-to-vite-vue3.md)。

## Language

**Canvas**:
应用的核心交互界面，承载 Agent 创作与编辑，对应原 `app/canvas/page.tsx`（3474 行巨石）。
_Avoid_: 画布（口语可用，文档中用 Canvas）、编辑器（指代不同概念）

**AgentComposer**:
Canvas 中负责与 Agent 交互/编排的组件，原 `components/AgentComposer.tsx`（1584 行）。
_Avoid_: 编排器、Agent 面板（口语可用，文档中用 AgentComposer 以与代码对齐）

**Spike**:
迁移前为验证某个高风险点（当前特指 framer-motion → motion-v 的动画可行性）而做的
最小可运行验证，**不是正式功能交付**。
_Avoid_: 原型、demo、试验（这些含义更宽）
