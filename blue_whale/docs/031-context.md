# 031-context — 隐藏节点工具栏中的超分、重打光、局部重绘

## 需求
在节点工具栏中，不删除「超分」「重打光」「局部重绘」三个按钮，但将它们隐藏， visually 只保留：
- 重新编辑、再创作、添加到对话
- 生成视频
- 信息、下载

## 实现

在 `app/canvas/page.tsx` 中：

1. **恢复并标记隐藏**
   - 将「局部重绘」「重打光」「超分」重新加入 `NODE_TOOLBAR_ACTIONS`。
   - 为这三个动作增加 `hidden: true` 标记。
   - 保留之前为「超分」配置的自定义 SVG 图标。

2. **渲染时隐藏**
   - 在 `NodeToolbar` 的渲染逻辑中，对 `action.hidden` 为真的动作外层设置 `style={{ display: "none" }}`。
   - 这样按钮仍保留在 DOM 中，便于后续恢复，但视觉上不显示，也不参与布局。

3. **恢复相关导入**
   - 重新导入 `Paintbrush` 和 `Lightbulb`（之前误删除）。

## 关键文件

- `app/canvas/page.tsx` — `NODE_TOOLBAR_ACTIONS`、`NodeToolbar`

## 验证

- `npm run build` 通过。
- Playwright DOM 验证：点击画布添加文本节点并选中后，工具栏中：
  - 总按钮数为 9 个（包含 3 个隐藏按钮）。
  - 可见按钮为 6 个：重新编辑、再创作、添加到对话、生成视频、信息、下载。
  - 隐藏按钮「局部重绘」「重打光」「超分」仍存在于 DOM 中，但 `isVisible()` 为 `false`。

## 备注

- 3 个隐藏按钮后续如需重新展示，只需去掉对应 `hidden: true` 标记即可。
- 未保存论证截图，仅通过 DOM 检查验证。
