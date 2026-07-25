# ADR-0027：画布生成 hook 抽象 + 统一水合（useCanvasGeneration + hydrate）

**状态：** P1+P2 已实现，P3 基础就位（2026-07-24；generate 接线待连线功能）
**关联：** ADR-0021（分层架构）、ADR-0024（recipe params catalog）、`useVideoJobs`、`useCanvasDoc`、IJZXW7（父 issue）、IK3PE9（本工单）

> 编号说明：原拟 0025，但 master 的 0025/0026 已被支付扩展（`0025-payment-extension-via-blue-whale-pay`）与 dubbo-rpc 占用，故改 0027。

## 决策

画布 v2 的**生成 / job 轮询 / recover / 水合**逻辑从 `page.tsx` 抽到 `useCanvasGeneration` hook；`page` 退化为薄编排层。load 后 `hydrate` 统一恢复未完成节点（status + 续轮询 + job 状态同步）。recipe references 带 `nodeId`/`assetId`（不只 url）。

## 背景

`page.tsx` 是上帝组件（800+ 行）：生成（`handleGenerate` 3 路径 + `handleGenerateFromNode`）+ job 轮询（`useVideoJobs`）+ recover（`listJobs` + 去重）+ `setNodeAsset` + stream handlers + load effect 全堆 page。

IJZY0Z 重构时生成逻辑临时放 page（strangler 迁移先跑通），后续 B/C/D/recipe fix 叠加，recover 越改越复杂，每次改暴露一个遗漏：

1. 连续生成 → 单 ref 覆盖（`useJobStatus` 单 jobState）。
2. 刷新 → 节点重复（生成 id ≠ recover id）。
3. recover 续轮询但没 status → 灰停。
4. taskId 没持久化（serialize 漏）→ recover by taskId 失效。

根因：**没 hydrate 抽象**——"刷新后恢复"散在 page recover 手写，serialize 剥 status + recover 恢复 status 是隐式约定（没文档、靠人记、易漏）。

## 决策理由

1. **单一职责**：page = UI 编排（Dock/toolbar/菜单）；`useCanvasGeneration` = 生成业务（generate/job/recover/hydrate）。
2. **hydrate 封装"刷新后恢复"**：serialize 剥 status（临时态）→ hydrate 统一恢复 status=running + 续轮询 + 查 job 状态决定 running/done/error。不再靠 recover 手动加步骤。
3. **recipe references nodeId/assetId**：Dock media 记来源（画布节点 `nodeId` / 上传 `assetId`），支撑后期连线（nodeId 关联画布内节点）+ 重新生成（assetId 兜底）。
4. **useVideoJobs 内聚**到 `useCanvasGeneration`（job 管理属于生成业务）。

## P1 范围调整（执行决策）

原 phasing：P1 = generate 骨架，P2 = hydrate（recover 并入）。**执行时发现 recover 强耦合 `startVideoJob`/`buildImageStreamHandlers`**（recover 续轮询用它们），若 P1 只搬 generate、recover 留 page，则 page recover 编译坏；若 hook 暴露这俩给 page recover 用，则 page 仍接触 job 管理（违反"page 不接触 job"，test-matrix REQ 不通过）。

故 **P1 一并搬 recover**（`44fca1e` 版 `existingNodeIds` 去重），P2 升级 recover → hydrate（加 ensureAsset 步 + reconcile + byTaskId 匹配 + 恢复 status=running）。

> **P2 自实现 taskId persist（取代 `835ea08`）**：原计划 P2 依赖视频 recipe fix 分支 `835ea08`（taskId persist page 版）进 master。实际 P2 在 hook 版**自己实现 taskId persist**（serialize 写 taskId + generate/generateFromNode video 写 taskId + recover byTaskId），IK3PE9 P2 ⊇ 835ea08（多加 reconcile）。故 `835ea08`（仍在 feature/IJZY-video-recipe-fix 未 merge）变 dead end，被 IK3PE9 取代，**P2 不阻塞**。

## 被否方案

- **保留 page 生成逻辑（现状）**：上帝组件，每改暴露遗漏（已证明 4 次）。→ 必须抽。
- **useCanvasDoc 加生成（数据层管业务）**：违反数据层纯（useCanvasDoc 只管 RF state + persist，不碰"怎么生成"）。→ 生成归业务层。
- **hook 暴露 startVideoJob/buildImageStreamHandlers 给 page recover（保持 P1 纯 generate）**：page 仍接触 job 管理，违反"page 不接触 job"。→ recover 一并搬 hook。

## 影响

- `page.tsx` 瘦（删 ~350 行 generate/recover/setNodeAsset/buildImageStreamHandlers/startVideoJob/useVideoJobs），只编排 UI + 调 hook（`generate`/`generateFromNode`/`recover`）。
- 新 `useCanvasGeneration.ts`（generate image/video/audio + generateFromNode + recover + setNodeAsset/buildImageStreamHandlers/startVideoJob + useVideoJobs 内聚）。
- `DockMediaItem` 加 `nodeId?`（P3-Slice1 ✅；`assetId` 已存在）+ `mappers.dockMediaToRecipeRefs`（DockMediaItem→RecipeInput 带 nodeId/assetId/url，+3 tests）+ `handlePickNode` 填 nodeId/assetId。
- recipe references generate 接线（**P3-Slice2 待后续**）：image reference 走 editor mentions（extractEditor 丢 nodeId），需 mention 系统改造（buildPill/extractEditor 保留 nodeId + GenerateArgs 类型链 + BottomDock/VideoDockContent）；当前无连线功能，YAGNI 暂缓，待连线功能开或重新生成需 nodeId 溯源时再做。
- `hydrate` 统一（P2；load 后自动恢复，取代 page 手写 ensureAsset+recover）。
- 不动：`useCanvasDoc`（数据层纯）、serialize/parse（taskId/recipe/prompt 已持久化）、后端三服务（8686/8081/8082）、老 /canvas（v1）。

## 验证（P1+P2）

- `useCanvasGeneration.test`（11 tests）：generate image/video/audio 矩阵 + generateFromNode（error + image/video happy）+ recover byTaskId（existing 恢复 running / 不存在建占位+taskId）+ reconcile（succeeded 无 assetId 写 done / 无候选跳过）+ hydrate（ensureAsset + recover + reconcile 组合）+ useVideoJobs 内聚（mock）。
- `model.test`：taskId serialize/parse round-trip（+1，共 20）。
- grep page 无 `useVideoJobs`/`setNodeAsset`/`startVideoJob`/`buildImageStreamHandlers`/直接 `recover`（page 只调 hydrate，REQ-7）。
- `npx tsc --noEmit` 零新错；`npx vitest run` 新测试全绿（auth 测试 `User.uid` 失败为 master 预存在，与本工单无关）。
