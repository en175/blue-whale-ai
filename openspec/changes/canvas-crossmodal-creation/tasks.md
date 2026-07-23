# Tasks：跨模态创作（点击式，TDD）

> P1 = 本 change（点击式跨模态，不开连线）。全程 TDD（先红测后实现）。音频生成/提取 mock 或占位。文件均在 `blue_whale_web/`。

## P1 — 点击式跨模态

- [ ] T1 `config.tsx` toolbar 按 kind：
  - NODE_TOOLBAR_ACTIONS（图片）加 `{id:"audio", label:"生成音频"}`。
  - NODE_TOOLBAR_VIDEO_ACTIONS（视频）加 `{id:"extract-audio", label:"提取音频"}`。
  - 新 `NODE_TOOLBAR_AUDIO_ACTIONS`（audio 节点：重新编辑 + 生成视频 + divider + info/download/mention）。
  - **TDD**：`config.test.tsx`——测三个 toolbar 各自含对 action（图片含 audio；视频含 extract-audio；audio 含 video 不含 audio/extract-audio）。
- [ ] T2 `nodes.tsx` MediaNode 按 kind 选 toolbar：
  - `isAudio → NODE_TOOLBAR_AUDIO_ACTIONS`；`isVideo → NODE_TOOLBAR_VIDEO_ACTIONS`；else `NODE_TOOLBAR_ACTIONS`。
  - **TDD**：抽纯函数 `toolbarForKind(kind)` → action[]，单测；MediaNode 用它。
- [ ] T3 `page.tsx` handleNodeAction 跨模态：
  - 抽纯函数 `buildCrossmodalRefill(node, actionId)` → `{ mode?: "image"|"video"|"audio", media?: DockMediaItem, derived?: boolean }`（图→生成视频: mode=video+media[image]；图→生成音频: mode=audio+media[image]；视→生成视频: mode=video+media[video]；音→生成视频: mode=video+media[audio]；视→提取音频: derived=true）。
  - handleNodeAction 用 buildCrossmodalRefill：设 mode + media + open；derived → 占位。
  - `video` case 改按 node.kind 设参考 type。
  - **TDD**：`buildCrossmodalRefill` 纯函数测（矩阵全覆盖）。
- [ ] T4 `picking.accept`（Dock 维度过滤）：
  - 纯函数 `dockAccept(mode): MediaKind[]`（image→[image]；video/audio→[image,video,audio]）。
  - page：picking 时记 pickingDockMode；`MediaNode.pickable = picking && node.kind ∈ dockAccept(pickingDockMode)`。
  - **TDD**：`dockAccept` 纯函数测 + pickable 过滤（图 Dock picking 时 video/audio 不 pickable）。
- [ ] T5 `parts.tsx` DockMediaThumb 按类型展示：
  - image→`<img>`（现有）；video→`<video preload="metadata">` 首帧或 VideoIcon 占位；audio→AudioLines 占位。
  - **TDD**：DockMediaThumb 按 item.type 渲染对元素（组件测）。
- [ ] T6 Agent @ 视音（mention）：
  - 验证 mention 支持 type image/video/audio（已有 DockMediaItem.type）；@ 视音节点进对话。
  - **TDD**：mention type 覆盖测（或 dev 验证）。

## 验证

- [ ] `npx vitest run`（config/nodes/page 纯函数/parts 测试全绿）。
- [ ] `npx tsc --noEmit`（改动文件零错）。
- [ ] dev `/canvas-v2` round-trip：图→生成视频/音频（mock）；视→提取音频（占位）/生成视频；音→生成视频；图 Dock 从画布选只图；视/音选图视音；参考按类型展示；Agent @ 视音；现有操作不破坏。

## P2 — 连线式（后续，开连线时，不在本 change）

- [ ] edges 驱动跨模态（resolveInputs）+ ports.accept 校验 + isValidConnection。
- [ ] kinds ports 补全（audio 加 image port 图生音频；video 加 video-ref 视频生视频）。
- [ ] `SHOW_WORKFLOW_UI=true`。
