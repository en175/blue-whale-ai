# Test Matrix：跨模态创作（点击式）

> Scenario ↔ 测试。纯函数/组件单测优先（TDD）；page 接线 tsc + dev round-trip；mock 边界单测。

| Spec Scenario | 测试 | 文件 |
|---|---|---|
| 图片 toolbar 有跨模态入口 | 「NODE_TOOLBAR_ACTIONS 含 audio；VIDEO 含 extract-audio；AUDIO 含 video」 | config 测试 |
| 视频→生成视频（带视参考） | 「buildCrossmodalRefill(video, video) → mode=video, media[{video}]」 | page 纯函数测 |
| 图片→生成音频（mock） | 「buildCrossmodalRefill(image, audio) → mode=audio, media[{image}]」 | page 纯函数测 |
| 视频→提取音频（占位） | 「buildCrossmodalRefill(video, extract-audio) → derived=true」 | page 纯函数测 |
| 音频→生成视频 | 「buildCrossmodalRefill(audio, video) → mode=video, media[{audio}]」 | page 纯函数测 |
| 图 Dock 从画布选只图 | 「dockAccept(image)=[image]；pickable 图 Dock picking 时 video/audio 不选」 | dockAccept 测 + pickable |
| 视/音 Dock 选图视音 | 「dockAccept(video/audio)=[image,video,audio]」 | dockAccept 测 |
| 参考素材按类型展示 | 「DockMediaThumb image→img/video→video/audio→AudioLines」 | parts 组件测 |
| Agent @ 视音 | 「mention type image/video/audio」 | mention/dev |
| 现有操作不破坏 | 「重新编辑/下载/生成图片 回归」 | 回归测/dev |
| 不开连线 + 音频 mock | 「SHOW_WORKFLOW_UI=false；generateAudio mock」 | 既有/验证 |

## 补充单元测试

- `toolbarForKind(kind)`：image→含 audio；video→含 extract-audio；audio→含 video 不含 audio/extract-audio。
- `buildCrossmodalRefill`：跨模态矩阵全覆盖（图/视/音 × video/audio/extract-audio）。
- `dockAccept(mode)`：image→[image]；video/audio→[image,video,audio]。
- `pickable`：picking + node.kind ∈ accept 才 pickable。
- DockMediaThumb：image/video/audio 各渲染对元素。
