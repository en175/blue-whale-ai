# Design：AI 音频生成入口（IJZY1D）

> 关联 IJZY0Z（音频节点承载已就绪）、`node-recipe-provenance`（recipe 模型已支持 audio）、`VideoDockContent`（音频 Dock 仿它）。
> 本文：4 个组件设计 + mock 策略 + 后端契约预留 + 决策。

## 1. AudioPlayer（音频节点可播放）

仿 `VideoPlayer`，去掉画面，留控制条：
```
[AudioLines 大图标（上）]
[播放/暂停] [─────进度条─────] [00:03 / 00:12]
```
- `<audio ref>` 隐藏（不放原生 controls，自定义控制条 nodrag/nopan 隔离 RF 拖拽，与 VideoPlayer 同理）。
- 播放/暂停 toggle、进度 seek（pointerDown/Move/Up，复用 VideoPlayer 的 seekTo 逻辑）、`onTimeUpdate`/`onLoadedMetadata` 更新 current/duration。
- 复用 `formatTime`。
- 无 src（uploaded 但 asset 还没 ensureAsset 完成，或 mock 未落）→ 回退占位（AudioLines + 名）。
- AudioPlayer 纯展示 + audio 元素，无 RF/store 依赖，可单测（同 MediaStateBody）。

`MediaStateBody` audio 分支：`src` 有 → `<AudioPlayer src label=content>`；无 src → 占位（AudioLines + 名）。status error/running 分支在前（通用）。

## 2. AudioDockContent（音频 Dock）

仿 `VideoDockContent` 结构，字段按音频生成调：
- **prompt 编辑器**（contentEditable + mention pill，复用 `dock/mention.ts`）：支持 @画布节点（图/视/音）作参考。
- **音频模型下拉**（mock）：mock 列表（如 `mock-tts-v1` / `mock-music-v1`），后端就绪换 catalog。
- **参数**：时长（秒，mock 选项 5/10/30）、采样率（mock 选项）、格式（mp3/wav mock）。
- **参考素材区**：本地上传音频 + 「从画布选择」（图/视/音节点）。
- **生成按钮** → `onGenerate(audioSettings)` → page `handleGenerate` audio 路径。

Props 形状仿 `VideoDockContentProps`，新增 `AudioGenerateSettings`（model/duration/sampleRate/format）。

## 3. 左工具条「音频」按钮 → 音频 Dock

`page.tsx handleToolClick("audio")`：从当前「上传」改为 `setBottomDockMode("audio") + setIsBottomDockOpen(true)`（与 ai-image/ai-video 一致）。
`bottomDockMode` 类型 `"image" | "video"` → `"image" | "video" | "audio"`。
`BottomDock` 按 mode 渲染 `AudioDockContent`。
（原「音频」按钮的上传行为移除——上传走通用「上传」按钮 + Dock 内本地上传。）

## 4. mock generateAudio + 生成流

### `generation.ts generateAudio`（mock）
```ts
// 形状对齐 generateImage（后端就绪切真请求，签名不变）
export async function generateAudio(args: {
  prompt: string; projectId: number; modelId: string;
  duration?: number; sampleRate?: number; format?: string;
  referenceAudios?: string[]; referenceImages?: string[]; referenceVideos?: string[];
}): Promise<{ url: string; assetId: number; jobId?: number }>
```
- **当前 mock**：`await delay(1500)` 模拟生成延迟；返回**固定 sample audio url** + 假 assetId（如 `Date.now()`）。
- sample audio 来源（决策 3）：public fixture（`blue_whale_web/public/audio/sample.mp3`）最可靠；实现时放一个极小 sample mp3。暂无 fixture 则用 remote public sample（标注临时）。
- 后端就绪：impl 改为 `apiRequest("/api/agent/generate", { type:"audio", ... })` 或专用 audio endpoint，签名不变。

