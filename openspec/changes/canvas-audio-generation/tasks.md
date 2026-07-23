# Tasks：AI 音频生成入口（mock）

> P1 = 本 change（前端占位 + mock 生成）。P2 = 后端真音频生成（另工单）。TDD（vitest）。
> 文件均在 `blue_whale_web/`。

## P1 — 前端占位 + mock

- [ ] T1 `v2/nodes.tsx`：新增 `AudioPlayer`（仿 VideoPlayer，AudioLines + 自定义控制条：播放/暂停 + 进度 seek + 当前/总时长；`<audio>` 隐藏 + nodrag/nopan 隔离）。`MediaStateBody` audio 分支升级：有 src → AudioPlayer；无 src → 占位。
  - 测试：`v2/nodes.test.tsx` audio 有 src 渲染 `<audio>` + 控制条 testid；无 src 渲染占位；image/video 回归不破。
- [ ] T2 `components/dock/AudioDockContent.tsx`（新，仿 VideoDockContent）：prompt 编辑器（mention）+ 模型下拉（mock）+ 时长/采样率/格式 + 参考区 + 从画布选 + 生成。`types.ts` 加 `AudioGenerateSettings`。
- [ ] T3 `components/dock/BottomDock.tsx`：`bottomDockMode` 加 `"audio"` + 按 mode 渲染 AudioDockContent。`page.tsx handleToolClick("audio")` 改开 Dock（移除上传）。
  - 测试：BottomDock 按 mode 分发（纯逻辑/渲染测试）。
- [ ] T4 `api/generation.ts`：`generateAudio(args)` **mock**（delay + 固定 sample url + 假 assetId，签名对齐 generateImage）。`page.tsx handleGenerate` 加 audio 路径（running 占位 → done + AudioPlayer + recipe via buildGenerationRecipe）。`AudioGenParams` 具化 {duration?,sampleRate?,format?}。
  - 测试：generateAudio mock 返回固定 url/assetId + 不发真请求（fetch mock 断言未调）；buildGenerationRecipe audio 字段。
- [ ] T5 从画布选参考（audio Dock picking）：`pickingFor` 加 `"audio"`，audio Dock「从画布选择」→ 选图/视/音节点入参考区。
- [ ] T6 mock sample fixture：`public/audio/sample.mp3`（小文件）或 remote sample 占位（标注 TODO 换 fixture）+ 可选 UI「模拟生成」标识。

## 验证

- [ ] `npx vitest run`（nodes/BottomDock/generation/engine 全绿，新增 audio 播放/mock 测试）。
- [ ] `npx tsc --noEmit`（改动文件零错）。
- [ ] dev `/canvas-v2` round-trip：左「音频」→ 音频 Dock → 填 prompt 生成 → 画布 audio 节点（running→done 可播放 sample）；上传音频能播；图/视 Dock 无回归；刷新 recipe 在。

## P2 — 后端真音频生成（另开工单，不在本 change）

- [ ] 后端：音频生成 provider 选型（TTS / 音乐生成）+ job 链路（GenerationJob type=audio）+ asset 落库（type=audio, source=generated）+ catalog 加音频模型/参数。
- [ ] 前端：`generateAudio` mock impl → 真请求（签名不变）；AudioDockContent 模型下拉 mock → catalog；UI「模拟生成」标识移除。
