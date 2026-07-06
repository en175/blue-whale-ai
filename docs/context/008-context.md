# 项目上下文 008

## 时间
2026-06-30

## 本次任务
实现「AI 图片」Tab 的专属输入界面，与「AI 视频」Tab 保持明显区分。

## 变更内容

### 1. AgentComposer 条件渲染扩展
- 新增 `isImageTab` 判断（`activeTab === "image"`）
- 渲染优先级：AI 图片 > AI 视频 > 默认视频智能体

### 2. AI 图片 Tab 布局
- 左侧 88×88px 「上传参考图片」按钮
  - 实线无边框、bg-white/[0.025] 背景
  - Plus 图标 + 「图片」文字
  - hover 时背景与文字透明度提升
- 右侧 `contenteditable` 编辑区
  - 新增 `.tc-agent-image-editor:empty::before` placeholder 样式
  - placeholder：「从文字与参考图生成 AI 图片。\n上传最多 16 张参考图，然后详细描述目标图片。」
  - 字体 14px，行高 1.8

### 3. 底部参数控制栏
从左到右依次为：
- **模型**：GPT Image 2 + 金色皇冠图标（`Crown` from lucide-react）
- **宽高比**：16:9，带自定义矩形 SVG 图标（带 fill-opacity 0.12 填充）
- **分辨率**：2K

右侧：
- **积分显示**：Sparkle 图标 + 「0.8」数字
- **生成按钮**：固定禁用状态，外层带 `ncs-submit-tooltip` 与 `data-tooltip="请输入描述"`

### 4. 常量与状态新增
- `IMAGE_MODELS`、`IMAGE_RESOLUTIONS` 常量
- `selectedImageModel`、`imageAspectRatio`、`imageResolution` 状态
- 引入 `Crown` 图标

## 验证
- `npm run build` 成功
- Playwright 截图显示 AI 图片 Tab 布局与参考一致
- 预览截图：`docs/preview-ai-image.png`

## Git 提交
待提交
