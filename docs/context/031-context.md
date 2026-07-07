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

2. **渲染时跳过**
   - 在 `NodeToolbar` 的渲染逻辑中，对 `action.hidden` 为真的动作直接返回 `null`，不生成任何 DOM 节点。
   - 这样按钮既不在页面上显示，也不在 DOM 中存在，但数据配置仍保留在 `NODE_TOOLBAR_ACTIONS` 中，后续只需去掉 `hidden: true` 即可恢复。

3. **恢复相关导入**
   - 重新导入 `Paintbrush` 和 `Lightbulb`（之前误删除）。

## 关键文件

- `app/canvas/page.tsx` — `NODE_TOOLBAR_ACTIONS`、`NodeToolbar`

## 验证

- `npm run build` 通过。
- Playwright DOM 验证：点击画布添加文本节点并选中后，工具栏中：
  - 可见按钮只有 6 个：重新编辑、再创作、添加到对话、生成视频、信息、下载。
  - 「局部重绘」「重打光」「超分」没有渲染到 DOM 中。

## 备注

- 3 个隐藏按钮后续如需重新展示，只需去掉对应 `hidden: true` 标记即可。
- 未保存论证截图，仅通过 DOM 检查验证。
