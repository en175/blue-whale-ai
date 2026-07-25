# Tasks：画布生成 hook 抽象 + 统一水合（TDD）

> P1 hook 骨架（含 recover 搬迁）→ P2 hydrate 统一 → P3 recipe references nodeId/assetId。全程 TDD。文件均在 `blue_whale_web/`。
> 决策见 `docs/adr/0027-canvas-generation-hook-hydrate.md`。

## P1 — useCanvasGeneration 骨架（generate + generateFromNode + recover + page 接线）✅

- [x] T1 `useCanvasGeneration.ts`（新）：封装 generate（image/video/audio 3 路径）+ generateFromNode + useVideoJobs 内聚 + setNodeAsset + buildImageStreamHandlers + startVideoJob。暴露 `{ generate, generateFromNode, recover, generating, generateError, setGenerateError }`。
  - 从 page 抽：handleGenerate / handleGenerateFromNode / setNodeAsset / buildImageStreamHandlers / startVideoJob / useVideoJobs。
  - **TDD**：`useCanvasGeneration.test` generate image/video/audio 矩阵（mock api/generation）+ generateFromNode（无 prompt 报错 + image happy 取上游 prompt）+ useVideoJobs 内聚（mock）。
- [x] T1.5 recover 入 hook（**范围调整**：原计划 P2，因强耦合 startVideoJob/buildImageStreamHandlers 提前到 P1）：`useCanvasGeneration.recover(existingNodeIds)` 搬 page recoverProcessingJobs（44fca1e 版去重）。page load effect 调 `recover(new Set(d.nodes.map(n=>n.id)))`。
- [x] T2 page 接线：删 handleGenerate/handleGenerateFromNode/setNodeAsset/buildImageStreamHandlers/startVideoJob/useVideoJobs/recoverProcessingJobs/updateNode，调 `useCanvasGeneration()`。image 参考图 fallback（imageDockMedia → referenceImages）由 page wrapper 注入。
  - 验证：grep page 无 useVideoJobs/setNodeAsset/startVideoJob/buildImageStreamHandlers；tsc 零新错；vitest 新测试全绿。

## P2 — hydrate 统一水合 ✅（自实现 taskId persist，取代 835ea08）

- [x] T3 hydrate 入 hook：`useCanvasGeneration.recover/reconcile/hydrate`：recover 升级 byTaskId（匹配 + 恢复 status=running + 续轮询）+ reconcile（listJobs succeeded → taskId 无 assetId 写 done）+ hydrate（ensureAsset + recover + reconcile）。含 taskId persist（serialize 写 taskId + generate/generateFromNode video 写 taskId）。
  - **取代 835ea08**：原计划 P2 依赖 835ea08（taskId persist page 版）进 master；实际 P2 hook 版自实现 taskId persist + 多 reconcile，IK3PE9 P2 ⊇ 835ea08，835ea08 变 dead end（未 merge，被取代）。
  - **TDD**：useCanvasGeneration.test recover（existing→running+轮询 / 不存在→建占位+taskId）+ reconcile（succeeded 无 assetId→done / 无候选跳过）+ hydrate（ensureAsset+recover+reconcile 组合）+ model.test taskId round-trip。
- [x] T4 page 接线：load effect 改调 `hydrate(d.nodes)`（删 ensureAsset + recover 手写）。page 只调 hydrate，不接触 recover（REQ-7）。

## P3 — recipe references nodeId/assetId（Slice1 ✅ 基础；Slice2 generate 接线待后续）

- [x] T5 DockMediaItem 加 `nodeId?`（types.ts；`assetId?` 已存在）。
- [x] T6 从画布选（handlePickNode）带 nodeId/assetId；上传（handleDockLocalUpload）已带 assetId。
- [x] T6.5 `mappers.dockMediaToRecipeRefs`（DockMediaItem→RecipeInput 带 nodeId/assetId/url）+ 3 tests（mappers.test：带 nodeId / 上传无 nodeId 兜底 / 无 src 跳过）。
- [ ] T7 生成 recipe references 带 nodeId/assetId（**待后续，mention 改造**）：image reference 走 editor mentions（extractEditor 丢 nodeId），需 buildPill/extractEditor 保留 nodeId + GenerateArgs references 类型 + BottomDock/VideoDockContent 传带 nodeId + generate recipe refs 从 references。当前无连线功能，YAGNI 暂缓。
- [ ] T8 recipeToDockPrefill 回填 references 带 nodeId/assetId（待 T7，recipe refs 有 nodeId 后回填才有源）。

## 验证

- [x] `npx vitest run`（useCanvasGeneration 5 tests 全绿；auth 测试 User.uid 失败为 master 预存在）。
- [x] `npx tsc --noEmit`（page/hook 零新错；auth 测试 User.uid 错预存在）。
- [x] grep page 无 useVideoJobs/setNodeAsset/startVideoJob/buildImageStreamHandlers（"page 不接触 job"）。
- [ ] dev round-trip（需后端 8686/8081/8082）：生成视频刷新→恢复 loading+续轮询+done；recipe references 带 nodeId（F12）；重新编辑带 Dock。
