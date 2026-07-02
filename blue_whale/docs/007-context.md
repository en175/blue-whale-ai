# 项目上下文 007

## 时间
2026-06-30

## 本次任务
实现「AI 视频」Tab 的专属输入界面，与默认「视频智能体」Tab 保持明显区分。

## 变更内容

### 1. AgentComposer 条件渲染
- 新增 `isVideoTab` 判断（`activeTab === "video"`）
- 当切换到「AI 视频」Tab 时，渲染独立的布局；其他 Tab 保持原有「视频智能体」布局

### 2. AI 视频 Tab 布局
- 左侧 88×88px 虚线边框「上传参考」按钮
  - 圆形加号图标 + 「上传参考」文字
  - hover 时边框与背景色加深
- 右侧 `contenteditable` 编辑区
  - placeholder：「描述你想要的视频画面，或直接输入提示词。上传参考图/视频后，可用 @ 引用。」
  - 字体 15px，行高 1.7

### 3. 底部参数控制栏
从左到右依次为：
- **模型**：沿用 Seedance 2.0 下拉选择
- **参考模式**：显示「参考主体」，带下拉箭头
- **宽高比**：自定义矩形 SVG 图标 + 当前比例（16:9）
- **分辨率**：1080p
- **时长**：5s

右侧：
- **积分显示**：Sparkle 图标 + 「40 积分」+ hover 显示「或尝试无限」
- **生成按钮**：固定为禁用状态（`cursor-not-allowed`）

### 4. 状态新增
- `refMode`、`aspectRatio`、`resolution`、`duration` 用于展示当前参数
- `ASPECT_RATIOS`、`RESOLUTIONS`、`DURATIONS` 常量数组

## 验证
- `npm run build` 成功
- Playwright 截图显示 AI 视频 Tab 布局与参考一致
- 预览截图：`docs/preview-ai-video.png`

## Git 提交
待提交
