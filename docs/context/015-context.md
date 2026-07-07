# 打磨画布右侧 AgentChat 底部输入框 SVG 边框

## 目标

严格复刻参考 outer HTML 中 `tc-agent-composer-drop-target` 内部的 SVG 边框表现：使用 SVG `stroke` path 绘制内边框，而不是 CSS `box-shadow`。

## 参考关键信息

参考 SVG 中的可见 stroke 元素：

```xml
<path
  fill="none"
  clip-path="url(#sc-clip-1)"
  d="M 25.2000 0 L 434.8000 0 ..."
  stroke="#ffffff"
  stroke-width="2"
  stroke-opacity="0.1"
  stroke-linecap="butt"
/>
```

同时参考 SVG 包含：
- `<defs>` 中的 `clipPath` 与多个 `mask` 定义。
- 空的 `<g clip-path="url(#sc-clip-1)"></g>`。
- 一条 `display: none` 的占位 path。
- 两组 `display: none` 的占位 path 组。

## 修改内容

### 1. 扩展 `components/SmoothCorners.tsx`

新增 `stroke?: { color?: string; width?: number; opacity?: number }` prop：

- 当传入 `stroke` 时，渲染与 `clipPath` 同路径的 stroke path，属性严格对齐参考：
  - `stroke="#ffffff"`
  - `stroke-width="2"`
  - `stroke-opacity="0.1"`
  - `stroke-linecap="butt"`
  - `clip-path={`url(#${clipId})`}` 用于裁掉 path 外侧，实现内边框。
- 在 `<defs>` 中补充参考同结构的 `mask` 定义（`sc-mask-*`、`sc-dbl-inner-*`、`sc-dbl-outer-*`、`sc-dbl-middle-*`），避免简化 DOM。
- 渲染参考中的占位组：
  - 空 `<g clipPath={...} />`。
  - 一条 `display: none` 的 path。
  - 两组 `display: none` 的 path 组。
- SVG 元素补充 `display: "block"` 以匹配参考 computed style。
- `overlay` 逻辑保持不变，未传入 `stroke` 的调用（如面板外壳）不受影响。

### 2. 更新 `app/canvas/page.tsx` 的 `ComposerShell`

- 移除 `boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08)"`。
- 给 `SmoothCorners` 传入：
  ```ts
  stroke={{ color: "#ffffff", width: 2, opacity: 0.1 }}
  ```
- 保持现有“背景 div + 内容 div 兄弟”结构，避免布局重构风险。

## 验证

- `npm run build` 通过，无 TypeScript / 编译错误。
- 启动生产服务，运行 `node screenshot-agent-panel.mjs` 更新 `docs/agent-panel-open.png` 等面板截图。
- 运行临时脚本检查 composer 的 SVG outerHTML，确认：
  - SVG 包含 `clipPath`、`mask` 定义。
  - 空的 `<g clip-path="..." />` 存在。
  - stroke path 的属性与参考完全一致：`stroke="#ffffff"`、`stroke-width="2"`、`stroke-opacity="0.1"`、`stroke-linecap="butt"`。
  - 占位 `display: none` 的 path 和 path 组存在。

## 相关文件

- `components/SmoothCorners.tsx`
- `app/canvas/page.tsx`
- `docs/agent-panel-open.png`
- `docs/agent-panel-closed.png`
- `docs/agent-panel-reopened.png`
