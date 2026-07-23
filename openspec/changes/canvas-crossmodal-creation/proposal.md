# Proposal：跨模态创作（点击式，IJZXW7-D / IJZY24）

> **策略**：**点击式**跨模态（不开连线，`SHOW_WORKFLOW_UI=false` 保持）。节点工具栏按媒介动态显示跨模态生成入口，点击一键唤起对应 Dock 并带入本节点作参考；「从画布选」按 Dock 类型过滤。纯 L5 业务，底座（kinds/engine/model/recipe）零改。音频生成 + 提取音频走 mock/占位（后端待接）。

## Why

IJZXW7-D 要求打通图/视/音节点互相作参考（图生视频/音频、视频提音频、音频配视频）。当前：
- 节点工具栏隔离（图片/视频固定 toolbar，audio 用图片 toolbar），无跨模态一键入口。
- 「从画布选」不过滤类型（任何节点可入任何 Dock）。
- 参考素材 Dock 内只图缩略图，视/音展示缺。

点击式（不开连线）：用户点节点工具栏跨模态 action → 自动唤起目标 Dock + 带本节点作参考 → 补 prompt 生成。比连线式轻（不引入工作流 UI 复杂度），覆盖 D 全部 acceptance；后续开连线时点击式与连线式统一到 recipe.inputs。

## What Changes

- **工具栏按 kind 动态跨模态入口**（`config.tsx`）：图片 toolbar 加「生成音频」；视频 toolbar 加「提取音频」；新增 audio toolbar（「生成视频」）。
- **MediaNode 按 kind 选 toolbar**（`nodes.tsx`）：`isAudio→AUDIO_ACTIONS` / `isVideo→VIDEO_ACTIONS` / else `ACTIONS`。
- **handleNodeAction 跨模态 action**（`page.tsx`）：`generate-video`（→视 Dock 带本节点参考）/ `generate-audio`（→音 Dock 带参考，mock）/ `extract-audio`（→派生占位，mock）；`video` action 按 node.kind 带参考类型。
- **picking.accept 过滤**（page + nodes）：Dock mode → 允许类型（图 `[image]`，视/音 `[image,video,audio]`）；`MediaNode.pickable` 按 accept 过滤。
- **参考素材 Dock 展示**（`parts.tsx` DockMediaThumb）：图缩略图（现有）/ 视首帧 / 音占位。
- **Agent @ 视音**（mention）：mention 已支持 type，验证视音节点能 @ 进对话。
- **recipe 跨模态**：生成后 `recipe.inputs.references` 记跨 kind 引用（已有机制，D 复用）。

## Capabilities

### New Capabilities

- `crossmodal-creation`：点击式跨模态——节点 toolbar 按 kind 动态跨模态入口 + 点击唤起 Dock 带参考 + picking.accept 按类型过滤选 + 参考素材按类型展示 + Agent @ 视音。

### Modified Capabilities

（无——纯 L5 业务，底座不动）

## Impact

- 前端 `config.tsx`（toolbar 按 kind）/ `nodes.tsx`（MediaNode 选 toolbar + pickable 过滤）/ `page.tsx`（handleNodeAction 跨模态 + picking.accept）/ `parts.tsx`（DockMediaThumb 视首帧/音占位）。
- **底座零改**：kinds / engine / model / recipe / `SHOW_WORKFLOW_UI` 不动。
- **mock 边界**：音频生成（`generateAudio` mock，B 已有）+ 提取音频（派生占位 `origin=derived`，后端待接）。
- 真实：图/视频生成（后端）/ 上传。

## 边界

- **不开连线**（`SHOW_WORKFLOW_UI=false`）。跨模态走点击式（Dock 参考），不走 edges。
- 音频生成 mock（`generateAudio`）/ 提取音频占位（derived，后端待）。
- `accept`（kinds ports）声明但 D **不消费**；`picking.accept` 独立（Dock 维度）。

## Phasing

- **P1（本 change）**：toolbar 按 kind + handleNodeAction 跨模态 + picking.accept + 参考展示 + Agent @。
- **P2（后续，开连线时）**：edges 驱动跨模态（`resolveInputs`）+ ports.accept 校验 + `isValidConnection`。
