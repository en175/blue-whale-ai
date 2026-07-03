# 041-context — 画布素材操作面板 6 个按钮交互逻辑

## 背景
画布上点击素材节点弹出的操作面板（NodeToolbar）有 6 个按钮，此前全是空操作。本次实现它们的交互逻辑（第 5 个「详情信息」暂忽略）。

## 6 个按钮逻辑（用户描述）
1. **重新编辑 (refresh)**：唤起底部 AI 图片 Dock（不带素材）。
2. **再创作 (shuffle)**：唤起 AI 图片 Dock，并把素材带入「参考图」占位（44×44 缩略图）。
3. **添加到对话 (mention)**：自动打开右侧 Agent 面板，把 `@素材名` 插入对话输入框。
4. **生成视频 (video)**：唤起底部 AI 视频 Dock，并把素材带入「参考图片」占位。
5. **详情信息 (info)**：暂忽略（空函数，后续补充）。
6. **下载 (download)**：仅图片素材可下载（a 标签 download）。

## 架构
当前无 Context/store，沿用 `CanvasPageInner` 顶层 state + props 下传。

## 改动（仅 `app/canvas/page.tsx`）

### 1. 新增 DockMediaItem 类型
`{ id, type:"image"|"video"|"audio", name, src }`，节点带入 Dock 时的素材形状。

### 2. 打通动作链路 NodeToolbar → CanvasSurface → CanvasPageInner
- `CanvasSurface` props 新增 `onNodeAction?: (node, actionId) => void`
- `handleToolbarAction` 改造：除 delete 外，调用 `onNodeAction(selectedNode, actionId)` 把节点上抛
- `CanvasPageInner` 新增 `handleNodeAction` 统一分发 6 个分支

### 3. CanvasPageInner 新增顶层 state
- `imageDockMedia` / `videoDockMedia`：Dock 带入的素材
- `agentPendingMention`：`{ name, nonce }` 触发 Agent 面板插入 @
- `handleNodeAction`：按 actionId 分发（见上）

### 4. ImageDockContent / VideoDockContent 接收 media
- props 新增 `media?: DockMediaItem[]`
- 原 44×44「上传参考图」占位：有 media 时渲染 `<img>` 缩略图（带 title=素材名），无则保留占位按钮
- BottomDock 透传 `imageMedia` / `videoMedia`

### 5. AgentChatPanel 接收 pendingMention
- props 新增 `pendingMention` / `onMentionConsumed`
- 新增 useEffect：监听 `pendingMention.nonce` 变化 → 调 `insertSkillIntoComposer(name)` 插入 `@name`（复用现有 DOM Range 插入逻辑）→ 调 onMentionConsumed 清空
- 面板 isOpen=false 时卸载，打开后重新挂载，useEffect 在挂载后执行能拿到 composerRef

### 6. 修复 NodeToolbar 点击被吞 bug（关键）
- **根因**：CanvasSurface 根 div 的 `handlePointerDown` 无条件 `setSelectedId(null)`。点击工具栏按钮时 pointerdown 冒泡，先清空选中 → 工具栏卸载 → 按钮 onClick 不触发 → 逻辑失效。
- **修复**：NodeToolbar 根 div 加 `onPointerDown={(e) => e.stopPropagation()}`，阻止冒泡到 canvas。
- 此前按钮都是空操作所以没暴露，本次加逻辑后才发现。

## 不动的部分
- 顶部输入框、各浮层、积分生成、联网搜索等已完成项
- 第 5 个按钮（详情信息）暂忽略
- 节点的拖拽、选中、删除等既有逻辑不变

## 验证
- `npx tsc --noEmit` 通过。
- Playwright（临时脚本，已删除）：上传图片创建节点 → 选中 → 逐个点按钮：
  1. 重新编辑 → 图片 Dock 打开 ✅
  2. 再创作 → 图片 Dock 参考图缩略图出现 ✅
  3. 生成视频 → 视频 Dock 参考图缩略图出现 ✅
  4. 添加到对话 → 右侧面板输入框出现 `@素材名` ✅
  5. 下载 → 触发下载事件 ✅

## 关键文件
- `app/canvas/page.tsx`

## 备注
- 缩略图为纯展示（无移除按钮），后续如需可加。
- 「详情信息」待后续补充。
