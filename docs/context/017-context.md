# 修复右侧面板聊天内容区域横向拖动问题

## 问题

产品经理反馈：输入框上方区域存在左右拖动现象，整个页面不应需要左右拖动查看内容。

## 检测结果

通过 Playwright 检查页面水平溢出情况，发现：

- `document.documentElement.scrollWidth === window.innerWidth`（页面整体无横向滚动条）。
- 但 `.tc-agent-chat-body` 的 `scrollWidth`（523px）大于 `clientWidth`（468px），且 `overflow-x` 为 `auto`。
- 溢出来源主要为卡片中的 `tc-agent-card-cta--reapply-failed` 按钮：其 `data-tooltip` 的 CSS 伪元素导致元素 `scrollWidth`（184px）远大于可见 `clientWidth`（80px），进而撑开了卡片和聊天内容区域。

因此，用户在输入框上方的聊天内容区可以左右拖动。

## 修改内容

- 文件：`app/canvas/page.tsx`
- 在 `.tc-agent-chat-body` 的 className 中增加 `overflow-x-hidden`，与原有 `overflow-y-auto` 一起使用：
  - 保留垂直滚动（查看历史消息）。
  - 禁止水平滚动/拖动。

## 验证

- `npm run build` 通过，无 TypeScript / 编译错误。
- 启动生产服务，重新运行 `node screenshot-agent-panel.mjs` 更新面板截图。
- 再次检测确认：
  - 页面整体无横向滚动条。
  - `.tc-agent-chat-body` 的 `overflow-x` 变为 `hidden`。
- 截图中面板内容无横向滚动条，可正常垂直滚动查看。

## 相关文件

- `app/canvas/page.tsx`
- `docs/agent-panel-open.png`
- `docs/agent-panel-closed.png`
- `docs/agent-panel-reopened.png`
