# Spec：crossmodal-creation

> 点击式跨模态创作（IJZXW7-D / IJZY24）。**不开连线**（`SHOW_WORKFLOW_UI=false`）；跨模态走点击 action → Dock 带参考。音频生成 + 提取音频 mock/占位（后端待）。纯 L5 业务，底座零改。
> 关联：`node-recipe-provenance`（recipe.inputs.references 跨 kind）、IJZY0Z/1D/1V。

## Requirements

### REQ-1 工具栏按 kind 动态跨模态入口
节点 toolbar 按媒介类型显示跨模态生成 action：图片→「生成视频」「生成音频」；视频→「提取音频」「生成视频」；音频→「生成视频」。非跨模态 action（重新编辑/下载/添加到对话）保留。

### REQ-2 点击跨模态唤起 Dock + 带参考
点跨模态 action → 自动唤起目标 Dock（设 mode + open）+ 把当前节点作为参考带入对应 Dock media：生成视频→`videoDockMedia`（按 node.kind 设 type）；生成音频→`audioDockMedia`。

### REQ-3 提取音频占位（mock）
视频「提取音频」→ 占位反馈（提示「后端未接入」或 mock 一个 derived audio 节点 `origin=derived transform=extract-audio`）。不接真后端。

### REQ-4 picking.accept 按 Dock 类型过滤
「从画布选」按 Dock mode 过滤可选节点：图 Dock `[image]`；视/音 Dock `[image,video,audio]`。`MediaNode.pickable` 按允许类型过滤。纯函数 `dockAccept(mode)`。

### REQ-5 参考素材按类型展示
DockMediaThumb 按 `item.type` 渲染：image→缩略图；video→首帧（`<video preload>` 或占位）；audio→AudioLines 占位。

### REQ-6 Agent 对话能 @ 视/音节点
mention 支持视频/音频节点（type image/video/audio），@ 进对话让 Agent 基于该素材创作。

### REQ-7 现有节点操作不破坏
重新编辑（recipe 预填）/ 下载 / 添加到对话 / 生成图片 / 生成视频（同模态）等现有 action 行为零回归。

### REQ-8 不开连线 + 底座不动 + 音频 mock
`SHOW_WORKFLOW_UI=false` 保持；kinds/engine/model/recipe 零改；音频生成 `generateAudio` mock + 提取音频占位。

## Scenarios

### Scenario：图片节点工具栏有跨模态入口
- **Given** 选中一个图片节点
- **Then** toolbar 出现「生成视频」「生成音频」（+ 重新编辑/下载/添加到对话）

### Scenario：视频→生成视频（带视频参考）
- **Given** 选中视频节点 V
- **When** 点「生成视频」
- **Then** 唤起视频 Dock + `videoDockMedia=[{type:"video",src:V.src}]`

### Scenario：图片→生成音频（mock）
- **Given** 选中图片节点 I
- **When** 点「生成音频」
- **Then** 唤起音频 Dock + `audioDockMedia=[{type:"image",src:I.src}]`；生成走 `generateAudio` mock

### Scenario：视频→提取音频（占位）
- **Given** 选中视频节点 V
- **When** 点「提取音频」
- **Then** 占位反馈（提示后端未接入 / mock derived audio 节点），不崩

### Scenario：图片 Dock 从画布选只选图片
- **Given** 图片 Dock「从画布选择」
- **Then** 只有图片节点 pickable（video/audio 不可选）

### Scenario：视频 Dock 从画布选可选图/视/音
- **Given** 视频 Dock「从画布选择」
- **Then** 图/视/音节点都可 pickable

### Scenario：参考素材按类型展示
- **Given** Dock 参考区有图/视/音素材
- **Then** 图显缩略图、视频显首帧、音频显 AudioLines 占位

### Scenario：Agent @ 视频节点
- **Given** Agent 对话 + 画布有视频节点
- **When** @ 该视频节点
- **Then** 视频节点引用进对话（type=video）

### Scenario：现有操作不破坏
- **Given** 跨模态入口新增
- **When** 用重新编辑/下载/添加到对话/生成图片
- **Then** 行为不变

### Scenario：不开连线 + 音频 mock
- **Given** D 实现
- **Then** `SHOW_WORKFLOW_UI=false`（无连线 UI）；音频生成走 `generateAudio` mock；底座（kinds/engine/model/recipe）零改
