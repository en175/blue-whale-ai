# 030-context — 复刻节点工具栏样式

## 需求
点击画布中的素材节点后，上方弹出的操作工具栏需严格复刻参考 HTML 的样式、布局与交互细节。

## 参考要点
参考结构（节选）：
- 外层：`tc-node-toolbar`
- 每个操作外层：`tc-node-toolbar-action`（`position: relative`）
- 按钮：`tc-node-toolbar-button`，内联样式 `width: 32px; height: 32px; padding: 8px`
- 图标：`tc-node-toolbar-icon`，尺寸 16×16
- 按钮属性：`aria-pressed="false"`、`aria-expanded="false"`
- 分隔线：`width: 1px; height: 24px; background: rgba(255, 255, 255, 0.1); margin: 0px 2px; flex-shrink: 0`
- 动作顺序：重新编辑 → 再创作 → 添加到对话 → 分隔线 → 生成视频 → 局部重绘 → 重打光 → 超分 → 分隔线 → 信息 → 下载

## 实现

在 `app/canvas/page.tsx` 中：

1. **调整 `NODE_TOOLBAR_ACTIONS`**
   - 移除参考中没有的 `delete`（删除）动作。
   - 将 `upscale` 图标从 lucide `Maximize` 替换为参考中的自定义 SVG（`viewBox="96 96 832 832"`）。
   - 为其余 lucide 图标统一添加 `className="tc-node-toolbar-icon"`。

2. **改造 `NodeToolbar` 组件**
   - 按钮外层保持 `tc-node-toolbar-action` 并显式设置 `position: relative`。
   - 按钮 class 使用 `tc-node-toolbar-button`。
   - 按钮内联样式精确为 `width: 32; height: 32; padding: 8; border: 0; background: transparent; cursor: pointer`。
   - 补齐 `aria-pressed="false"`、`aria-expanded="false"`。
   - 分隔线改为参考中的内联样式，不再使用 Tailwind 类。
   - 容器保持 `tc-node-toolbar` 以及已有的圆角、背景、边框、毛玻璃效果。

3. **清理无用导入**
   - 移除 `lucide-react` 中不再使用的 `Trash` 和 `Maximize` 导入，避免编译警告。

## 关键文件

- `app/canvas/page.tsx` — `NODE_TOOLBAR_ACTIONS`、`NodeToolbar` 及相关导入

## 验证

- `npm run build` 通过。
- 使用 Playwright 点击画布左侧「文本」工具添加节点后，自动选中并弹出工具栏：
  - 按钮数量：9 个（无删除按钮）。
  - 分隔线数量：2 条。
  - 每个按钮均含 `aria-pressed="false"`、`aria-expanded="false"`。
  - 按钮内联样式为 `width: 32px; height: 32px; padding: 8px;`。
  - 「超分」按钮内图标为自定义 `<svg>`，而非 lucide 图标。

## 备注

- 工具栏的点击行为（除删除外）当前仍为占位逻辑，后续可按业务需要补充对应功能。
- 未保存论证截图，仅通过 DOM 结构验证样式对齐。
