# 021-context — 左侧 AI 图片按钮改为唤起底部 Dock

## 需求
点击左侧工具栏第 4 个按钮（AI 图片 / `ai-image`）时，不再向画布添加图片节点，而是唤起/关闭页面底部的 AI 图片 Dock（`BottomDock`）。

## 实现

- 在 `CanvasPageInner` 中新增状态：
  ```tsx
  const [isBottomDockOpen, setIsBottomDockOpen] = useState(false);
  ```
- 修改 `handleToolClick`：
  - `upload` → 触发文件上传（保持原逻辑）。
  - `ai-image` → `setIsBottomDockOpen((v) => !v)` 切换 Dock 显示。
  - `ai-video` → 仍调用 `addNode("image")`（保持原逻辑）。
  - `text` → 仍调用 `addNode("text")`（保持原逻辑）。
- `BottomDock` 改为条件渲染：
  ```tsx
  {isBottomDockOpen && <BottomDock onClose={() => setIsBottomDockOpen(false)} />}
  ```
- 给 `BottomDock` 补充 `onClose` prop，并将其右上角的 `×` 关闭按钮接上 `onClick={onClose}`，方便用户关闭 Dock。

## 关键文件

- `app/canvas/page.tsx`
  - `CanvasPageInner` 状态声明
  - `handleToolClick` 分发逻辑
  - `BottomDock` 渲染位置
  - `BottomDock` 函数签名及关闭按钮

## 验证

- `npm run build` 通过，无 TypeScript 错误。
- 使用 Playwright 截图验证：
  - `screenshots/dock-open.png`：点击 AI 图片按钮后，底部 Dock 正确出现。
  - `screenshots/dock-closed.png`：再次点击同一按钮，Dock 消失。

## 备注

- 当前 `ai-video` 与 `text` 的行为未受影响。
- Dock 的显隐完全由 `isBottomDockOpen` 控制，后续可通过快捷键或拖拽进一步扩展。
