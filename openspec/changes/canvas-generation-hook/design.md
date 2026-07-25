# Design：画布生成 hook 抽象 + 统一水合

> 关联 ADR-0027、ADR-0021（分层）、ADR-0024（recipe params）、useVideoJobs、useCanvasDoc。
> 本文：hook 接口 + hydrate 流程 + recipe references nodeId/assetId + DockMediaItem 扩展 + 分层。

## 1. useCanvasGeneration hook 接口

```ts
export function useCanvasGeneration(deps: {
  nodes: CanvasNode[];           // useCanvasDoc nodes（读，判断现有节点状态）
  edges: CanvasEdge[];
  assets: Record<string, Asset>; // zustand assets
  addNode / patchNode / addAsset: 从 useCanvasDoc/store 注入（addNode 含 placement，page 注入）
  projectId: string;
}): {
  generate(args: GenerateArgs): Promise<void>;           // Dock 生成（image/video/audio 3 路径）
  generateFromNode(nodeId: string): Promise<void>;        // toolbar 生成（节点 toolbar 触发）
  recover(existingNodeIds: Set<string>): Promise<void>;   // 刷新恢复（P1：listJobs + 去重；P2 升级 byTaskId）
  // hydrate(nodes): Promise<void>;                       // P2：load 后统一水合（ensureAsset + recover + reconcile）
  generating: boolean;
  generateError: string | null;
  setGenerateError: (e: string | null) => void;           // page 上传错误复用
}
```

- `useVideoJobs` 内聚（hook 内部用，不暴露给 page）。
- `setNodeAsset` / `buildImageStreamHandlers` / `startVideoJob` 全内部（page 不接触）。
- page 只调 `generate` / `generateFromNode` + `recover`（load 时）。image 参考图 fallback（imageDockMedia → referenceImages）由 page 注入（hook 不持有 imageDockMedia UI state）。

## 2. P1 recover（已搬，44fca1e 版）

```
recover(existingNodeIds):
  jobs = listJobs(processing)
  for job in jobs:
    ph = jobToV2Placeholder(job)
    if existingNodeIds.has(ph.id): continue   // 去重：画布已 persist 该 job 占位则跳过
    if ph.kind == video: addNode(占位+recoverRecipe) + startVideoJob(ph.id, job.jobId)
    else: addNode(占位) + streamJob(job.jobId, buildImageStreamHandlers(...))
```

P1 保留 `existingNodeIds` 去重（44fca1e 版），P2 升级见下。

## 3. P2 hydrate 统一水合（取代 page load effect 手写）

```
hydrate(nodes):
  1. ensureAssets: nodes 有 assetId 的 → ensureAsset（拉 src 填 assets 缓存）
  2. recover: listJobs(processing) → by taskId 匹配 nodes
     - existing → 恢复 status=running + startVideoJob / streamJob（续轮询）
     - 不存在 → 建 job-{jobId} 占位 + taskId + startVideoJob
  3. reconcile: listJobs(succeeded) → 有 taskId 但无 assetId 的节点 → 写 assetId/done
     （防 succeeded 回调没跑节点永卡 running）
```

**hydrate 封装"刷新后恢复"全流程**，page 只调一次 `hydrate(d.nodes)`。不再手动 ensureAsset + recover 分步。

> P2 依赖 taskId persist（serialize 持久 taskId）——在视频 recipe fix 分支 `835ea08`（未 merge）。P2 前需它进 master。

## 4. P3 recipe references 带 nodeId/assetId

现状（Dock 生成）：
```
vidRefs = referenceImages.map(u => ({ kind: "image", url: u }))  // 只 url
```

改：DockMediaItem 加 `nodeId?`（`assetId?` 已存在），生成时映射进 recipe：
```
vidRefs = dockMedia.map(m => ({
  kind: m.type,
  nodeId: m.nodeId,     // 画布内来源（从画布选的参考）
  assetId: m.assetId != null ? String(m.assetId) : undefined,   // 画布外/上传资产
  url: m.src,           // 兜底
}))
```

- `nodeId` 来自"从画布选"（handlePickNode 带 nodeId）。
- `assetId` 来自"上传"（handleDockLocalUpload 已带 assetId）。
- `url` 始终带（兜底，防节点删除）。

**支撑后期连线**：nodeId 关联画布内节点（连线式 edges 也能用 nodeId）；重新生成按 nodeId 重解析当前 asset（尊重换图）。

## 5. DockMediaItem 扩展（P3）

```ts
export type DockMediaItem = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  src?: string;
  assetId?: number;   // 已存在（上传/生成资产的 id）
  nodeId?: string;    // ★ P3 新：画布内来源节点（从画布选）
  uploadProgress?: number;
};
```

来源填充：
- `handlePickNode`（从画布选）：`{ nodeId: node.id, assetId: Number(node.data.assetId), src }`。
- `handleDockLocalUpload`（上传）：`{ assetId: result.id, src: result.url }`（无 nodeId，已实现）。

## 6. 分层（目标）

```
useCanvasDoc（L4 数据层）：RF state + persist/load，纯数据（不动）
useCanvasGeneration（L3 业务层）：generate/job/recover/hydrate + useVideoJobs 内聚（P1 已建）
useCanvasStore（缓存层）：assets 缓存（不动）
page（L5 编排层）：UI + 调 useCanvasDoc + useCanvasGeneration（瘦 ~350 行）
```

## 关键决策

### 1. P1 一并搬 recover（原计划 P2）
recover 强耦合 startVideoJob/buildImageStreamHandlers。分开搬 page recover 编译坏；hook 暴露这俩则 page 接触 job（违反 REQ-7）。故 P1 搬 recover（44fca1e 版去重），P2 升级 hydrate。详见 ADR-0027。

### 2. hydrate 替代 page load effect 手写（P2）
hydrate 封装 ensureAsset + recover + reconcile。page 只 `hydrate(d.nodes)`。

### 3. useVideoJobs 内聚到 useCanvasGeneration
job 轮询属于生成业务，内聚到生成 hook。page 不接触 job 管理。

### 4. reconcile（P2 新增）
listJobs(succeeded) → 有 taskId 无 assetId 的节点写 assetId/done。防 succeeded 回调没跑（关页面时）节点永卡 running。

## 落地点

| 任务 | 文件 | 阶段 | TDD |
|---|---|---|---|
| useCanvasGeneration 骨架 | 新 hook | P1 ✅ | generate/generateFromNode/recover 矩阵测 |
| hydrate 统一 | hook 内 | P2 | hydrate 流程测（ensureAsset + recover + reconcile）|
| DockMediaItem nodeId | types.ts | P3 | 类型 |
| recipe references nodeId/assetId | mappers.ts | P3 | recipe round-trip 带 nodeId |
| page 接线 | page.tsx | P1 ✅ | 删生成/recover，调 hook |
