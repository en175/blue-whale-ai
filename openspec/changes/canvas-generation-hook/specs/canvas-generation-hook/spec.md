# Spec：canvas-generation-hook

> 生成业务 hook 抽象 + 统一水合（ADR-0027）。把 page 的生成/job/recover/hydrate 抽到 `useCanvasGeneration`；recipe references 带 nodeId/assetId（P3）。
> 关联：`node-recipe-provenance`（references nodeId/assetId）、`canvas-doc-model`（DockMediaItem 扩展）。

## Requirements

### REQ-1 useCanvasGeneration hook 封装生成业务
生成（image/video/audio 3 路径）+ generateFromNode（toolbar 生成）+ recover + job 轮询（useVideoJobs 内聚）+ setNodeAsset + stream handlers 全封装在 hook。page 只调 `generate`/`generateFromNode`/`recover`（P2 加 `hydrate`）。

### REQ-2 hydrate 统一水合（P2）
load 后 `hydrate(nodes)` 一次完成：① ensureAsset（拉 asset src 缓存）② recover（listJobs + byTaskId 匹配 + 恢复 status=running + 续轮询）③ reconcile（succeeded 但无 assetId 的节点写 done）。不再 page 手写 3 步。

### REQ-3 recover 按 taskId 匹配 + 恢复 status（P2 升级）
P1：recover 用 `existingNodeIds` 去重（44fca1e 版）。P2 升级：`byTaskId` map 匹配已持久化节点 → 恢复 `status:"running"` + 续轮询（startVideoJob/streamJob）；不存在 → 建 `job-{jobId}` 占位 + taskId。依赖 taskId persist（835ea08）。

### REQ-4 reconcile 防永卡（P2）
hydrate 第三步：listJobs(succeeded) → 有 taskId 但无 assetId 的节点 → 写 assetId/done（防 succeeded 回调没跑节点永卡 running）。

### REQ-5 DockMediaItem 带 nodeId/assetId（P3）
DockMediaItem 加 `nodeId?`（画布内来源）+ `assetId?`（已存在，上传/生成资产 id）。从画布选带 nodeId；上传带 assetId。

### REQ-6 recipe references 带 nodeId/assetId（P3）
生成时 Dock media → recipe inputs references 记 `{kind, nodeId?, assetId?, url}`（不只 url）。nodeId 支撑连线（画布内节点关联）；assetId/url 兜底（重新生成）。

### REQ-7 page 退化为薄编排（P1 ✅）
page 删生成/recover/hydrate/setNodeAsset/startVideoJob/buildImageStreamHandlers/useVideoJobs，调 useCanvasGeneration。page 只管 UI（Dock/toolbar/菜单）+ 调 hook。grep page 无 useVideoJobs/setNodeAsset/startVideoJob。

### REQ-8 不破坏现有
useCanvasDoc 不动（数据层纯）；recipe 模型不动（RecipeInput 已支持 nodeId/assetId，P3 只补写入）；serialize/parse 不变（taskId/recipe/prompt 已持久化）；后端三服务不动；老 /canvas v1 不动。

## Scenarios

### Scenario：generate image/video/audio 3 路径（P1 ✅）
- **Given** Dock 生成（image 流式/非流式 / video createVideoJob / audio generateAudio）
- **When** hook.generate(prompt, args)
- **Then** 建 running 占位 + 调对应 API + 写 assetId/done/recipe（video 转 startVideoJob 后台轮询）

### Scenario：generateFromNode 取上游 prompt 生成（P1 ✅）
- **Given** 节点 toolbar 触发，上游 text 节点经 edge 注入 prompt
- **When** hook.generateFromNode(nodeId)
- **Then** resolveInputs 取上游 prompt → getImageModels/getVideoModels → 生成；无上游 prompt → generateError 不生成

### Scenario：刷新后视频节点恢复（P2）
- **Given** 视频生成中刷新（节点有 taskId，无 assetId）
- **When** load + hydrate
- **Then** 原节点恢复 status=running（loading 显示）+ 续轮询 → done 时写 assetId

### Scenario：刷新不建重复节点（P1 ✅ existingNodeIds / P2 byTaskId）
- **Given** 生成占位已 persist
- **When** recover
- **Then** 匹配到 → 不建重复占位

### Scenario：succeeded 回调没跑 → reconcile 写 done（P2）
- **Given** 节点有 taskId + 无 assetId；job 已 succeeded
- **When** hydrate reconcile
- **Then** 节点写 assetId + status=done（不永卡 running）

### Scenario：recipe references 带 nodeId（P3）
- **Given** 从画布选图片节点作参考 → DockMediaItem{nodeId, assetId, src}
- **When** 生成视频
- **Then** recipe.inputs.references=[{kind:image, nodeId, assetId, url}]

### Scenario：page 不接触 job 管理（P1 ✅）
- **Given** useCanvasGeneration 封装
- **Then** page 无 useVideoJobs/setNodeAsset/startVideoJob/recover，只调 hook.generate/generateFromNode/recover
