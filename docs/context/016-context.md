# 移除右侧面板左侧 resize handle

## 需求

产品经理反馈：右侧面板不需要左右滑动，内容自适应承载在页面里即可。因此需要移除面板左侧的 resize handle 元素，避免给用户造成可左右拖拽的错觉。

## 修改内容

- 文件：`app/canvas/page.tsx`
- 移除了 `tc-agent-panel-resize-handle-left` 元素：
  - `role="separator"`
  - `aria-label="调整面板宽度"`
  - `aria-orientation="vertical"`
  - `className="tc-agent-panel-resize-handle-left ..."`
  - 内部白色竖线装饰

面板本身仍保持固定宽度 `468px`，内容通过 `max-width` 和 `word-break: break-word` 自适应承载，不会出现横向滚动。

## 验证

- `npm run build` 通过，无 TypeScript / 编译错误。
- 启动生产服务，运行 `node screenshot-agent-panel.mjs` 更新面板截图。
- 截图 `docs/agent-panel-open.png` 确认面板左侧已无 resize handle 竖线，整体视觉干净。

## 相关文件

- `app/canvas/page.tsx`
- `docs/agent-panel-open.png`
- `docs/agent-panel-closed.png`
- `docs/agent-panel-reopened.png`
