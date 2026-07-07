# 044-context — 右侧对话框「+」号支持上传本地媒体

## 时间
2026-07-06

## 背景
右侧 Agent 对话框输入区底部有个「+」按钮（`aria-label="上传素材"`、tooltip「上传图片、视频或音频」），但**没有 `onClick`**，点击无反应。需接上"添加本地媒体"。

## 范围决策
- 媒体类型：**图片 / 视频 / 音频** 三种（`accept="image/*,video/*,audio/*"`），与 tooltip 文案一致。
- 落地策略（受画布能力约束——`NodeType` 仅 `image|text`，`NodeItem` 仅 `imageUrl`）：
  - **图片**：建画布节点（`addNode("image", {imageUrl: dataURL})`）+ 在对话框插入 `@文件名` 引用。
  - **视频 / 音频**：画布无对应节点类型，**仅在对话框 `@` 引用**（不假装画布能渲染）。
- 复用现有 `@` mention 通道：`setAgentPendingMention({name, nonce})` → `insertSkillIntoComposer` 插入 `@name `。

## 改动

### `app/canvas/page.tsx`
- 新增 `handleComposerUpload(file)`：按 `file.type` 分流——`image/*` 走 `FileReader` → dataURL → `addNode("image")` + mention；其余（video/audio）仅 mention。
- `<AgentChatPanel />` 下传新 prop `onUploadMedia={handleComposerUpload}`。

### `app/canvas/_canvas/components/AgentChatPanel.tsx`
- 新增 prop `onUploadMedia?: (file: File) => void`。
- 新增 `uploadInputRef`（隐藏 `<input type="file" accept="image/*,video/*,audio/*" className="sr-only">`）。
- 「+」按钮接 `onClick={() => uploadInputRef.current?.click()}`。
- `handleUploadChange`：取 `files[0]` → `onUploadMedia(file)` → 清空 input value（允许重复选同一文件）。

## 验证
- `npm run lint`：本次改动文件（page.tsx / AgentChatPanel.tsx）**零 error**。
- `npm run dev`：`/canvas` 200，Turbopack 编译无错。
- 手动：点「+」→ 选图片 → 画布出现节点 + 对话框插入 `@图片名`；选视频/音频 → 对话框插入 `@文件名`（画布无节点）。

## 已知限制 / 不在范围
- **视频/音频不可视化**：画布仅支持 image/text 节点；本次视频/音频只做 `@` 引用，不建画布节点。要让它们在画布展示，需新增 video/audio 节点类型 + 渲染，属另一独立任务。
- **Agent 响应为 mock**：上传的媒体未被真实 AI 消费，`@` 引用仅为视觉/交互占位。
- 单文件上传（与全仓库上传一致），不支持一次多选。
- 未做上传中的 loading / 失败提示。

## Git
- 分支：`feature/项目下拉接真实数据`。
- 提交：`6d4606d feat: 右侧对话框+号支持上传本地媒体`。本地未推。
