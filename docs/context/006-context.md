# 项目上下文 006

## 时间
2026-06-30

## 本次任务
为「视频智能体」输入框添加已上传媒体列表展示，并更新 placeholder 与生成按钮样式以匹配最新参考。

## 变更内容

### 1. 已上传媒体列表
- 在 `AgentComposer` 中新增 `MediaItem` 类型与 `DEMO_MEDIA` 示例数据
- 媒体列表位于编辑器上方，横向排列
- 每个媒体项包含：
  - 52×52px 圆角缩略图
  - 悬停时显示「替换」按钮（RefreshCw 图标）
  - 视频显示时长标签（如 `6s`）
  - 底部名称（Image 1 / Video 1）
  - 右上角「移除」按钮（X 图标），hover 显示
- 列表末尾保留「+」上传按钮

### 2. contenteditable placeholder
- 恢复 `data-placeholder` 属性
- 在 `globals.css` 中添加 `:empty::before` 伪元素样式
- placeholder 文案：
  > 描述你想制作的视频，微电影、产品广告、社媒视频等都可支持。适合 1-5 分钟视频；可用 @ 引用已上传素材。

### 3. 生成按钮状态
- 当编辑器有内容或已上传媒体时，按钮变为可提交状态
- 可提交样式：
  - `bg-white text-black`
  - `shadow-[0_2px_8px_rgba(255,255,255,0.1)]`
  - hover: `hover:bg-[#f0f0f0] hover:scale-105 hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(255,255,255,0.15)]`
  - active: `active:scale-95`

### 4. 文件上传
- 点击「上传文件」或媒体列表中的「+」按钮触发隐藏 file input
- 支持多选，上传后自动追加到媒体列表

## 验证
- `npm run build` 成功
- Playwright 全页截图显示媒体列表、placeholder、生成按钮均与参考一致
- 预览截图：`docs/preview.png`

## Git 提交
待提交
