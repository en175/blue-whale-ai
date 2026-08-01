# 音频素材一等支持的跨栈缺口盘点

- 研究工单：[盘点音频素材一等支持的跨栈缺口](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK5STE)
- 决策地图：[Wayfinder：AgentChatPanel Node.js 全栈重构决策地图](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK5Q1P)
- 基线：本地 `master`，起始提交 `c5ff774653811b2bb137d3d0e27b8f9899954497`
- 方法：代码知识图谱优先，辅以定点源码与现有测试核验

## 执行结论

音频不是从零开始：Node/TypeScript（Node.js/TypeScript）栈已经具备预签名上传、对象存储、`audio` Canvas（画布）节点、右键“添加到对话”和 `AssetMention`（素材引用）提取骨架。

但它还不是可被 Agent（智能体）可靠读取的一等素材。当前闭环在四处断开：

1. AgentChatPanel（智能体聊天面板）的上传按钮没有接线，Canvas 运行时也没有接入真实消息提交。
2. 音频的 MIME（媒体类型）、时长和大小契约在客户端、服务端、对象存储之间不一致，元数据无法随 Canvas 快照稳定恢复。
3. `AssetMention` 只在编辑器提交瞬间存在，虽然参与幂等哈希，却没有进入消息持久化、任务队列和 Agent 调用输入。
4. Worker（工作进程）只把纯文本 prompt（提示词）交给 fake adapter（伪适配器）；尚无受限素材读取、音频解码/转写、预算和失败语义。

因此，后续 Spec（规格）不应新增平行研究票，而应把这些缺口分别吸收到已有的 UI 原型、显式上下文契约、Agent 编排和 Node.js 后端契约票中。

## 目标链路盘点

目标闭环：**输入器上传 → Canvas 自动放置 → 输入器自动引用 → Agent 显式读取**。

| 阶段 | 已有能力 | 关键缺口 | 后续 Spec 必须冻结 |
| --- | --- | --- | --- |
| 输入器上传 | `presign → PUT → complete` 支持 `audio` | 面板按钮未接线；通用校验拒绝音频；空 MIME 和格式映射不一致 | 唯一上传入口、格式/大小/MIME 规则、失败恢复 |
| Canvas 自动放置 | `uploadMediaToCanvas` 可创建音频占位节点并自动放置 | 仍有旧 `NodeItem` 类型不含音频；元数据没有完整进入节点与快照 | 单一节点模型、占位/成功/失败状态、重载恢复 |
| 输入器自动引用 | 右键添加会生成 `AssetMention`，编辑器可提取 `assetIds` | 上传完成后不会自动插入引用；提交后引用事实丢失 | 上传与引用的原子边界、排序/去重、删除/重试行为 |
| Agent 显式读取 | 项目素材内容路由能做归属校验并返回字节 | 消息、命令、队列、Adapter 都没有素材输入；Worker 只传文本 | 持久化引用、受限读取端口、音频表示、预算与错误 |

## 1. 上传入口与类型校验

### 可复用

- [`handle-upload.ts`](../../blue_whale_web/lib/assets/handle-upload.ts) 的服务端上传流程已接受 `image | video | audio`，音频上限为 25 MiB，并校验素材类型、文件大小、项目归属、对象大小和对象 `Content-Type`。
- [`assets.ts`](../../blue_whale_web/lib/assets.ts) 已实现预签名、对象 PUT 和完成确认三段式上传，调用者可以传入 `audio`。
- Audio Dock（音频停靠栏）已经绕过通用上传规则，直接使用 Canvas 上传流程，说明底层主链不是空白。

### 缺口

- [`AgentChatPanel.tsx`](../../blue_whale_web/app/canvas/_canvas/components/AgentChatPanel.tsx) 的上传图标只有展示和提示，没有 `onClick`、文件输入或上传状态；目标链路在第一步就无法从输入器启动。
- [`uploadRules.ts`](../../blue_whale_web/lib/uploadRules.ts) 仍只接受图片和视频，现有测试明确拒绝 `mp3`、`aac`、`wav`。不同入口因此产生不同的“允许上传”定义。
- 客户端可由扩展名识别音频，但当浏览器不给 `file.type` 时，会回退为 `application/octet-stream`；服务端随后要求 `audio/*`，同一文件会在不同浏览器表现不同。
- 客户端识别 `flac`、`opus`，对象存储扩展名映射却没有对应项；任意 `audio/*` 可能最终使用 `.bin`。

### Spec 决策

定义一个上传契约，由输入器和 Audio Dock 共用：允许格式、最大字节数、规范 MIME、扩展名、客户端嗅探边界和服务端最终裁决必须只有一份真相。AgentChatPanel 上传成功后，必须同时得到可放置的 Canvas 节点和可插入编辑器的素材引用；任一步失败都不得留下“看得见但不可引用”的半成品。

## 2. 对象存储与访问边界

### 可复用

