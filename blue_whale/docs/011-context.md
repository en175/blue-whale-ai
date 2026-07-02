# 移除短剧工作室 Tab 并统一提交按钮样式

## 目标
对 Topview AI 首页 AgentComposer 做两处调整：
1. 移除原有的 "短剧工作室" Tab，仅保留 视频智能体 / AI 视频 / AI 图片。
2. 将三个 Tab 右下角的提交/生成按钮统一为 AI 视频 Tab 当前使用的白色 active 样式（白色背景 + 黑色箭头 + 悬停动效），并统一展示积分与 "或尝试无限" 提示。

## 关键变更

### 1. 移除 Tab
- 文件：`components/AgentComposer.tsx`
- 将 `TABS` 常量从 4 项精简为 3 项，删除 `studio`（短剧工作室）对象。
- 由于动态 indicator 基于 `TABS.findIndex` 计算，删除后指示条会自动适配剩余 Tab。

### 2. 统一提交按钮样式
- 文件：`components/AgentComposer.tsx`

#### AI 图片 Tab（`isImageTab`）
- 右下角由原先的条件禁用按钮改为固定白色 active 按钮。
- 新增积分区：Sparkle 图标 + `0.8` 数字，保持与 AI 视频一致的视觉结构。

#### AI 视频 Tab（`isVideoTab`）
- 已是目标样式，仅确认截图保持一致，未做代码改动。

### 3. 补充 AI 视频空状态上传入口（后续自查修正）
- 文件：`components/AgentComposer.tsx`
- 问题：AI 视频 Tab 在 `mediaList.length === 0` 时没有上传入口，只有已上传素材后列表末尾的 `+` 按钮。
- 修正：在编辑器左侧条件渲染一个 `88x88` 的「参考」上传按钮，与真实 HTML 一致：
  - 位置：编辑器区域左上角，`mt-4 ml-4`。
  - 样式：`rounded-lg bg-white/[0.025] text-white/30`，hover 时 `bg-white/[0.05] text-white/50`。
  - 图标：`Plus` 20x20，下方文字 `参考`。
- 同步更新 AI 视频 Tab 的 placeholder，使其提示「上传 1–5 张参考图或视频并用 @ 引用以创建互动」。
- 新增截图脚本：`scripts/ai-video-empty-screenshot.mjs`，用于清空素材后捕获 AI 视频空状态。

### 4. 重构 Tabs 结构对齐参考 HTML（后续样式还原）
- 文件：`components/AgentComposer.tsx`
- 目标：严格对齐真实 HTML 中 Tabs 区域的 DOM 结构与类名，只改结构不改已完成的视觉/交互状态。
- 修正内容：
  - 修改 `tabRefs` 类型为 `useRef<(HTMLElement | null)[]>([])`，使 ref 可以绑定到 div wrapper 或 button。
  - 带 Canvas 的 Tab（视频智能体）仍用外层 `<div className="relative inline-flex items-center h-8">` 包裹文字 button 和 Canvas badge，ref 绑定在该 wrapper div 上；indicator 现在覆盖「文字 + Canvas」整个区域。
  - 非 Canvas 的 Tab（AI 视频、AI 图片）直接渲染为 `<button>`，不再包额外 div；className 包含 `relative inline-flex items-center h-8 px-3`，ref 绑定在 button 上。
  - 颜色、hover、active 状态逻辑完全保留，未做改动。
- 验证：重新运行 `agent-screenshot`、`ai-video-screenshot`、`ai-image-screenshot`，确认 indicator 在三个 Tab 下位置均正确，且 Canvas 区域也被 indicator 覆盖。
- 移除 `disabled={!canSubmit}` 的条件禁用逻辑与 `canSubmit` 状态对按钮样式的控制。
- 改为固定白色 active 生成按钮，并补齐左侧积分区（Sparkle + `9` + "或尝试无限" 绿色悬浮提示）。
- 保留左侧工具栏（上传、Skill、模型选择、Direct Gen、Qwen 3.7 Max）。

## 验证

- 构建通过：`npm run build` 无 TypeScript / 编译错误。
- 新增截图脚本：`scripts/agent-screenshot.mjs` 用于捕获默认 视频智能体 Tab。
- 新增截图脚本：`scripts/ai-video-empty-screenshot.mjs`，用于清空素材后捕获 AI 视频空状态的上传入口。
- 运行并更新以下截图：
  - `docs/preview-agent.png` — 视频智能体 Tab，仅保留 3 个 Tab，右下角白色提交按钮 + 9 积分。
  - `docs/preview-ai-video.png` — AI 视频 Tab（默认已上传状态），白色提交按钮 + 9 积分 + "或尝试无限"，placeholder 已同步。
  - `docs/preview-ai-video-empty.png` — AI 视频空状态，编辑器左侧出现「参考」上传入口。
  - `docs/preview-ai-image.png` / `docs/preview-ai-image-uploaded.png` — AI 图片 Tab，白色提交按钮 + 0.8 积分。
  - `docs/preview-ai-video-uploaded.png` — AI 视频已上传状态，保持统一按钮样式。

## 相关文件

- `components/AgentComposer.tsx`
- `scripts/agent-screenshot.mjs`
- `docs/preview-agent.png`
- `docs/preview-ai-video.png`
- `docs/preview-ai-image.png`
- `docs/preview-ai-image-uploaded.png`
- `docs/preview-ai-video-empty.png`
- `docs/preview-ai-video-uploaded.png`

## 提交

- `78d48d5` feat: 移除短剧工作室 Tab 并统一三 Tab 提交按钮为白色 active 样式
- `a19f96f` feat: 补充 AI 视频 Tab 空状态上传入口
- 待提交：`feat: 重构 Tabs 结构严格对齐参考 HTML`

