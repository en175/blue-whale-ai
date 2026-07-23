# Spec：audio-generation-entry

> AI 音频生成前端入口（IJZXW7-B / IJZY1D）。**生成能力当前 mock**（后端无音频生成 provider）；真生成待后端工单，就绪后切 `generateAudio` impl（契约不变）。
> 关联 `node-recipe-provenance`（audio generated recipe）、IJZY0Z（音频节点承载）。

## Requirements

### REQ-1 音频节点可播放
audio 节点有 src 时渲染 `AudioPlayer`（自定义控制条：播放/暂停 + 进度 seek + 当前/总时长），不放原生 `<audio controls>`（shadow DOM 无法隔离 RF 拖拽）。无 src → 占位（AudioLines + 名）。

### REQ-2 左「音频」按钮唤起音频 Dock
`handleToolClick("audio")` = `setBottomDockMode("audio") + 开 Dock`（与 ai-image/ai-video 一致），不再触发上传。`bottomDockMode` 加 `"audio"`。

### REQ-3 音频 Dock 完整
`AudioDockContent`：prompt 编辑器（mention pill）+ 音频模型下拉（mock 列表）+ 时长/采样率/格式参数 + 参考素材区 + 生成按钮。仿 `VideoDockContent`。

### REQ-4 本地上传音频沉淀
音频 Dock 本地上传音频 → 进 Dock 参考区 **且** 画布生成 audio 节点（一处上传多处用，同 image/video 上传沉淀）。

### REQ-5 从画布选参考
音频 Dock「从画布选择」→ 可选图/视/音节点作参考（复用 picking 机制扩 audio 维度）。

### REQ-6 mock 生成 → 可播放节点 + recipe
点生成 → 建 audio running 占位 → `generateAudio`（mock：延迟 + sample url + 假 assetId）→ done 后 AudioPlayer 可播放 + 写 `recipe={origin:"generated", generation:{mediaKind:"audio", model, params, inputs, jobId}}`。

### REQ-7 生成占位反馈
生成中（running spinner「生成中…」）/ 失败（error + 重试）/ 完成（done 可播放）三态在画布节点上有占位反馈。

### REQ-8 图/视 Dock 不破坏
现有 image/video Dock 行为零回归（BottomDock 按 mode 分发，audio 模式新增不影响）。

### REQ-9 generateAudio mock + 契约预留（后端边界）
`generateAudio(args) → {url, assetId}` 当前 **mock**（固定 sample + 延迟，不调真 API）；签名/返回对齐 `generateImage`，后端音频生成就绪后仅切 impl。

## Scenarios

### Scenario：上传音频节点可播放
- **Given** 一个 uploaded audio 节点（有 assetId/src）
- **When** 渲染
- **Then** 显示 AudioPlayer（播放/暂停 + 进度 + 时长），点播放能播

### Scenario：左「音频」按钮开音频 Dock
- **Given** 画布页
- **When** 点左工具条「音频」
- **Then** 底部弹出音频 Dock（非上传对话框）

### Scenario：音频 Dock 本地上传 → 参考区 + 画布节点
- **Given** 音频 Dock 打开
- **When** 本地上传 a.mp3
- **Then** a.mp3 进 Dock 参考区 + 画布新增 audio 节点（uploaded）

### Scenario：mock 生成音频 → 可播放 + recipe
- **Given** 音频 Dock 填 prompt + 模型 + 时长，点生成
- **When** mock generateAudio 完成
- **Then** 画布 audio 节点（running 占位 → done）可播放（sample）+ recipe.origin="generated" / mediaKind="audio" / params{duration,...} / inputs.prompt.text

### Scenario：mock 生成失败 → 占位 + 重试
- **Given** mock 生成抛错
- **Then** 节点 error 占位 + 重试按钮

### Scenario：从画布选参考（音频 Dock）
- **Given** 音频 Dock「从画布选择」
- **When** 点画布一个图片节点
- **Then** 该图进音频 Dock 参考区

### Scenario：图/视 Dock 无回归
- **Given** audio 模式新增
- **When** 用 image/video Dock 生成
- **Then** 行为不变

### Scenario：generateAudio mock 不调真后端（后端边界）
- **Given** 当前实现
- **When** 调 generateAudio
- **Then** 返回固定 sample url + 假 assetId（mock），不发真生成请求；后端就绪后切 impl 签名不变