- [`tos-storage.ts`](../../blue_whale_web/lib/assets/tos-storage.ts) 已提供预签名 PUT、对象头校验和读取器，格式映射覆盖 `aac`、`mpeg`、`mp4`、`ogg`、`wav`、`webm`。
- 项目素材内容路由在返回字节前会检查项目与素材归属，可作为受限读取端口的起点。

### 缺口

- 服务端允许 25 MiB 音频，但共享对象读取器默认只读 20 MiB；20–25 MiB 的合法上传无法通过同一读取能力交给 Agent。
- 上传对象被设置为 `public-read`，Canvas 快照又保存长期访问 URL。这与“只有显式引用才允许 Agent 读取”的最小授权模型冲突。
- 现有读取路由面向浏览器会话；Worker 没有内部身份、短时授权或一次性读取凭据。

### Spec 决策

冻结“素材 ID 是持久事实，URL 只是短时派生值”：消息和 Canvas 快照持久化 `asset_id`，渲染和 Agent 读取时按项目归属生成短时访问。统一上传、读取和 Agent 推理三处的字节上限，并明确超限、对象缺失、MIME 不匹配和授权过期的可重试性。

## 3. 元数据与可信来源

### 可复用

- `assets` 持久化模型已有 `mime_type`、`size_bytes`、`duration` 和 `duration_ms` 等字段。
- 素材信息 UI 已能显示 MIME 与时长，说明产品层已存在这些概念。

### 缺口

- [`assets.ts`](../../blue_whale_web/lib/assets.ts) 的 `uploadAsset` 只读取视频元数据，不读取音频时长；完成上传后又把完整 `AssetResponse` 压缩成 `{ id, url }`。
- Canvas 节点只保存素材 ID、种类、地址和来源；快照摘要只保留 `asset_id`、`access_url`、`type`。刷新后 MIME、大小、时长和校验状态无法恢复。
- 完成上传 API 直接把请求 JSON 断言为输入类型，没有运行时 schema（模式）校验；客户端提交的宽高、时长等值没有明确可信级别。

### Spec 决策

定义 `AudioAsset` 的规范元数据：`asset_id`、规范 MIME、字节数、时长毫秒、存储状态、校验状态和版本。对象头与服务端探测是权威来源，客户端探测只能做即时预览。Canvas 节点引用素材 ID；需要展示时从素材记录补全，不能把长期 URL 当成主键。

## 4. NodeItem 与 Canvas 表示

### 可复用

- 现代 Canvas 模型已包含 `audio`，解析与序列化能保留它。
- [`uploadMedia.ts`](../../blue_whale_web/app/canvas/_canvas/uploadMedia.ts) 会先创建上传占位节点，再自动选位，并在成功后写入素材 ID。
- [`nodes.tsx`](../../blue_whale_web/app/canvas/_canvas/v2/nodes.tsx) 的媒体节点可用 AudioPlayer（音频播放器）渲染音频。

### 缺口

- [`types.ts`](../../blue_whale_web/app/canvas/_canvas/types.ts) 的旧 `NodeType` 仍只有 `image | video | text`。同仓库存在两套节点类型定义，音频会在旧边界被类型擦除。
- Canvas 快照只够恢复“这是音频”，不足以恢复素材校验状态、时长和 Agent 可读状态。
- 上传占位、完成、失败、取消和刷新后的状态机没有被 AgentChatPanel 共用契约覆盖。

### Spec 决策

选定一套规范 Canvas 节点模型，音频节点只持有稳定的 `asset_id` 和渲染所需的最小派生状态。冻结自动放置、选中、失败重试、删除和页面重载的状态转换；旧 `NodeItem` 必须迁移或明确退役，不能继续作为另一份运行时真相。

## 5. AssetMention 与消息持久化

### 可复用

- [`nodes.tsx`](../../blue_whale_web/app/canvas/_canvas/v2/nodes.tsx) 已能把音频节点映射为待插入引用；对应行为由 [`add-to-chat.test.ts`](../../blue_whale_web/app/canvas/_canvas/v2/add-to-chat.test.ts) 覆盖。
- [`conversation.ts`](../../blue_whale_web/lib/conversation.ts) 会从编辑器 DOM 提取有序、去重的 `assetIds`。
- [`accept-conversation-message.ts`](../../packages/core/src/conversation/accept-conversation-message.ts) 会把 `referenced_asset_ids` 纳入规范哈希，重复提交的幂等语义已意识到素材引用。

### 缺口

- AgentChatPanel 上传成功后不会自动把新素材插入输入器，用户只能从 Canvas 手动“添加到对话”。
- `referenced_asset_ids` 参与哈希后没有进入 `PreparedConversationMessage`、命令存储输入或消息数据库列；引用事实随请求结束而丢失。
- `conversation_messages` 只有纯文本字段，无法重建“这条消息明确引用了哪些素材、顺序是什么”。

### Spec 决策

把 `AssetMention` 定义为消息的一等结构化组成：至少持久化 `asset_id`、顺序和当时的素材类型；文本只负责人类可读内容。上传自动引用必须是显式、可见、可删除的编辑器操作。提交时做项目归属校验，幂等哈希、数据库消息、运行命令和审计事件必须保存同一组规范引用。