# 实现 Skill 面板弹窗

## 目标
为首页 AgentComposer 底部工具栏的 "Skill" 按钮接入一个居中的模态弹窗，包含三个 Tab：我的 Skills、Skill 库、创建 Skill。点击 "直接使用" 后将 `@{skillName} ` 插入到 `contentEditable` 编辑器当前光标位置。

## 关键变更

### 1. 新增 SkillPanel 组件
- 文件：`components/SkillPanel.tsx`
- 居中模态：`role="dialog" aria-modal="true" aria-label="Skills"`，点击背景或按 Esc 关闭。
- 三个 Tab：我的 Skills（列表 + 自动开关）、Skill 库（搜索 + 网格卡片 + 添加/已添加）、创建 Skill（编写 / 上传 SKILL.md 切换）。
- 保留真实 HTML 的 BEM 类名：`tc-agent-skill-panel`、`tc-agent-skill-row`、`tc-agent-skill-row__controls` 等。
- 演示数据：`MY_SKILLS` 与 `LIBRARY_SKILLS`，包含封面与描述。

### 2. 在 AgentComposer 中接入 Skill 按钮
- 文件：`components/AgentComposer.tsx`
- 新增 `skillPanelOpen` 状态并渲染 `<SkillPanel ... />`。
- Skill 按钮 `onClick` 打开面板，`aria-expanded` 随状态变化。
- 实现 `insertSkillIntoEditor`：使用 `Selection` / `Range` 在编辑器内插入文本，回退到末尾追加；插入后调用 `handleInput()` 更新内容并关闭面板。

### 3. 新增样式
- 文件：`app/globals.css`
- 自定义开关：`.tc-agent-skill-row__switch`、`.tc-agent-skill-row__switch-thumb`。
- 选中 Tab 与创建模式按钮的激活状态类：`.tc-agent-skill-panel__tab--selected`、`.tc-agent-skill-create__mode-btn--active`。

### 4. 新增截图与验证
- 文件：`scripts/skill-panel-screenshot.mjs`
- 启动 `next start` 后打开首页，点击 Skill 按钮，等待 `#home-canvas-skill-panel` 出现并截图。
- 输出：`docs/preview-skill-panel.png`。
- 构建通过：`npm run build` 无 TypeScript / 编译错误。

## 相关文件

- `components/AgentComposer.tsx`
- `components/SkillPanel.tsx`
- `app/globals.css`
- `scripts/skill-panel-screenshot.mjs`
- `docs/preview-skill-panel.png`

## 提交

- 待提交：`feat: implement Skill panel modal with my/library/create tabs and use-skill insertion`

# 我的 Skills 面板对齐参考 HTML

## 目标
让 Skill 面板「我的 Skills」Tab 严格对齐参考 outer HTML 与样式；同时把 Skill 库、创建 Skill 两个 Tab 的面板容器也统一为同一套尺寸/背景/圆角/阴影。

## 关键变更

### 1. 提取 32 个 Skill 数据
- 参考文件：`docs/reference-my-skills.html`
- 新增脚本：`scripts/extract-my-skills.mjs` 从参考 HTML 解析所有 `.tc-agent-skill-row` 行，提取 `title`、`description`、`cover`，输出 `docs/my-skills.json`。
- 新增脚本：`scripts/replace-my-skills.mjs` 将 `docs/my-skills.json` 写回 `components/SkillPanel.tsx` 的 `MY_SKILLS` 常量。
- 结果：`MY_SKILLS` 由 6 条扩展为 32 条，顺序、标题、描述、封面 URL 与参考 HTML 一致。

### 2. 面板容器尺寸与样式
- 文件：`components/SkillPanel.tsx`
- `home-canvas-skill-panel` 的类名更新为：
  - 背景 `bg-[#141414]`
  - 边框 `border border-white/[0.12]`
  - 圆角 `rounded-2xl`
  - 宽度 `w-[calc(100vw-56px)] max-w-[1440px]`
  - 高度 `h-[calc(100vh-56px)] max-h-[920px]`
  - 阴影 `shadow-[0_24px_80px_rgba(0,0,0,0.5)]`
- 该容器同时被「Skill 库」与「创建 Skill」复用，三 Tab 视觉一致。

### 3. MySkillRow 类名顺序
- 文件：`components/SkillPanel.tsx`
- 将 `tc-agent-skill-row--checked` 置于 `tc-agent-skill-row--switch-control` / `tc-agent-skill-row--with-cover` 之前，与参考 HTML 一致。
- 当 `auto` 为 true 时渲染顺序：`tc-agent-skill-row tc-agent-skill-row--checked tc-agent-skill-row--switch-control tc-agent-skill-row--with-cover`。

### 4. 验证
- 构建通过：`npm run build` 无 TypeScript / 编译错误。
- 启动 `npm start` 后运行 `scripts/skill-panel-screenshot.mjs`，更新 `docs/preview-skill-panel.png`。
- 截图显示 32 条 Skill 列表与新的面板尺寸。
- 注意：参考中的封面 URL 是 CloudFront 签名地址，在本地环境请求会返回 403，因此截图中封面图片无法显示；代码中仍保留这些原始 URL，以便在正式环境中正常加载。

## 相关文件

- `components/SkillPanel.tsx`
- `app/globals.css`
- `scripts/extract-my-skills.mjs`
- `scripts/replace-my-skills.mjs`
- `docs/reference-my-skills.html`
- `docs/my-skills.json`
- `docs/preview-skill-panel.png`
