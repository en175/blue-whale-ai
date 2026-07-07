# 024-context — 画布底部 Dock 支持 AI 图片/视频样式切换

## 目标
按参考 HTML 严格复刻左侧 AI 视频按钮唤起的底部 Dock；同时保留 AI 图片 Dock，两者在同一容器内切换样式。

## 实现

### 1. 状态层
- 在 `CanvasPageInner` 中保留 `isBottomDockOpen`。
- 新增 `bottomDockMode: "image" | "video"`。
- 调整 `handleToolClick`：
  - `ai-image`：mode 设为 image，若当前已是 image 且打开则关闭，否则打开。
  - `ai-video`：mode 设为 video，若当前已是 video 且打开则关闭，否则打开。
  - 不同按钮之间切换时 Dock 保持打开，只切换内部样式。

### 2. `BottomDock` 组件重构
- 增加 `mode: "image" | "video"` prop。
- 共用外壳：绝对定位 680px、水平居中、z-index 2147483601、clip-path 过渡动画、`SmoothCorners` 半径 28.8、背景 `rgba(41,41,41,0.92)`、backdrop-filter blur(40px)、白色 0.04 描边。
- `mode === "image"` 时完全保留原有 JSX，不做视觉改动。
- `mode === "video"` 时按参考复刻：
  - 顶部媒体参考区：图片、视频、音频三个 44×44 上传按钮，中间以 `·` 分隔。
  - 输入区：contenteditable + 占位文案。
  - 底部控制栏：上传 plus 按钮、全能参考下拉、组合模型设置药丸（Seedance 2.0 · 16:9 · 720p · 15s）、隐藏的高级设置按钮、生成数量 1x、生成按钮组（CreditIcon + 15 生成 + ChevronUp）。
  - 折叠高级面板：联网搜索 toggle。

### 3. 交互
- 全能参考：点击展开下拉，可在 全能参考/首尾帧/Text to Video 间切换。
- 组合模型设置药丸：点击展开模型/比例/分辨率/时长选择面板。
- 生成数量：点击展开 1x/2x/4x。
- 联网搜索：可在折叠面板内切换开关。
- 生成按钮：保持禁用展示态。

### 4. 常量
在 `app/canvas/page.tsx` 内新增视频模式专用常量：
- `VIDEO_MODELS`
- `VIDEO_ASPECT_RATIOS`
- `VIDEO_RESOLUTIONS`
- `VIDEO_DURATIONS`
- `REF_MODES`
- `QUANTITIES`

## 关键文件

- `app/canvas/page.tsx`
  - `CanvasPageInner` 状态与 `handleToolClick`
  - `BottomDock` 组件（含 `ImageDockContent`、`VideoDockContent`、`MediaUploadButton`）
  - 视频模式相关常量

## 验证

- `npm run build` 通过，无 TypeScript 错误。
- Playwright 截图：
  - `screenshots/dock-image.png`：AI 图片模式 Dock 与之前一致。
  - `screenshots/dock-video.png`：AI 视频模式 Dock 与参考布局一致。

## 备注

- 未改动 `AgentComposer.tsx` 或其他无关文件。
- 图片/视频 Dock 共用同一个容器，避免两个 Dock 重叠。
- 后续如需把模型设置面板改为固定定位弹窗，可再优化。