## 6. Agent 音频读取

### 可复用

- 项目素材内容 API 已有按项目和素材 ID 获取内容的基础能力。
- Agent 运行已有 command/outbox（命令/发件箱）、claim（领取）、Worker 和 Adapter 分层，可承载结构化输入扩展。

### 缺口

- [`agent-run-repo.ts`](../../packages/persistence/src/agent-run-repo.ts) 的 `AgentRunWork` 只有拼接后的文本 prompt。
- [`runtime-ports.ts`](../../packages/core/src/runtime-ports.ts) 的 `AgentAdapter.invoke` 只接收 `{ prompt }`。
- [`worker-loop.ts`](../../apps/agent-worker/src/worker-loop.ts) 只把纯文本传给 Adapter；[`index.ts`](../../apps/agent-worker/src/index.ts) 目前只允许 fake 模式。
- 没有定义 Agent 接收原始音频、provider-native audio（供应商原生音频）、转写文本还是文件句柄；也没有解码/转写责任方、缓存、超时、字节/时长/token 预算和错误码。

### Spec 决策

引入受限的 `AgentAssetInput`，由运行时根据消息中已持久化的显式 `AssetMention` 解析；Worker 不接受任意 URL。每个输入至少带素材 ID、规范 MIME、大小、时长和受控读取句柄。Spec 必须二选一并写明兼容策略：直接给支持音频的模型，或先经受控转写服务生成带来源的文本。任一路径都要限制字节、时长、总素材数和总预算，并产出用户可理解、可恢复的错误事件。

## 7. 端到端状态与恢复

[`CanvasProjectRuntime.tsx`](../../blue_whale_web/app/canvas/CanvasProjectRuntime.tsx) 没有向 AgentChatPanel 传入真实 `onSubmitMessage`，所以即使手动构造引用，当前页面仍会落入模拟提交。后续 Spec 必须用一条可观察状态链覆盖：

`uploading → stored → validated → placed → mentioned → accepted → queued → reading → completed | failed`

每个状态要绑定稳定 ID、持久化位置、用户可见反馈、超时和重试规则。恢复时只能从持久事实继续，不能从编辑器 DOM、公开 URL 或 Worker 内存猜测。

## 最小跨栈契约

| 对象 | 最小字段 | 约束 |
| --- | --- | --- |
| `AudioAsset` | `asset_id`、`project_id`、`mime_type`、`size_bytes`、`duration_ms`、`status`、`version` | 服务端权威；不持久化长期公开 URL |
| `UploadCommand` | `project_id`、原始文件名、声明 MIME、字节数、素材类型 | 服务端校验后返回规范上传参数 |
| Canvas 音频节点 | `node_id`、`asset_id`、布局、上传/渲染状态 | 节点模型唯一；刷新可恢复 |
| `AssetMention` | `asset_id`、`ordinal`、`asset_type` | 可见、可删除；随消息和命令持久化 |
| `AgentAssetInput` | `asset_id`、规范元数据、受控读取句柄/转写引用 | 只能由显式引用派生；带预算和错误语义 |

## 对决策地图的影响

本次不新增票。结论分别吸收到四张既有票：

1. **原型验证 AgentChatPanel 单模式 UIUX 与完整状态**：接通面板上传、自动放置、自动引用和用户可见的失败/重试状态。
2. **锁定显式上下文与 PlanMessage 手动应用契约**：把 `AssetMention` 固定为唯一素材授权事实，并冻结自动引用的可见/可撤销行为。
3. **定义 Node.js Agent 编排状态机与运行边界**：定义素材读取阶段、音频表示选择、预算、超时、重试和错误事件。
4. **定义 Node.js 后端模块 API 事件与持久化适配**：统一素材元数据、消息引用持久化、内部读取端口和 Canvas 快照恢复契约。

## 核验

以下现有测试在本研究基线上通过：

```bash
pnpm exec vitest run \
  packages/core/src/conversation/accept-conversation-message.test.ts \
  packages/persistence/src/asset-upload-repo.test.ts \
  packages/agent-runtime/src/fake-agent-adapter.test.ts \
  apps/agent-worker/src/worker-loop.test.ts
```

- 4 个测试文件，9 个测试通过。

```bash
pnpm --filter blue_whale exec vitest run \
  lib/assets/handle-upload.test.ts \
  lib/assets/tos-upload-storage.test.ts \
  lib/uploadRules.test.ts \
  lib/conversation.test.ts \
  lib/conversation/handle-accept-conversation-message.test.ts \
  app/canvas/_canvas/uploadMedia.test.ts \
  app/canvas/_canvas/model.test.ts \
  app/canvas/_canvas/v2/add-to-chat.test.ts \
  app/canvas/_canvas/v2/nodes.test.tsx
```

- 9 个测试文件，130 个测试通过。
- 合计：13 个测试文件，139 个测试通过。

这些测试证明现有分段能力没有回归；它们不证明目标闭环已经存在。目标闭环仍需在后续 Spec 和实现中补齐上述跨栈契约。
