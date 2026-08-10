# ADR-0022：画布前端分层架构重建

**状态：** Partially Superseded（决策#4，2026-08-10）
**关联：** IK2BJK（assetId spec）、IJZXW7（多模态 PRD）

> **2026-08-10 决策#4 修订**：决策#4 原文假定「messages/placement/recover/nodeFromCard/useJobStatus 保留接 store」。经 IK7GWV（死代码清理）与 IK7GWW（Direct Gen 退役 + 幻影写入修复）落地，`useJobStatus`（旧单 job 轮询）、`projectReducer`（已被 Zustand store 取代）、`useCanvasProjects`（被 `useV2Projects` strangler 取代）、`projectGenerationState`、`nodeFromCard` 函数体均已删除，`CREATION_MODES` Direct Gen 死入口亦退役。现状是：**Zustand store 为唯一状态源，权威模式（backendReady）渲染只读 Snapshot/SSE 源，离线 mock 仅作后端不可达时的降级**。决策#4 的「渐进迁移」总体方向不变，但「保留接 store」的符号清单需按本修订与「连锁影响」节更新后的清单为准。分层架构 L0-L5、Zustand、NodeKind registry、注入式 engine 等核心决策（#1-3、#5-9）不受影响，继续有效。

## 决策

把画布前端（`blue_whale_web/app/canvas/_canvas/`）重建为 **L0-L5 分层架构**，从底层支持工作流，Zustand 管状态，分层解耦、健壮、可扩展。**不动后端**（Java + `canvas.ts` opaque PUT 继续）。

9 项子决策（均已确认）：

| # | 决策 | 结论 |
|---|---|---|
| 1 | 媒体产物存储 | `assetId` 引用（非 url）；渲染查 `store.assets[id]` |
| 2 | assets 填充 | canvas opaque 只存 `{nodes,edges}`（node 存 assetId）；`store.assets` 按需缓存（`getAsset` 换 src + 生成注册）；单一真相=后端 assets 表 |
| 3 | 状态管理 | Zustand（替换 useReducer）；projectReducer action 逻辑迁入 store |
| 4 | 现有代码 | ~~渐进迁移：messages/placement/recover/nodeFromCard/useJobStatus 保留接 store~~ **修订（2026-08-10）**：渐进迁移方向不变，但「保留接 store」清单已收敛——`useJobStatus`/`projectReducer`/`useCanvasProjects`/`projectGenerationState`/`nodeFromCard` 函数体已删除（见顶部修订说明），保留的仅 messages/placement/recover |
| 5 | 工作流 UI | 底层就绪，UI 本轮不开（无连线/编组/Run 操作） |
| 6 | 工作流底层 | edges/engine/group/recipe 全保留（字段 + 纯函数就绪） |
| 7 | runEngine | 纯函数 + 单测建好；`RunCtx.generate` 留接口（mock），真实接 IJZ7Z9 留未来 |
| 8 | NodeKind registry | 含 group 占位（Component 占位 + buildTask throw）；未来开编组即用 |
| 9 | 后端 | 不动；`{nodes,edges}` 一起 stringify 进 `canvas.ts` opaque nodes 参数 |

## 背景

现状审计（2026-07-21）暴露三类问题：
1. `NodeItem` 混 `imageUrl + assetId + status/progress/selected`——素材身份、生成态、会话态塞一个结构；`progress:90` 落库（canvas 15 条实查）。
2. 后端生成链路已返回 assetId（`SsePayload{assetId,url}`/`ImageDto`/`GenerationJob.outputAssetIds`），前端 `page.tsx` 主动丢弃——IK2BJK 点名的「未完成迁移」。
3. nodeTypes 硬编码、无 registry、工作流无底层——加媒介/未来工作流都要返工。

