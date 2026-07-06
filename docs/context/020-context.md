# 打磨画布底部 AI 图片 Dock 输入框

## 问题

产品经理反馈：点击左侧 AI 图片唤起的底部输入框需要严格复刻参考 outerHTML 的样式、布局与交互。

## 目标结构

参考提供的 outerHTML：

- 外层容器：`position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483601; width: 680px;`
- 内层包装：`clip-path: inset(0%)` + 120ms 过渡动画。
- `SmoothCorners` 壳：
  - 尺寸 680×164（初始态），圆角使用 squircle path（r=28.8）。
  - 背景 `rgba(41,41,41,0.92)`，`backdrop-filter: blur(40px)`。
  - 2px 白色描边，透明度 0.04。
  - 字体 `Inter, -apple-system, sans-serif`。
- 输入区域：
  - 右上角 Close 按钮（24×24，圆角 6px）。
  - 参考图上传按钮（44×44，圆角 9px，细边框，半透明背景）。
  - `contenteditable` 输入框（min-height 56px，max-height 452px，14px/22px 行高）。
  - 绝对定位占位符：「描述你希望如何编辑这张图片...」。
- 底部操作栏：
  - 上传图片按钮（24×24 圆形）。
  - 模型设置按钮（高 32px，圆角 8px，min-width 224px，max-width 320px）：Settings2 图标 + GPT Image 2 + 1:1 + 1K。
  - 生成数量按钮（32×32，显示 1x）。
  - 积分按钮：左侧 `0.2 生成` + 右侧 ChevronUp 积分模式切换按钮。

## 修改内容

- 文件：`app/canvas/page.tsx`
- 完全重写 `BottomDock` 组件：
  - 使用 `ResizeObserver` 测量内容高度，驱动 `SmoothCorners` 的 `width/height` 与 `squirclePath(..., 28.8)`。
  - 将原来的 `textarea` 改为 `contenteditable` div，并手动管理 placeholder 显隐。
  - 所有容器、按钮、间距、字体、颜色均按目标 outerHTML 的 inline style 复刻。
  - 将模型设置按钮中的 `16:9` 修正为目标中的 `1:1`。
  - 将模型设置图标从 `Settings`（齿轮）改为 `Settings2`（滑块+圆点），匹配目标 class `lucide-settings-2`。
- 保留 `data-canvas-reference-drop-target="image-dock"` 属性。

## 验证

- `npm run build` 通过，无 TypeScript / 编译错误。
- 清除旧 `next-server` 进程并重新启动生产服务。
- 运行临时 Playwright 脚本：
  - 底部 Dock 正确显示在画布底部居中位置。
  - 占位符、关闭按钮、参考图上传按钮、输入框、底部工具栏均可见。
  - 输入文字后占位符消失，Dock 高度自适应增加。
- 生成截图：
  - `docs/bottom-dock-polished.png`
  - `docs/bottom-dock-with-text.png`

## 相关文件

- `app/canvas/page.tsx`
- `docs/bottom-dock-polished.png`
- `docs/bottom-dock-with-text.png`
