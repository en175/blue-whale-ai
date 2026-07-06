# 打磨画布页面右侧 AgentChat 对话框中间区域

## 目标

严格按参考 HTML/CSS 复刻 `AgentChatPanel` 中间聊天内容区的布局、样式与交互：

1. 用户消息气泡：`self-end`、`max-width: 82%`、圆角 18px、背景 `rgba(255,255,255,0.1)`、边框 `rgba(255,255,255,0.04)`。
2. 思考块 `tc-agent-thinking-block`：触发按钮可展开/折叠，展开后显示思考内容区 `tc-agent-thinking-content-wrap` + 自定义滚动条。
3. 助手消息气泡：`self-start`、`max-width: 92%`、圆角 `12px 12px 12px 2px`、段落按 `\n\n` 拆分并用 `height: 8px` spacer 分隔。
4. 任务卡片 `tc-agent-card-*`：头部 badge、元信息、手动应用按钮（失败状态含 tooltip）、折叠按钮，卡片内容可折叠。

## 关键变更

### 1. 扩展聊天消息类型与示例数据

- 文件：`app/canvas/page.tsx`
- 将 `ChatMessage` 提升为顶层 discriminated union：
  - `thinking` 新增 `content: string`。
  - `card` 新增 `meta`、`collapsed?`、`status?: "failed" | "normal"`。
- 更新示例 `messages`：
  - 思考过程附带完整英文思考文本。
  - 助手消息使用 `\n\n\n\n` 产生参考 HTML 中的两段 8px 空行 spacer。
  - 卡片 meta 为 `1:1`，状态为 `failed`。

### 2. 抽取消息渲染辅助组件

- 文件：`app/canvas/page.tsx`（位于 `squirclePath` 之后）
- `UserMessageBubble`：严格对齐用户气泡。
- `AgentMessageBubble`：按 `\n\n` 拆段；空段渲染为 `height: 8px`；非首段 `marginTop: 2px`。
- `ThinkingBlock`：本地状态控制展开；触发按钮带 `--expanded` modifier 与旋转 Chevron；展开后渲染内容区与滚动条。
- `AgentCard`：还原卡片头部 DOM 结构；手动应用按钮使用参考中的 mask SVG 加号图标（`useId` 保证 mask ID 唯一）；折叠按钮控制内容显隐。

### 3. 补充样式

- 文件：`app/globals.css`
- 新增 `.tc-agent-thinking-content-wrap` / `.tc-agent-thinking-content` / `.tc-agent-thinking-scrollbar` / `.tc-agent-thinking-scrollbar__thumb`。
- 新增基于 `data-tooltip` 的 CSS-only hover tooltip。

## 验证

- `npm run build` 通过，无 TypeScript / 编译错误。
- 启动生产服务，运行 `node screenshot-agent-panel.mjs` 重新生成面板截图。
- `node inspect-agent-panel.mjs` 确认面板外壳、底部输入框底色、data 属性保持正确。
- 生成的 `docs/agent-panel-open.png` 显示思考块已展开、卡片结构正确、助手消息段落间距符合参考。

## 相关文件

- `app/canvas/page.tsx`
- `app/globals.css`
- `components/SmoothCorners.tsx`（沿用上一轮 data 属性前缀修复）
- `docs/agent-panel-open.png`
- `docs/agent-panel-reopened.png`

## 提交

- `76aeaf6` init: initialize git repository with current canvas page
- `cf6e253` feat: polish agent chat thinking block, card, and message bubbles
- `5cf3c44` chore: regenerate panel screenshots after chat body polish
- `4ffb637` docs: add conversation record 999-canvas-agent-chat-body（后按历史习惯重命名为 `docs/012-context.md`）
