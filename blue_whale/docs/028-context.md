# 028-context — 打开画布默认无占位图片节点

## 需求
画布打开时不再默认显示占位图片节点，保持画布为空。

## 实现

- 在 `CanvasPageInner` 的初始化 `useEffect` 中，移除创建 `node-1` 占位图片节点的逻辑。
- 保留 `setViewport` 以正确居中画布。
- 同时移除 `setSelectedId("node-1")`，避免选中空节点。

## 关键文件

- `app/canvas/page.tsx` — `CanvasPageInner` 初始化 `useEffect`

## 验证

- `npm run build` 通过。
- Playwright 截图 `screenshots/canvas-empty.png` 确认画布中央无占位图片节点。
- 检查 DOM 中 `[role="img"][aria-label="图片"]` 数量为 0。

## 备注

- 用户仍可通过左侧工具栏的文本/上传/AI 图片/AI 视频按钮手动添加节点。
- 后续如需默认展示引导或示例节点，可在此 `useEffect` 中重新添加。
