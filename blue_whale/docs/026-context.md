# 026-context — 隐藏顶部播放/反馈/任务/积分按钮

## 需求
隐藏顶部状态栏中的：
- 播放按钮（TopBarCenter 的时间轴编辑器按钮）
- 反馈按钮
- 任务按钮
- 积分按钮（9.81）

保留左侧 Logo/日期/设置以及右侧 Agent 按钮。

## 实现

- `TopBarCenter`：直接返回 `null`，不再渲染中间播放按钮。
- `TopBarRight`：删除以下按钮：
  - `tc-feedback-btn` 反馈按钮
  - `tc-task-morph-trigger` 任务按钮
  - `tc-user-plan-badge` 积分按钮（含 credit 图标和 9.81）
- 仅保留 `tc-shell-btn` Agent 按钮。

## 关键文件

- `app/canvas/page.tsx`
  - `TopBarCenter` 组件
  - `TopBarRight` 组件

## 验证

- `npm run build` 通过（首次因网络问题获取 Google Fonts 失败，重试后成功）。
- Playwright 截图 `screenshots/top-bar.png` 确认顶部只保留左侧 Logo/日期/设置和右侧 Agent 按钮。

## 备注

- 被删除的按钮未做条件渲染，后续如需要可随时恢复。
- 右侧 Agent 按钮的展开/关闭逻辑未受影响。
