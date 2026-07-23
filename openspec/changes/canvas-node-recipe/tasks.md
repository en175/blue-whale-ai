# Tasks：节点 Recipe

> P1 = 本 change 核心（类型 + 捕获 + 持久化）。P2 = 重新生成入口。P3 = 派生操作（后续子工单）。
> 每任务 TDD（vitest）。文件均在 `blue_whale_web/`。

## P1 — recipe 类型 + 捕获 + 持久化

- [ ] T1 `model.ts`：加 `NodeOrigin / NodeRecipe / GenerationRecipe / RecipeInputs / RecipeInput / ImageGenParams / VideoGenParams / AudioGenParams / DerivedRecipe` 类型；`CanvasNodeData.recipe?`。
  - 测试：`model.test.ts` 类型可用 + createEmptyDoc 不含 recipe 默认。
- [ ] T2 `model.ts` serialize/parse 保留 recipe。
  - 测试：generated 节点带 recipe serialize→parse 深相等；uploaded recipe round-trip；老数据无 recipe → undefined 不崩；带 recipe 的 JSON 老 /canvas 忽略不崩（断言 parse 不抛 + 已知字段在）。
- [ ] T3 `engine.ts` 加 `toRecipeInputs(resolved, edges|connections): RecipeInputs`——把 resolveInputs 结果 + 连线 nodeId 映射成冻结 RecipeInputs（prompt/firstFrame/lastFrame/references，nodeId 优先，assetId/url/text 兜底）。
  - 测试：prompt 来自文本节点 → {nodeId, text}；首帧来自画布图片节点 → {nodeId}；参考来自 Dock 上传（无 nodeId）→ {assetId/url}；节点删除场景 text 兜底。
- [ ] T4 `v2/page.tsx` 生成流写 recipe：
  - handleGenerate image（同步 + 流式 onImage 首图）→ patch recipe（generated + model + ImageGenParams + inputs + jobId）。
  - handleGenerate video + useJobStatus succeeded → patch recipe（generated + model + VideoGenParams{duration,refMode} + inputs{firstFrame,lastFrame,references} + jobId）。
  - handleGenerateFromNode image/video 同理。
  - handleCardGenerated（Agent 卡片）→ recipe generated + inputs.prompt.text。
  - 测试：page 为 wiring，抽 `buildGenerationRecipe(...)` 纯函数到 v2/mappers 或 engine，单测之；page 接线 tsc + dev 验。
- [ ] T5 `v2/page.tsx` 上传流写 recipe：
  - handleFileChange / handleDockLocalUpload → 建节点 data.recipe = {origin:"uploaded"}。
  - 测试：detectMediaKind 已覆盖；recipe 赋值随建节点（mappers/纯函数覆盖）。

## P2 — 重新生成入口

- [ ] T6 节点 toolbar「重新生成」：读 recipe.generation → 预填 BottomDock（model/比例/分辨率/时长/refMode/首尾帧/参考）+ 重解析当前 edges 输入（回退 frozen inputs）。
- [ ] T7 无 recipe 节点（uploaded/老数据）→ 入口禁用 + 提示「无重生成依据」。
- [ ] T8 重新生成产新节点：origin=generated（或 derived.regenerate + sourceNodeId=原节点）。
  - 测试：预填正确性（纯函数）；无 recipe 守卫。

## P3 — 派生操作（后续子工单，本轮仅类型就位）

- [ ] T9 toolbar「清晰化/截图/提取音频/局部重绘」实现 → 产 derived 节点（recipe.transform + sourceNodeId + 参数）。
- [ ] T10 `DerivedRecipe` 类型已在 P1 就位，P3 只实现动作接线。

## 验证

- [ ] `npx vitest run`（model/engine/mappers/nodes 全绿，新增 recipe 测试）。
- [ ] `npx tsc --noEmit`（改动文件零错）。
- [ ] dev `/canvas-v2` round-trip：生成图/视频 → 刷新 → 节点 recipe 在（DevTools 查 nodes_json）；点「重新生成」预填同参数；上传节点提示无依据。
