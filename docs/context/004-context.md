# 项目上下文 004

## 时间
2026-06-30

## 本次任务
根据用户提供的最新 outer HTML，更新 `AgentComposer` 输入框的 placeholder 文案，并确保视觉无重叠。

## 变更内容

### 1. 文案更新
- 将绝对定位 placeholder 从：
  - `让 Topview 设计一条 UGC 风格带货视频`
  - 更新为：
  - `让 Topview 创作一条 90 秒电影感`

### 2. 结构对齐
- 新 outer HTML 中 `contenteditable` 仍带有 `data-placeholder` 属性
- 但实际视觉只显示绝对定位的提示文字（带闪烁光标 `▏`）
- 为避免重叠，继续不显示 `data-placeholder` 的 CSS 伪元素

### 3. 验证
- `npm run build` 成功
- Playwright 全页截图显示输入框 placeholder 正常，无重叠
- 预览截图：`docs/preview.png`

## Git 提交
待提交
