# 025-context — 隐藏左侧工具栏 AI 音频与资产按钮

## 需求
隐藏左侧工具栏里的 AI 音频按钮以及它下方的资产按钮。

## 实现

- 从 `LEFT_TOOLS`（`app/canvas/page.tsx`）中移除：
  - `ai-audio`
  - `assets`
- 同步调整 `LeftToolbar` 的高度计算，使其根据剩余按钮数量自适应：
  - 每个按钮 32px
  - 按钮/分隔线之间 gap 4px
  - 分隔线高度 1px + margin 4px × 2 = 9px
  - 上下 padding 8px × 2 = 16px
  - 当前剩余 5 个按钮 + 1 个分隔线，高度约为 205px
- `SmoothCorners` 的 path 改为由 `squirclePath(48, toolbarHeight, 18)` 动态生成，保证圆角与新的紧凑高度匹配。

## 关键文件

- `app/canvas/page.tsx`
  - `LEFT_TOOLS` 常量
  - `LeftToolbar` 组件（高度与 path 计算）

## 验证

- `npm run build` 通过，无 TypeScript 错误。
- Playwright 截图 `screenshots/left-toolbar.png` 确认左侧工具栏仅保留选择、上传、文本、AI 图片、AI 视频五个按钮，底部无空白残留。

## 备注

- 后续如需重新显示 AI 音频或资产，只需把它们加回 `LEFT_TOOLS`。
- 高度计算会随 `LEFT_TOOLS` 数量自动变化，无需再手动改 `SmoothCorners` 的 height。
