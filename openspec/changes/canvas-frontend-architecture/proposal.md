## Why

画布前端 `NodeItem` 混 `imageUrl + assetId + status/progress/selected`（临时态落库）、无 NodeKind registry、工作流无底层；后端生成已返回 assetId 但前端 `page.tsx` 丢弃（IK2BJK 点名的「未完成迁移」）。加媒介/未来工作流都要返工。需一次建到位分层底座（L0-L5），从底层支持工作流，Zustand 管状态，不动后端。

## What Changes

- 新增 L0 `model.ts`：CanvasDoc/Node/Edge/Asset 纯类型，**assetId 引用**（非 url），edges/group/recipe 字段留位
- 新增 L1 `kinds.ts`：NodeKind registry（kind→{media,ports,buildTask,Component}，含 group 占位）
- 新增 L3 `engine.ts`：runEngine 纯函数（runNode/runGroup/resolveInputs/topoSort + 注入 RunCtx），本轮 UI 不触发
- 新增 L4 `store.ts`：Zustand（doc + assets 缓存 + 会话态 + scheduleSave），**替换 useReducer**
- 改 L2 `CanvasNodes.tsx`：nodeTypes 从 registry；节点组件按 assetId 渲染（无工作流 UI）
- 改 `lib/canvas.ts`：opaque 存 `{nodes,edges}`
- **BREAKING**：`canvas.nodes_json` 结构变（`NodeItem[]` → `{nodes,edges}`），清表 15 条旧数据，schemaVersion 干净起步
- 废弃 `projectReducer.ts`（action 逻辑迁 store，测试迁 store 等价测试）

## Capabilities

### New Capabilities

- `canvas-doc-model`：画布文档数据模型（CanvasDoc/Node/Edge/Asset，assetId 引用，工作流字段留位，序列化剥离临时态）
- `node-kind-registry`：NodeKind 注册表（kind→{media,ports,buildTask,Component}，含 group 占位，buildTask 引用优先）
- `run-engine`：工作流执行引擎（runNode 单跑不级联 / runGroup 拓扑级联 / resolveInputs / topoSort 环检测，纯函数 + 注入 RunCtx）
- `canvas-store`：Zustand 画布状态（doc{nodes,edges} 持久 + assets 按需缓存 + 会话态分离 + scheduleSave 防抖 + 项目隔离）
- `canvas-rf-adapter`：React Flow 适配（nodeTypes 从 registry，onNodesChange 接 store，assetId 渲染解析，本轮 edges 空）

### Modified Capabilities

（无——全新架构，`openspec/specs/` 为空）

## Impact

- 前端 `blue_whale_web/app/canvas/_canvas/`（新增 4 文件 + 改 CanvasNodes/nodeFromCard + 保留 messages/placement/recover/useJobStatus 接 store）
- `blue_whale_web/lib/canvas.ts`（opaque 存 {nodes,edges}，签名不变）
- 后端**零改**（opaque PUT 继续，CanvasService 不动）
- canvas 表清表（15 条旧数据）
- 现有 projectReducer/persist 测试 → store 等价测试
