# Proposal：画布生成 hook 抽象 + 统一水合

> **策略**：把 page.tsx 的生成/job/recover/hydrate 全抽到 `useCanvasGeneration` hook，page 退化为薄编排。hydrate 统一"刷新后恢复"（status + 续轮询 + job 状态同步）。recipe references 带 nodeId/assetId（不只 url）。
> 决策见 `docs/adr/0027-canvas-generation-hook-hydrate.md`。

## Why

page.tsx 是上帝组件（800+ 行）：生成 3 路径 + job 轮询 + recover + setNodeAsset + load 全堆。每改 recover 暴露遗漏（重复/灰停/status 丢/taskId 没持久化），根因是没 hydrate 抽象——恢复逻辑散在 page 靠人记。recipe references 只 url（没 nodeId/assetId），不支持后期连线 + 重新生成的溯源。

## What Changes

- **useCanvasGeneration（新 hook）**：封装 generate/handleGenerateFromNode/recover/hydrate + setNodeAsset/buildImageStreamHandlers/startVideoJob + useVideoJobs 内聚。page 只调 hook 暴露的 API。
- **hydrate 统一**（P2）：load 后自动扫描未完成节点（有 taskId 无 assetId）→ 恢复 status=running + 续轮询 + 查 job 状态决定 running/done/error。不再 page 手写 load+ensureAsset+recover 3 步。
- **DockMediaItem 加 nodeId?**（P3）：参考素材记来源（画布节点 nodeId / 上传 assetId 已存在）。
- **recipe references 带 nodeId/assetId**（P3）：生成时 Dock media → recipe inputs references 记 `{kind, nodeId?, assetId?, url}`，支撑连线（nodeId）+ 重新生成（assetId 兜底）。

## Capabilities

### New
- `canvas-generation-hook`：生成业务 hook（generate/job/recover/hydrate 统一）+ recipe references nodeId/assetId + DockMediaItem 来源记。

### Modified
- `canvas-doc-model`：DockMediaItem 加 nodeId?（assetId 已存在）；recipe references 类型已支持 nodeId/assetId（model.ts RecipeInput），补生成写入（P3）。

## Impact

- `useCanvasGeneration.ts`（新）：generate/generateFromNode/recover（P1）+ hydrate（P2）。
- `page.tsx`：删生成/recover（瘦 ~350 行），调 hook。
- `types.ts`：DockMediaItem 加 nodeId?（P3）。
- `mappers.ts`：recipe references 带 nodeId/assetId（P3，从 DockMediaItem 映射）。
- `useCanvasDoc.ts`：不变（数据层纯）。
- 测试：useCanvasGeneration 单测（generate/generateFromNode/recover/hydrate 矩阵）+ recipe references nodeId/assetId round-trip（P3）。

## Phasing

- **P1**（已实现）：useCanvasGeneration 骨架（generate + generateFromNode + recover + useVideoJobs 内聚 + page 接线）。
  - **范围调整**：recover 强耦合 startVideoJob/buildImageStreamHandlers，P1 一并搬 recover（原计划 P2），避免 page 接触 job。详见 ADR-0027「P1 范围调整」。
- **P2**：hydrate 统一（recover 升级：ensureAsset + reconcile succeeded 无 assetId 写 done + byTaskId 匹配 + 恢复 status=running；依赖 taskId persist 835ea08）。
- **P3**：recipe references nodeId/assetId（DockMediaItem 加 nodeId + 生成写入 + recipeToDockPrefill 回填）。
