# 023-context — 还原 AI 视频按钮图标为原始版本

## 变更
应需求，将左侧工具栏 AI 视频按钮（`ai-video`）的图标从场记板 + 星芒样式还原回原始版本（胶片/视频条 + 星芒）。

## 还原方式

- 通过 `git checkout HEAD~1 -- app/canvas/page.tsx` 将 `VideoGenIcon` 恢复为上一次提交前的原始 SVG。
- 同步删除不再准确的 `docs/022-context.md`。

## 关键文件

- `app/canvas/page.tsx` — `VideoGenIcon` 已恢复为原始 SVG
- `screenshots/left-toolbar.png` — 左侧工具栏整体效果（含原始 AI 视频图标）
- `screenshots/left-video-button.png` — AI 视频按钮特写（原始图标）

## 验证

- `npm run build` 通过，无 TypeScript 错误。
- Playwright 截图确认 AI 视频按钮已恢复为原始图标。

## 备注

- 左侧 AI 图片按钮唤起底部 Dock 的功能（docs/021-context.md）不受影响。
