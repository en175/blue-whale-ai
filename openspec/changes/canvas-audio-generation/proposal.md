# Proposal：AI 音频生成入口（IJZXW7-B / IJZY1D）

> **策略**：后端目前**无音频生成** provider/job（只有 image/video generation）。本 change 做**前端占位 + mock 生成**——搭起 B 的完整前端骨架（入口 + 音频 Dock + 可播放音频节点 + 生成流），生成能力用前端 mock 兜住；**真音频生成另开后端工单**，就绪后把 mock 切成真请求（接口形状预留一致）。

## Why

IJZXW7-B 要求「AI 音频生成入口」：左工具条按钮 → 音频 Dock（提示词/模型/时长/采样率/格式 + 参考素材）→ 生成可播放音频节点。但后端无音频生成能力（assets 表无 generated audio，generation 只有 image/video）。强行等后端会阻塞前端。

故：前端先把 B 的入口/Dock/播放/生成流做实，生成用 **mock**（前端 sample audio + 模拟延迟），让整个音频创作链路可视化、可演示、可联调前端逻辑；后端音频生成（provider 选型/ job 链路）独立工单推进，就绪后仅切 `generateAudio` 实现即可（契约不变）。

## What Changes

- **音频节点可播放**（B #6）：`MediaStateBody` audio 分支从「占位」升级为 `AudioPlayer`（播放/暂停 + 进度条 + 总时长/当前进度），上传/mock 生成的音频都能播。
- **音频 Dock**：新增 `AudioDockContent`（仿 `VideoDockContent`）：prompt 编辑器（mention pill 参考）+ 音频模型下拉（mock 列表）+ 时长/采样率/格式参数 + 参考素材区 + 「从画布选择」。
- **左工具条「音频」按钮**：`handleToolClick("audio")` 从「上传」改为「唤起音频 Dock」（BottomDock 加 `audio` 模式）。
- **mock 生成流**：`generation.ts` 加 `generateAudio(args)`（**当前 mock 实现**：返回 sample audio url + 模拟 assetId + setTimeout 延迟），page 层 `handleGenerate` 加 audio 路径（建 running 占位 → done + 可播放 + recipe）。
- **recipe**：mock 生成也写 `recipe={origin:"generated", generation:{mediaKind:"audio", model:"mock-audio", params:{duration,...}, inputs:{prompt, references}}}`，保持溯源链完整。
- **后端契约预留**：`generateAudio` 接口形状对齐 `generateImage`（`{prompt, projectId, modelId, params, referenceAudios/...} → {url, assetId}`），后端就绪后改 impl 不改签名。

## Capabilities

### New Capabilities

- `audio-generation-entry`：AI 音频生成前端入口——左按钮唤起音频 Dock（prompt/模型/时长/采样率/格式/参考）+ 音频节点可播放（AudioPlayer）+ mock 生成流（running 占位→done 可播放+recipe）+ 从画布选参考。**生成能力当前 mock，真生成待后端工单**。

### Modified Capabilities

- `node-recipe-provenance`：audio generated recipe（mediaKind=audio + AudioGenParams + inputs）随 mock 生成写入（recipe 模型已支持 audio，本 change 补写入点）。

## Impact

- 前端 `v2/nodes.tsx`（AudioPlayer + MediaStateBody audio 升级）、`components/dock/AudioDockContent.tsx`（新）+ `BottomDock.tsx`（audio 模式）、`v2/page.tsx`（左按钮 + handleGenerate audio 路径 + mock）、`api/generation.ts`（`generateAudio` mock）、`types.ts`（音频生成 settings/prefill）。
- **后端零改**（mock）；真音频生成 provider/job/asset 链路属独立后端工单（Blocked-by 关系：本 change mock 不阻塞，真生成就绪后切 impl）。
- recipe：audio generated 节点持久化（serialize 已保 recipe），向前兼容（老 audio=uploaded 节点不受影响）。

## Phasing

- **P1（本 change）**：AudioPlayer + 音频 Dock + 左按钮接线 + mock generateAudio + recipe + 从画布选参考。整链路 mock 可跑。
- **P2（后端工单，另开）**：真音频生成 provider（TTS/音乐?）+ job 链路 + asset 落库；前端切 `generateAudio` mock→真。
- **P3（可选）**：音频 Dock 参数项随真 provider 契约细化（采样率/格式等真参数）。

## 后端边界（重要）

本 change **不实现真音频生成**。`generateAudio` 是 mock（固定 sample + 延迟）。UI 上 mock 阶段建议加轻量「模拟生成」标识（可选，避免用户误以为真生成）。后端音频生成能力就绪前，mock 结果是 sample audio（非用户 prompt 真生成）。
