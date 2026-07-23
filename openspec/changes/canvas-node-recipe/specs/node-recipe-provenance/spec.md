# Spec：node-recipe-provenance

> 节点产物溯源 + 重生成参数。每媒体节点记录 origin（怎么来的）+ generation（模型/参数/输入引用/job），持久进画布 JSON，作为重新生成与派生操作的唯一依据。
> 关联：`canvas-doc-model`（serialize/parse 保留 recipe）、ADR-0022、design.md。

## Requirements

### REQ-1 节点持 recipe
每个媒体节点（image/video/audio）的 `CanvasNodeData.recipe: NodeRecipe`。`NodeRecipe = { origin: NodeOrigin; generation?: GenerationRecipe }`。`origin ∈ "uploaded" | "generated" | "derived"`。

### REQ-2 origin=uploaded 无 generation
上传产生的节点 recipe = `{ origin: "uploaded" }`，无 generation 字段。

### REQ-3 origin=generated 带 generation 冻结
生成产生的节点 recipe 带 generation：`{ mediaKind, model, params, inputs, jobId?, generatedAt? }`。params 按 mediaKind 区分（ImageGenParams/VideoGenParams/AudioGenParams）。model 必填（catalog modelId）。

### REQ-4 输入引用 nodeId 优先 + 兜底
`RecipeInput = { kind, nodeId?, assetId?, text?, url? }`。画布内来源记 nodeId；画布外资产/上传素材记 assetId/url；文本 prompt 记 text 快照。一个 input 至少有 nodeId 或 assetId 或 text/url 之一。

### REQ-5 输入类别覆盖
`RecipeInputs` 覆盖：`prompt`（文本来源）、`firstFrame`/`lastFrame`（视频首尾帧来源）、`references[]`（omni 参考图/视频/音频）。生成时 `resolveInputs(edges)` 解析结果冻结为 RecipeInputs。

### REQ-6 recipe 持久化 round-trip
`serialize` 把 recipe 写进节点对象；`parse` 还原。serialize→parse 后 recipe 深相等（origin/generation/params/inputs/jobId 全保留）。

### REQ-7 向后兼容（老 /canvas 与老数据）
- 老 `/canvas` 读取带 recipe 的画布 JSON：不崩（忽略 recipe 字段，读已知字段）。
- 老数据（节点无 recipe）：`parse` 后 recipe=undefined，渲染不阻塞。

### REQ-8 生成流写 recipe
`handleGenerate` / `handleGenerateFromNode`（image/video）生成成功即 patch 节点 recipe（origin=generated + 当前 model + 完整 params + 冻结 inputs + jobId）。流式生成的首图、视频轮询 succeeded 都写。

### REQ-9 上传流写 recipe
`handleFileChange` / `handleDockLocalUpload` 建节点即写 recipe（origin=uploaded）。

### REQ-10 重新编辑读 recipe（P2）
节点 toolbar「重新编辑」：有 `recipe.generation` → params 预填 BottomDock（prompt/模型/比例/分辨率/数量/时长/refMode + 首尾帧 + 参考图）+ 重解析当前 edges 输入 → 用户可改后重跑产新节点。**无 recipe**（uploaded/老节点）→ **软降级**：开空白 Dock 让用户从头配（不预填、不阻断、不报错），uploaded 节点也能触发新生成。

### REQ-11 derived 预留（P3）
`NodeOrigin` 含 "derived"；`DerivedRecipe = GenerationRecipe & { transform, sourceNodeId?, sourceAssetId? }`。本轮不实现派生动作（toolbar 占位），仅类型就位。

## Scenarios

### Scenario：上传音频 → recipe=uploaded
- **Given** 用户上传一个 audio 文件
- **When** `handleFileChange` 建音频节点
- **Then** 节点 `recipe` = `{ origin: "uploaded" }`，无 generation

### Scenario：图片生成 → recipe 冻结 model+参数+prompt 输入
- **Given** 文本节点 T（prompt="猫"）经 prompt handle 连到图片占位节点 N，BottomDock 选 model=m1 / 比例 16:9 / 分辨率 1080p / 数量 1
- **When** 生成成功（onImage 首图）
- **Then** N.recipe = `{ origin:"generated", generation:{ mediaKind:"image", model:"m1", params:{aspectRatio:"16:9",resolution:"1080p",quantity:1}, inputs:{ prompt:{kind:"text", nodeId:T.id, text:"猫"} }, jobId } }`

### Scenario：视频首帧溯源——画布内节点 vs 上传素材
- **Given** 视频节点 V 生成时首帧分别来自①画布图片节点 I ②Dock 上传素材（assetId=a9）
- **When** 生成成功
- **Then** ① V.recipe.generation.inputs.firstFrame = `{kind:"image", nodeId:I.id, ...}` ② = `{kind:"image", assetId:"a9", ...}`（无 nodeId）

### Scenario：recipe 持久化 round-trip
- **Given** 一个 generated 图片节点带完整 recipe
- **When** serialize → parse
- **Then** 还原节点 recipe 与原深相等（origin/mediaKind/model/params/inputs/jobId 全保留）

### Scenario：老 /canvas 读带 recipe 的画布 JSON 不崩
- **Given** v2 存了带 recipe 的 nodes_json
- **When** 老 `/canvas` 加载（读已知字段，忽略 recipe）
- **Then** 不抛异常，节点按 image/video/text 正常渲染（recipe 被忽略）

### Scenario：老数据无 recipe 正常加载
- **Given** 老画布数据（节点无 recipe 字段）
- **When** v2 parse
- **Then** 节点 recipe=undefined，渲染不阻塞，不报错

### Scenario：重新生成同参数（P2）
- **Given** 节点 N 有 generated recipe（model=m1, 比例 16:9）
- **When** 用户点 N toolbar「重新生成」
- **Then** BottomDock 预填 model=m1 / 比例 16:9 / 重解析当前 prompt 输入；用户可改后重跑 → 产新节点（origin=generated 或 derived.regenerate, sourceNodeId=N）

### Scenario：上传节点重新编辑（软降级，P2）
- **Given** 节点 U recipe.origin="uploaded"（无 generation）
- **When** 用户点 U toolbar「重新编辑」
- **Then** 开空白 Dock（不预填参数），用户可从头配新生成；不阻断、不报错（实现取舍：比"禁用入口"更友好，uploaded 也能再生成）

### Scenario：节点删除后仍可重生成（输入兜底）
- **Given** 节点 N 的 prompt 输入来自文本节点 T（recipe.inputs.prompt.nodeId=T, text="猫"），后 T 被删
- **When** 重新生成 N
- **Then** 回退 recipe.inputs.prompt.text="猫" 作为 prompt，重生成仍可进行
