# Design：跨模态创作（点击式，IJZY24）

> 关联 `kinds.ts`（ports 声明，D 不用）/ `engine.ts`（连线，D 不触发）/ `model` recipe（inputs.references 跨 kind）/ `config` toolbar / `page` handleNodeAction。
> 本文：跨模态 action 矩阵 + picking.accept + mock 边界 + 分层 + 决策。

## 1. 跨模态 action 矩阵（点击式，toolbar 按 kind）

| 源 kind | action | 目标 Dock | 带参考（DockMediaItem） | 真实/mock |
|---|---|---|---|---|
| 图片 | 生成视频 | video | `videoDockMedia[{type:image,src}]` | 真实（createVideoJob referenceImages） |
| 图片 | 生成音频 | audio | `audioDockMedia[{type:image,src}]` | **mock**（generateAudio） |
| 视频 | 提取音频 | (派生) | 占位 derived 节点 | **mock/占位**（后端待） |
| 视频 | 生成视频 | video | `videoDockMedia[{type:video,src}]` | 真实 |
| 音频 | 生成视频 | video | `videoDockMedia[{type:audio,src}]` | 真实（referenceAudios） |

（图片「生成图片」/视频「生成图片」已有，非跨模态但保留。）

`handleNodeAction` 新 case：
- `audio`（生成音频）→ `setBottomDockMode("audio") + setAudioDockMedia([本节点]) + open` [mock]
- `extract-audio`（提取音频）→ 占位（提示 / mock derived 节点，后端待）
- `video`（生成视频，已有 case）→ 按 `node.kind` 设参考 type（图→image / 视→video / 音→audio 进 videoDockMedia）

## 2. picking.accept（Dock 维度过滤，独立于 kinds ports）

Dock mode → 允许选的节点类型：

| Dock mode | accept |
|---|---|
| image | `[image]` |
| video | `[image, video, audio]` |
| audio | `[image, video, audio]` |

纯函数 `dockAccept(mode): MediaKind[]`（page 或 utils）。`MediaNode.pickable = picking && node.kind ∈ dockAccept(pickingDockMode)`。

**不挂 kinds ports.accept**（那是连线式校验，D 点击式用 Dock 维度）。

## 3. recipe 跨模态（复用，不改模型）

生成后 `recipe.inputs.references` 记跨 kind（`[{kind, url}]`）。已有机制（`buildGenerationRecipe` inputs.references）。D 复用，不动 recipe 模型。

例：图→生成视频，recipe.inputs.references=`[{kind:"image",url:"..."}]`（溯源：这视频来自哪张图）。

## 4. 参考素材 Dock 展示（DockMediaThumb 扩）

`parts.tsx` DockMediaThumb 按 `item.type` 渲染：
- image → `<img>` 缩略图（现有）。
- video → 首帧（`<video preload="metadata">` 或 poster；现占位 VideoIcon，可优化首帧）。
- audio → AudioLines 占位（现有 DockMediaThumb 对 audio 走图标）。

## 5. mock 边界

- 音频生成：`generateAudio` mock（B 已有，固定 sample + 延迟）。
- 提取音频：占位（提示「提取音频：后端未接入」或 mock 一个 derived audio 节点 `origin=derived transform=extract-audio sourceNodeId`）。

## 关键决策

### 1. 点击式不开连线
`SHOW_WORKFLOW_UI=false` 保持。跨模态走 Dock 参考（点击 action 带参考），不引入 edges/工作流 UI。轻量，覆盖 D acceptance。

### 2. picking.accept 独立 Dock 维度
不挂 kinds ports.accept（连线式）。Dock mode → 允许类型（page 纯函数）。点击式过滤用这个。

### 3. 跨模态 action 矩阵在 config toolbar（声明式）
按 kind 的 toolbar 配置（声明跨模态 action）。加跨模态（如未来「音频配音频」）= 加 toolbar action + handleNodeAction case。

### 4. recipe 统一（点击式 url / 连线式 nodeId）
D 点击式 → recipe.inputs.references（url）。后续连线式 → recipe.inputs.x.nodeId。同一 recipe，两种交互溯源。

### 5. 音频/提取 mock 或占位
后端无音频生成 provider（B 已 mock）+ 无提取音频（派生占位）。D 不阻塞（mock 兜底）。

## 分层（D 在 L5，底座不动）

| 层 | 文件 | D 改动 |
|---|---|---|
| L5 业务 | config.tsx | toolbar 按 kind（图加生成音频/视加提取音频/新 AUDIO_ACTIONS） |
| L5 业务 | nodes.tsx | MediaNode 按 kind 选 toolbar + pickable 按 accept |
| L5 业务 | page.tsx | handleNodeAction 跨模态 + picking.accept（dockAccept） |
| L5 业务 | parts.tsx | DockMediaThumb 视首帧/音占位 |
| L0-L3 底座 | kinds/engine/model/recipe | **零改** |

## 落地点

| 任务 | 文件 | TDD 测试 |
|---|---|---|
| T1 toolbar 按 kind | config.tsx | toolbar 配置纯数据测（image/video/audio 各自 action） |
| T2 MediaNode 选 toolbar | nodes.tsx | 按 kind 选对 toolbar（纯逻辑/组件测） |
| T3 handleNodeAction 跨模态 | page.tsx | 抽 `buildCrossmodalRefill(node, action)` 纯函数测 |
| T4 picking.accept | page/utils | `dockAccept(mode)` 纯函数测 + pickable 过滤 |
| T5 参考展示 | parts.tsx | DockMediaThumb 按 type 渲染（视首帧/音占位） |
| T6 Agent @ 视音 | mention | 验证 mention type image/video/audio |