### page `handleGenerate` audio 路径
```
mode === "audio":
  placeholderId = addNode("audio", { width:240, height:120, data:{content:prompt, status:"running"} })
  result = await generateAudio({prompt, projectId, modelId, duration, ..., referenceAudios/Images/Videos})
  setNodeAsset(placeholderId, String(result.assetId), "audio", result.url, "generated",
               buildGenerationRecipe({mediaKind:"audio", model:modelId, params:{duration,sampleRate,format}, inputs:{prompt, references}}))
```
running 占位（spinner「生成中…」）→ done（AudioPlayer 可播放）。

## 5. recipe（audio generated）

mock 生成写 recipe（`buildGenerationRecipe` 已支持 mediaKind=audio）：
- `origin:"generated"`, `generation:{mediaKind:"audio", model, params:AudioGenParams{duration,sampleRate,format}, inputs:{prompt:{text}, references:[...]}, jobId, generatedAt}`。
- `AudioGenParams` 当前 `{[key]:unknown}`，本 change 用 `{duration?, sampleRate?, format?}`（具化）。
- 重新编辑（refresh）audio 节点 → `recipeToDockPrefill` 回填音频 Dock（model/duration/...）。

## 关键决策

### 1. mock 不上真后端，但契约对齐 generateImage
`generateAudio` 签名/返回形状与 `generateImage` 一致（`{url, assetId}`），后端就绪仅切 impl。mock 用固定 sample + 延迟，不调任何真 API。

### 2. mock sample audio 用 public fixture
`public/audio/sample.mp3`（仓库内小文件，可靠、离线可用）。优于 remote sample（跨域/不稳）和 data URI（无意义）。实现时放入 fixture（或先用 remote 占位，标注 TODO 换 fixture）。

### 3. AudioPlayer 自定义控制条（非原生 controls）
原因同 VideoPlayer：原生 `<audio controls>` 是 shadow DOM，无法局部加 nodrag 隔离 RF 拖拽 → 节点拖不动。自定义控制条 nodrag/nopan 是「节点可拖 + 控制条可用」唯一兼容解。复用 VideoPlayer 的 seek/formatTime。

### 4. 左「音频」按钮从上传改开 Dock
B 要求「按钮 → 音频 Dock」。原上传行为（IJZY0Z 临时接的）移除；上传走通用「上传」+ Dock 内本地上传。`bottomDockMode` 加 `audio`。

### 5. UI 标「模拟生成」（可选）
mock 阶段生成的是 sample（非 prompt 真生成）。建议 AudioDockContent 或生成按钮加轻量「模拟」标识，避免误解。可选，不阻塞。

### 6. 从画布选参考（audio Dock picking）
复用现有 `pickingFor` 机制（image/video）扩到 audio：audio Dock「从画布选择」→ `setPickingFor("audio")` → 点画布节点 → 入 audio Dock 参考区。可选图/视/音节点（B 要求「图/视/音作参考」）。

## 落地点

| 组件 | 文件 | 动作 |
|---|---|---|
| AudioPlayer | `v2/nodes.tsx` | 新增 AudioPlayer + MediaStateBody audio 分支升级（src→player，无 src→占位）|
| AudioDockContent | `components/dock/AudioDockContent.tsx` | 新组件（仿 VideoDockContent）|
| BottomDock audio 模式 | `components/dock/BottomDock.tsx` | mode 类型加 audio + 渲染 AudioDockContent |
| 左按钮接线 | `v2/page.tsx` | handleToolClick("audio") 改开 Dock；handleGenerate 加 audio 路径；bottomDockMode 加 audio |
| mock generateAudio | `api/generation.ts` | generateAudio mock impl |
| recipe audio | `engine.ts`/`page.tsx` | buildGenerationRecipe audio（已支持）+ AudioGenParams 具化 |
| 类型 | `types.ts` | AudioGenerateSettings + DockPrefill audio 字段 |
| fixture | `public/audio/sample.mp3` | mock sample（放入或 remote 占位）|
