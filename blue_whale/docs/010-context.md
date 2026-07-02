# AI 视频 Tab 上传素材后状态

## 目标
实现 Topview AI 首页 AgentComposer 在 **AI 视频** Tab 下、已上传图片/视频素材后的完整布局与样式。

## 关键变更

### 1. 组件结构 (`components/AgentComposer.tsx`)
- 为 `isVideoTab` 新增独立的已上传素材布局分支。
- 当 `mediaList.length > 0` 时，顶部显示横向媒体列表（Image/Video 缩略图、名称、悬停替换/移除按钮、加号添加按钮）。
- 媒体列表下方为 `contenteditable` 编辑器，placeholder 提示使用 `@` 引用素材。
- 底部参数栏包含：模型（Seedance 2.0）、参考模式（Omni Reference）、宽高比（16:9）、分辨率（480p）、时长（15s）、@ 提及按钮。
- 右下角显示积分（9）与白色可点击生成按钮。

### 2. 状态与常量
- 新增 `VIDEO_REF_MODES` 常量数组，默认选中 `Omni Reference`。
- `DURATIONS` 扩展为 `5s / 10s / 15s`，默认 `15s`。
- `RESOLUTIONS` 默认改为 `480p`，以匹配参考效果。
- `refMode` 状态由字符串改为对象 `{ id, label }`。

### 3. 样式细节
- 媒体列表：`mediaListItem / mediaListThumbWrapper` 类名与图片 Tab 上传后保持一致，视频缩略图右下角显示 `duration` 标签。
- 编辑器：使用 `before:content-[attr(data-placeholder)]` 实现 placeholder，最小高度 `120px`，支持多行换行。
- 参数按钮：统一 `h-8 px-3 rounded-lg border border-white/[0.06]`，hover 时 `text-white/70 bg-white/[0.05]`。
- 积分区：Sparkle 图标 + 数字 9，上方悬浮绿色 "或尝试无限" 提示。
- 生成按钮：白色背景黑色箭头，带悬停放大与阴影效果。

## 验证
- 构建通过：`next build` 无 TypeScript / 编译错误。
- 截图脚本：`scripts/ai-video-uploaded-screenshot.mjs` 使用 Playwright 截取 `docs/preview-ai-video-uploaded.png`。
- 视觉结果：AI 视频 Tab 激活，媒体列表展示 Image 1 与 Video 1（带 6s 标签），编辑器 placeholder 与参数栏完整呈现。

## 相关文件
- `components/AgentComposer.tsx`
- `scripts/ai-video-uploaded-screenshot.mjs`
- `docs/preview-ai-video-uploaded.png`

## 提交
`518b279 feat: AI 视频 Tab 上传素材后的媒体列表与编辑器布局`
