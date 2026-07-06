# 实现右侧 Agent 面板右下角模型设置弹窗

## 问题

产品经理反馈：右侧 Agent 对话框右下角的模式与模型按钮（`Box` 图标）点击后无弹窗，需要严格复刻目标页面中的模型设置菜单。

## 目标结构

参考提供的 outerHTML，目标弹窗结构为：

- 容器：`tc-model-settings-menu`，`role="dialog"`，`aria-label="模式与模型"`。
- 宽度 284px，背景 `rgba(32,32,32,0.96)`，边框 `1px solid rgba(255,255,255,0.1)`，圆角 12px，阴影 `0 14px 40px rgba(0,0,0,0.32)`，背景模糊 `blur(24px)`，z-index 2147483605。
- 上半部分：「创作模式」section，包含两个 `role="option"` 选项：`Agent`（默认选中）和 `Direct Gen`。
- 分隔线：`tc-model-settings-divider`。
- 下半部分：「Agent 模型」section，标题下方有说明文案「选择驱动 Agent 的模型。」，列出 6 个模型选项及其消耗倍数。
- 选中项使用 `tc-creation-mode-option--selected` / `tc-model-tier-option--selected` 类名，并渲染 Lucide `Check` 图标。

## 修改内容

- 文件：`app/canvas/page.tsx`
- 引入 `Check` icon（lucide-react）。
- 在 `AgentChatPanel` 内新增状态与数据：
  - `CREATION_MODES`：创作模式列表。
  - `AGENT_MODELS`：Agent 模型列表（含消耗倍数）。
  - `selectedMode` / `selectedModel`：当前选中的模式与模型。
  - `modelSettingsOpen`：弹窗开关状态。
- 新增 refs：`modelSettingsTriggerRef`、`modelSettingsMenuRef`。
- 新增 `useEffect`：点击弹窗外部或 trigger 外部时关闭弹窗。
- 新增 `ModelSettingsMenu` 组件：
  - 使用 `position: fixed` 定位，基于 trigger 的 `getBoundingClientRect` 计算菜单 `left` / `top`，使菜单右对齐 trigger 并显示在其上方，同时避免超出视口左边界。
  - 严格复刻目标 HTML 的 class 命名与层级。
  - 模式与模型选项均使用 `role="option"` 和 `aria-selected`。
  - 点击选项后调用 `onModeChange` / `onModelChange` 并关闭弹窗。
- 更新 model settings trigger 按钮：
  - 添加 `ref` 与 `onClick={() => setModelSettingsOpen((v) => !v)}`。
  - `aria-expanded` 绑定 `modelSettingsOpen`。
  - `aria-label` 动态显示为 `模式与模型: {selectedMode.label} · {selectedModel.label}`。
  - 将 selector 包裹层设为 `relative` 以便弹窗定位参考。

## 验证

- `npm run build` 通过，无 TypeScript / 编译错误。
- 清除旧 `next-server` 进程并重新启动生产服务。
- 运行临时 Playwright 脚本验证：
  - 点击右下角 `Box` 图标按钮，成功弹出模型设置菜单。
  - 点击 `Claude Opus 4.7` 后菜单关闭，再次打开时该模型为选中状态。
- 生成截图：
  - `docs/agent-panel-model-settings-open.png`
  - `docs/agent-panel-model-settings-selected.png`

## 相关文件

- `app/canvas/page.tsx`
- `docs/agent-panel-model-settings-open.png`
- `docs/agent-panel-model-settings-selected.png`