IK2BJK spec 已定 assetId 引用方向（推翻 IJZXW7 的 asset 内联）；「画布即文档 + NodeKind registry + 注入式 runEngine + 隔离 RF 的 store」是健壮可扩展的分层范式。本 ADR 据此在蓝鲸落地。

## 分层架构

```
L5  UI 层      page.tsx / 工具栏 / Dock / Agent（Dock/Agent 本轮不动）
L4  状态层 ★  store.ts (Zustand)：doc{nodes,edges} + assets 缓存 + 会话态；scheduleSave 800ms
L3  执行层 ★  engine.ts：runNode/runGroup/resolveInputs/topoSort（纯 + 注入 RunCtx；本轮 UI 不触发）
L2  RF 适配    CanvasNodes.tsx：nodeTypes 从 registry；onNodesChange 接 store；edges 本轮空
L1  节点抽象 ★ kinds.ts：NodeKind registry（kind→{media,ports,buildTask,Component}）
L0  文档模型   model.ts：CanvasDoc/Node/Edge/Asset 纯类型（无 RF 依赖）
```

**健壮可扩展的根**：L0 无 RF 依赖（可纯测/可序列化）；L1 registry 与 UI 解耦（加媒介扩一处）；L3 注入 RunCtx（engine 可测不依赖 store）；L4 隔离 RF（会话态/持久态分离，持久化/生成/恢复都走 store）；层间单向依赖。

## 被否方案

- **`value:{url}` 直存**：丢后端 assetId、无法去重/生命周期、url 可能过期——回到 IK2BJK 要修的坑。→ 改 assetId 引用。
- **全重写 `_canvas/`**：丢现有 projectReducer/persist/recover 测试，回归风险高。→ 渐进迁移。
- **工作流 UI 本轮开放**：超 IK2AVR「workflow 不在范围」；UI 开放 ≠ 底层就绪，混在一起会拖慢底座。→ 底层就绪 UI 不开。
- **不换 Zustand（保留 useReducer）**：useReducer 难干净承接「RF 高频会话态 vs 持久 doc」分离 + 跨组件订阅。→ 换 Zustand。
- **canvas blob 带 assets 实体**：与后端 assets 表双写，一致性维护成本。→ node 只存 assetId，assets 按需缓存。
- **切项目 GET /assets?projectId 拉**：要后端加 endpoint，违反不动后端。→ 按需 getAsset 缓存。
- **engine 本轮接真实生成**：UI 不触发 = 建了没用户路径，YAGNI。→ 纯函数 + 留接口。

## 连锁影响

**新增**：`_canvas/model.ts`、`_canvas/kinds.ts`、`_canvas/engine.ts`、`_canvas/store.ts`
**改**：`_canvas/components/CanvasNodes.tsx`（nodeTypes 从 registry）、`lib/canvas.ts`（opaque 存 {nodes,edges}）、`_canvas/nodeFromCard.ts`（透传 assetId）
**保留接 store**：`_canvas/messages.ts`、`placement.ts`、`recover.ts`
**已删除（2026-08-10，IK7GWV/IK7GWW 落地后）**：`_canvas/hooks/useJobStatus.ts`（旧单 job 轮询，被多 job 方案取代）、`_canvas/projectReducer.ts`（action 逻辑迁 store 后整体废弃）、`_canvas/useCanvasProjects.ts`（被 `useV2Projects` strangler 取代）、`_canvas/projectGenerationState.ts`、`nodeFromCard` 函数体（`CardMessage` 类型仍保留）
**后端**：零改（opaque PUT 继续走 CanvasService）
**数据**：canvas 表 15 条旧数据清表（`UPDATE canvas SET nodes_json=NULL`），schemaVersion 干净起步

**后续（不在本 ADR 范围）**：
- 工作流 UI 开放（连线/编组/Run）——engine 已就绪，开 UI 即用
- `canvas_state` 结构化 + revision/CAS——IK2BJK 的后续独立工单
- video/audio 渲染播放控制细节——IJZY0Z 渲染部分
