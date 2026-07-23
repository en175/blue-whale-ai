# ADR-0023：画布前端 strangler 并行迁移（/canvas-v2）

**状态：** 已接受（2026-07-21）
**关联：** ADR-0022（分层架构）、IJZXW7、`docs/research/canvas-frontend-architecture.md`

## 决策

ADR-0022 的画布前端重建用 **strangler 并行**落地：新路由 `/canvas-v2`（`app/canvas-v2/page.tsx` + `_canvas/v2/`）用新架构（L0-L4 store/model）从零实现，老 `/canvas`（`page.tsx` / `components/CanvasNodes.tsx` / `hooks/useCanvasProjects.ts`）**一行不动**。v2 功能对齐 + round-trip 验证通过后，替换老路由（重定向或废弃）。

## 背景

L2/L6「原地全切」评估发现：`NodeItem↔CanvasNode` 类型全换 + `reducer↔Zustand store` 状态切换 + 生成 `onImage` + 持久化切换，**6 文件交织，改一半画布跑不了**（无中间稳态）。一次全切 + 手动验证（登录→生成→保存→刷新恢复）风险高，且任何中间提交都是破状态。

strangler 让新老并行：老的随时可用（不破），新的可逐步实现 + 对比验证，每个提交都是稳态。

## 被否方案

- **原地全切**（改 page/CanvasNodes/useCanvasProjects）：交织无中间稳态，半切即破，验证风险高，回退难。
- **双轨渐进**（部分切 store 部分留 reducer）：`NodeItem`/`CanvasNode` 类型不兼容，同一组件无法同时吃两套类型，无干净中间态。
- **等 spec 全定再实现**：交付延迟，且 spec 本身要在实现中迭代。

## 连锁影响

- **新增**：`app/canvas-v2/page.tsx`、`_canvas/v2/{CanvasSurface,nodes}.tsx`，复用 `_canvas/{model,kinds,engine,store}.ts`（L0-L4）。
- **老的保留**：`/canvas`（page.tsx/CanvasNodes/useCanvasProjects）至 v2 功能对齐（TopBar 项目切换/LeftToolbar/BottomDock 生成/AgentChatPanel/生成 onImage/恢复 processing jobs）后替换。
- **useCanvasProjects 双轨**：v2 page 复用它的项目列表/messages/CRUD/switch；canvas 部分（set-canvas/save/loadCanvas）退役由 store 接管，switch 触发 `store.load`。
- **验证**：worktree `npm run dev -- -p 3001` 访问 `localhost:3001/canvas-v2`，对比老 `/canvas`（主检出 3000）。
- **替换时机**：v2 功能对齐 + round-trip（load/addNode/拖拽/保存/生成/恢复）通过 → `/canvas` 重定向 v2 或删老路由 + 老 `_canvas` 文件。
- **后端零改**：v2 同样经 next rewrite 调 gateway（8686），canvas opaque PUT 继续走（store.scheduleSave 存 `{nodes,edges}`）。
