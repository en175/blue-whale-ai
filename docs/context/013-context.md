# 打磨画布页面右侧 AgentChat 对话框底部区域

## 目标

严格按参考 HTML/CSS 复刻 `AgentChatPanel` 底部输入区（composer）的样式、可访问性属性与交互状态：

1. 输入框外壳背景：使用纯黑半透明 `rgba(0, 0, 0, 0.45)`，保持内阴影 `inset 0 0 0 1px rgba(255,255,255,0.08)`。
2. 编辑器（`contentEditable` div）具备完整的 a11y 属性：
   - `role="textbox"`
   - `aria-multiline="true"`
   - `data-empty`（布尔化 `composerEmpty`）
   - `data-tour-editor="agent-composer-input"`
   - `spellCheck={false}` / `autoCorrect="off"`
3. 模型设置触发按钮：
   - `aria-label` 与 `title` 统一为 `"模式与模型: Agent · Qwen 3.7 Max"`。
4. 发送按钮：空输入时 `disabled` + `aria-disabled="true"`，样式保持 `disabled:bg-white/[0.1] disabled:text-white/[0.25]`。

## 关键变更

### 1. 调整输入框外壳背景色

- 文件：`app/canvas/page.tsx`（`ComposerShell` 组件）
- 将 `SmoothCorners` 的 `style.background` 从 `rgba(25, 25, 25, 0.45)` 改为 `rgba(0, 0, 0, 0.45)`。
- 保持 `boxShadow`、`maxHeight: 200`、`data-canvas-reference-drop-target="agent-chat"`、`data-tour-target="agent-composer-input"` 不变。

### 2. 补全编辑器属性

- 文件：`app/canvas/page.tsx`（`.tc-agent-composer-editor`）
- 在 `contentEditable` 与 `suppressContentEditableWarning` 之外新增：
  - `role="textbox"`
  - `aria-multiline="true"`
  - `data-empty={composerEmpty}`
  - `data-tour-editor="agent-composer-input"`
  - `spellCheck={false}`
  - `autoCorrect="off"`

### 3. 更新模型设置触发按钮标签

- 文件：`app/canvas/page.tsx`（`.tc-model-settings-trigger`）
- `aria-label` 与 `title` 由 `"模式与模型"` 改为 `"模式与模型: Agent · Qwen 3.7 Max"`。

### 4. 发送按钮状态保持不变

- 文件：`app/canvas/page.tsx`（`.tc-agent-send-btn`）
- 已使用 `disabled={composerEmpty}`、`aria-disabled={composerEmpty}` 与对应的 Tailwind 禁用样式，无需改动。

## 验证

- `npm run build` 通过，无 TypeScript / 编译错误。
- 启动生产服务（`nohup npm start`），运行：
  - `node scripts/composer-bottom-screenshot.mjs` → 生成 `docs/preview-composer-bottom.png`。
  - `node screenshot-agent-panel.mjs` → 更新 `docs/agent-panel-open.png`、`docs/agent-panel-closed.png`、`docs/agent-panel-reopened.png`。
  - `node inspect-agent-panel.mjs` → 确认底部输入区 `backgroundColor` 为 `rgba(0, 0, 0, 0.45)`，`data-canvas-reference-drop-target="agent-chat"`、`data-tour-target="agent-composer-input"` 正确。
  - 临时脚本 `node inspect-composer-attrs.mjs` → 确认编辑器属性与模型按钮标签与目标完全一致。
- 验证结果：
  - 编辑器：`role="textbox"`、`aria-multiline="true"`、`data-empty="true"`、`data-tour-editor="agent-composer-input"`、`spellcheck="false"`、`autocorrect="off"`。
  - 模型按钮：`aria-label="模式与模型: Agent · Qwen 3.7 Max"`。
  - 发送按钮：空输入时 `disabled` 与 `aria-disabled="true"`。

## 相关文件

- `app/canvas/page.tsx`
- `docs/preview-composer-bottom.png`
- `docs/agent-panel-open.png`
- `docs/agent-panel-closed.png`
- `docs/agent-panel-reopened.png`
