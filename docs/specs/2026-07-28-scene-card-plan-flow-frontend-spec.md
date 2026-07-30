# 场景卡 PlanPhase 创作流 · 前端规格 Spec

| 项 | 值 |
|---|---|
| 状态 | Approved（需求方评审通过） |
| 日期 | 2026-07-29 |
| 范围 | `blue_whale_web` 前端行为、前后端接口契约与恢复语义；不包含实现 |
| 目标入口 | Canvas、AgentChatPanel、场景卡生成面板 |
| 原型基线 | `blue_whale_web/app/prototype/scene-card/`，commit `7a72c0ad` |
| 关联地图 | [Wayfinder: 场景卡 Plan-Mode 创作流 · 前端规格 Spec](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK4Q48) |

## 0. 目的

本 Spec 冻结从需求对齐到素材生成的单场景卡生命周期：

```text
AgentChatPanel 对齐需求
  → Agent 产出 PlanMessage（计划卡）
  → User 手动新建或覆盖 SceneCard
  → SceneCardNode 进入 Canvas
  → User 直接编辑，或 @SceneCard 让 Agent 生成新的 PlanMessage
  → User 从 SceneCard 发起视频或分镜图 GenerationJob
  → 成功 Asset 以独立 NodeItem 放入 Canvas
```

本文是后续前端分步实现及后端重构后接口对接的唯一功能依据。若本文与旧 Java/Python 回复流契约冲突，以 Node 目标架构的 [ADR-0045](../adr/0045-provisional-assistant-delivery-runcommit-boundary.md) 及本文为准。

### 0.1 原型权威边界

- `场景卡画布交互与视觉原型` 已由需求方在最后一轮评审确认。凡本文的可见交互、控件顺序、文案、尺寸或层级与上述代码冲突，以 commit `7a72c0ad` 的原型代码为准。
- 原型明确标记为 mock 的事实不升级为产品契约：示例 Markdown、示例 ID、渐变缩略图、硬编码模型名称、`1.8s` 假进度、固定生成三张分镜图，以及未接入服务端持久化。
- SceneCard 实体、PlanMessage、ETag、幂等、GenerationJob、Snapshot/SSE 与恢复语义不在视觉原型的表达能力内，继续以本文汇总的前置契约为准。

## 1. 产品边界

### 1.1 核心原则

- `PlanPhase` 是 Agent 创作入口内的内部行为阶段，不是 User 需要切换的 Plan Mode；不新增模式开关。
- `PlanMessage` 是 Conversation 中不可变的正式计划消息；不是生成结果 `Card`，也不是 `SceneCard`。
- `SceneCard` 是 Project 内独立持久化资源，以 Markdown 为唯一权威正文；不是 `NodeItem`。
- `SceneCardNode` 只保存 `sceneCardId` 与布局，是“Canvas 只编排 NodeItem”规则的显式例外。
- 所有计划应用都由 User 手动触发。Agent 不自动创建、覆盖或删除 SceneCard。
- 一张 SceneCard 的直接编辑采用原子整体替换，不提供版本历史、自动合并或强制覆盖。
- GenerationJob 复用现有生成治理流水线；SceneCard 只增加来源快照，不拥有生成 Asset。

### 1.2 两个创作入口

| 入口 | 行为 |
|---|---|
| Agent 创作 | 允许多轮需求对齐、普通问答、素材分析、产出 PlanMessage 与继续修改 |
| 直接生成 | 直接创建图片或视频 GenerationJob；永不产出 PlanMessage |

- 两个入口不得根据输入内容自动切换，也不得替 User 自动提交。
- 直接生成入口固定提示“提交后将直接生成，不会先整理计划”。
- User 主动切换到 Agent 创作时，保留尚未提交的文字与素材引用。
- 普通问答和素材分析不自动转成 PlanMessage；信息不足时继续自然语言对齐。
- User 可用自然语言要求“现在出计划卡”“继续讨论”或“不要计划卡”。

## 2. 完整交互流程

### 2.1 对齐需求并产出 PlanMessage

1. User 在 AgentChatPanel 的 Agent 创作入口提交消息，可同时带 `AssetMention` 或 `SceneCardMention`。
2. Product API 接纳正式 User `ConversationMessage`；若含 `@SceneCard`，在同一接纳边界冻结卡片 ID、版本、摘要与 Markdown。
3. AgentRun 进入“正在整理计划…”临时状态。生成期间不展示逐字正文、半成品卡片或应用按钮。
4. Agent 完整产出候选，Product API 校验正文、素材引用、安全边界和唯一更新目标。
5. 校验成功后，PlanMessage 作为一条完整正式消息原子进入 Conversation、Snapshot 与 SSE。
6. Web 展示完整计划卡及与其应用意图对应的明确操作。

旧的 provisional 片段、中断尝试或检查失败不得成为 PlanMessage，也不得进入永久 Conversation 历史。

PlanMessage 的后续行为：

- 所有历史计划卡完整显示，不折叠、不隐藏，均可独立应用。
- “继续讨论”只把所选 PlanMessage 作为结构化来源带入 Composer，不自动发送或应用。
- 历史 PlanMessage 不可直接编辑；修改要求交给 Agent，并生成带直接来源关系的新 PlanMessage。
- 从新建计划继续讨论时默认仍为新建；从更新计划继续讨论时仍绑定同一 SceneCard，但 Agent 产出新计划前必须重新读取目标当前内容与版本。
- 素材失效或正文需要修改时，同样通过“继续讨论”或“替换素材”生成新 PlanMessage；Web 不改写旧消息。

### 2.2 从 PlanMessage 新建 SceneCard

1. 新建计划卡显示“将新建场景卡”，主按钮为“新建场景卡”。
2. User 点击后，Web 以稳定 `Idempotency-Key` 调用计划应用接口；服务端从已保存的 PlanMessage 读取 Markdown，客户端不回传正文。
3. 服务端在同一事务中创建 SceneCard 与不可变 `PlanApplicationReceipt`。
4. SceneCard 创建成功即表示应用成功；Web 再以确定性节点 ID 尝试完整保存 Canvas。
5. Canvas 保存成功或节点已存在时显示“已放入 Canvas”。保存失败时显示“场景卡已创建，尚未放入 Canvas”，并提供只重试放置的“放入 Canvas”。
6. 网络结果不明时进入“正在确认应用结果…”，使用原命令 ID 查询或安全重放，禁止创建第二个应用操作。

User 明确再次点击“再次新建”才产生新的命令身份、新 SceneCard 与新应用记录。新建、覆盖和另存为新卡均不增加二次确认弹窗。

### 2.3 通过 @SceneCard 让 Agent 修改

1. User 选中 SceneCardNode，点击头部“@ 引用”；Composer 加入可移除的 SceneCard chip，不自动发送。chip 文案取 SceneCard Markdown 的首个 `# ` 一级标题；不存在时显示“场景卡”。
2. User 提交消息时，服务端冻结当前 SceneCard 的 ID、版本、摘要与 Markdown，作为本轮不可变输入。
3. 若一次消息引用多张 SceneCard，Agent 必须先要求 User 明确唯一修改目标；多份 AssetMention 不受此限制。
4. Agent 生成新的 PlanMessage，默认应用意图为覆盖所引用 SceneCard，并冻结 `base_scene_card_version`。
5. 更新计划卡主按钮为“覆盖此场景卡”，同时始终提供独立次要操作“保存为新场景卡”。
6. 覆盖前重新检查目标存在性、当前版本与素材可用性。版本变化时停止且零写入；目标删除时禁用覆盖。
7. 覆盖成功后原 SceneCardNode 保持不变，仅 SceneCard 正文与版本变化。

旧 `SceneCardMention` 永不漂移到最新内容。User 要基于当前内容继续修改，必须重新 `@` 当前 SceneCard。

### 2.4 在 Canvas 直接编辑 SceneCard

- 单击只选中并允许拖拽；双击进入富文本就地编辑，防止拖拽时误触。
- 编辑器呈现一级标题、二级标题与正文行的排版，不暴露 Markdown 源码；素材引用呈现为不可编辑的缩略图 chip。
- 编辑高度锁定为进入编辑前的渲染高度；溢出内容在编辑区内部滚动，滚轮不得触发 Canvas 缩放。
- `Esc` 取消，`Ctrl/⌘↵` 或失焦保存。
- 保存时将富文本序列化回 `content_markdown`，以 SceneCard 当前 `ETag` 执行完整条件替换。
- `412` 时保留未保存内容，停止自动提交并提示内容已变化；不得自动覆盖或合并。
- 直接编辑只修改 SceneCard，不创建 PlanMessage 或应用记录。

### 2.5 删除 SceneCard

- 选中状态的头部提供“删除”；选中节点时也支持 `Backspace/Delete`，两条路径都不显示二次确认。
- Web 先读取单卡取得最新 `ETag`，再条件删除 SceneCard；成功后从 Canvas 完整保存移除 SceneCardNode。
- 若实体已删除但 Canvas 保存失败，遗留节点显示“场景卡不可用”，允许 User 再次移除。
- 删除 SceneCard 不删除历史 PlanMessage、SceneCardMention、GenerationJob 或 Asset。

### 2.6 从 SceneCard 发起生成

SceneCard 仅提供两类生成意图：

- 直接生成视频；
- 基于内容先生成分镜图。

操作入口为卡片底部通栏“生成视频”主按钮与右侧 chevron 菜单；菜单包含“直接生成视频”“先预览分镜图”“分镜图设置…”。图片类 GenerationJob 在本流程中表达分镜图，不提供泛化的“生成图片”主入口。

- “生成视频”主按钮与“直接生成视频”菜单项都打开同一个视频生成面板；打开面板不等于提交任务。
- “先预览分镜图”不打开设置层，直接使用当前系统默认值提交分镜图生成。
- “分镜图设置…”打开分镜图设置弹窗，User 调整后再提交。

打开生成面板时：

| 字段 | 预填规则 |
|---|---|
| prompt | 完整载入 SceneCard Markdown，不摘要、不截断 |
| 参考图 | 按 Markdown 中 `asset://<asset_id>` 的首次出现顺序去重载入，最多 15 个 |
| type | 由“生成视频”或“生成分镜图”入口确定 |
| 模型、模式、比例、分辨率、时长及开关 | 每次打开都取当时系统能力表与产品配置选出的默认值 |
| 视频数量 | 固定为 `1x`，本期不提供数量控件 |
| 分镜图数量 | 由“关键时刻”的自动、4、9、25 或自定义选择推导 |

- 面板允许 User 调整原型明确提供的本次生成参数，但绝不反写 SceneCard。
- 场景卡正文以富文本编辑区显示，素材引用仍为缩略图 chip。
- 从顶部参考素材行移除某项，只修改本次提交的 `input_asset_ids`，不改写正文中的素材 chip、SceneCard 或来源快照。
- SceneCard 生成面板持有独立临时草稿，不写入或覆盖 BottomDock 的未提交内容；关闭面板即放弃该临时草稿。
- 已在后台运行的任务不属于草稿，不阻止打开新的 SceneCard 生成面板。
- 正文超限或素材失效时仍完整展示，并显示当前值与允许上限；调整合法前禁用提交，不自动裁剪或忽略。
- 提交时用 SceneCard ID 与打开面板时取得的 ETag 重新读取来源。ETag 变化时保留面板调整并提供“重新载入最新内容”，User 必须再次提交。

## 3. 视觉与组件行为

### 3.1 SceneCardNode

- 阅读态采用 Scene 主标题、弱化时长、Shot 分段标题与正文段落的层级；这是对 Markdown 的显示约定，不是服务端保存模板或校验条件。
- 任意合法 Markdown 都必须安全显示；前端不得依赖固定镜头数量、标题层级或业务字段。
- `![说明](asset://<asset_id>)` 在阅读态与编辑态均渲染为“迷你缩略图 + 说明文本”chip。
- chip 文案使用 Markdown 图片语法中的说明文本，不另行用 Asset 元数据改写。
- chip 悬停显示固定 `128 × 80px` 放大预览。预览 portal 到 `body` 并使用 viewport 定位，避免 transformed 祖先和滚动容器裁剪。
- 卡片全文自然展开。选中不改变高度或结构，只增加选中描边，并在头部显示“@ 引用 / 删除”。
- SceneCardNode 宽 `400px`、圆角 `12px`；正文内边距 `16px`，底部生成栏内边距 `12px`，高度由正文渲染结果决定。
- 选中描边为 `2px`；头部操作区位于卡片上方居中，两个按钮均为 `40 × 40px`、圆角 `10px`、间距 `8px`。
- 底部生成栏由自适应宽度的“生成视频”主按钮与右侧 `34px` 宽 chevron 按钮组成，间距 `6px`；菜单向上展开。
- 文本、填充、描边与语义状态色只能使用 `DESIGN.md` token（`var(--tc-*)`）；阴影沿用原型的黑色透明度效果值。

### 3.2 视频生成面板

- 面板固定在 viewport 底部居中，距底部 `24px`，宽 `760px`、最大宽度 `94vw`、圆角 `16px`、内边距 `16px`。
- 顶部为可移除的参考素材缩略图行；引用按 Asset ID 首次出现顺序去重。行内提供“添加图片”“添加视频”两个入口、`当前数量/15` 计数与展开入口。
- 参考素材缩略图悬停预览宽 `128px`，高度按素材原始宽高比计算；预览 portal 到 `body`。
- 提供摄像机、运镜与风格工具行。
- 摄像机、运镜与风格只冻结入口、顺序和 pill 形态；各入口的二级设置不由本原型或本 Spec 新增契约。
- 正文富文本编辑区固定高 `240px`；编辑只影响本次提交。
- 参数摘要显示“模型 · 比例 · 分辨率 · 时长”，修改后实时回显。
- 设置层宽 `560px`，包含模型、模式、分辨率、时长与宽高比。
- 模式仅支持“全能参考 / 首尾帧”，不支持“参考生视频”。
- 分辨率选项为 `720p / 1080p / 4K`；时长范围为 `4–15s`。
- 宽高比提供 `9:16 / 3:4 / 1:1 / 4:3 / 16:9 / 21:9`。
- 切换到首尾帧模式时，宽高比先自动切到首帧图片比例，并移除 `21:9`；其余宽高比仍可由 User 再次选择。
- 底栏固定展示“提交后无法取消”、`1x`、主操作“生成”和收起按钮。
- 点击面板外空白收起整个面板；设置层打开时点击面板内其他区域只收起设置层；下拉框点击外部自动收起。

### 3.3 分镜图设置

分镜图设置层固定在 viewport 底部居中，距底部 `24px`，宽 `420px`、最大宽度 `92vw`、圆角 `16px`、内边距 `16px`。内容包含：图片模型、分辨率、比例、关键时刻（自动、4、9、25、自定义）、目标时长与“生成分镜图”。点击关闭按钮或外部空白收起。

### 3.4 生成产物节点

- 视频与分镜图都是独立 Asset NodeItem，不嵌入 SceneCardNode。
- 视频节点宽 `400px`、高 `225px`、比例 `16:9`；生成中显示转圈，成功后显示播放入口与时长。
- 单张分镜图节点宽 `200px`、高 `112px`，按 `16:9` 展示；节点标题位于节点上方。
- 产物从 SceneCard 实测高度下方 `10px` 开始放置，多产物依次下排。
- 同批作品成组排列；多批作品按首次提交顺序排列。
- 目标区域已有内容时寻找最近空白区域，不移动、修改或覆盖既有节点。

### 3.5 AgentChatPanel 引用 chip

- `@SceneCard` chip 可通过 `×` 移除。
- chip 图标使用场记板；文案取首个一级标题，没有一级标题时显示“场景卡”。
- chip 与输入容器使用 `rounded-md / rounded-lg / rounded-xl` 的递进圆角关系，不出现内外圆角冲突。

## 4. 状态机与恢复

### 4.1 PlanMessage 产出状态

```text
idle
  → preparing（“正在整理计划…”，非消息）
      ├─ committed → 正式、不可变 PlanMessage
      └─ failed → 可恢复失败投影（非消息）
                    ├─ retrying → preparing
                    └─ dismissed → 已隐藏（可短暂撤销）
```

- `committed` 前不得展示可操作正文。
- 失败投影绑定触发 User 消息与 AgentRun，不进入后续模型上下文。
- 重试复用原 User 意图，不重复创建 User 消息；重复点击不得并发生成多张 PlanMessage。
- 关闭失败投影只改变其显示状态，不删除消息、运行原因或诊断事实；新失败是独立状态。
- 关闭状态由服务端持久化，刷新、重新进入 Project 或更换设备后保持一致。

### 4.2 PlanMessage 应用状态

```text
ready
  → validating
      ├─ succeeded → SceneCard + PlanApplicationReceipt 已提交
      ├─ result_unknown → checking ─┬→ succeeded
      │                            └→ failed
      ├─ version_conflict → 基于当前版本继续修改 | 保存为新场景卡
      ├─ target_missing → 仅保存为新场景卡
      └─ failed → 修复原因后由 User 发起新操作
```

- `result_unknown/checking` 跨刷新恢复，期间禁用新的新建或覆盖。
- SceneCard 保存成功是应用成功边界，Canvas 放置失败不得把应用回滚或标成失败。
- 成功后按钮文案改为“再次新建”或“再次覆盖”，不使用含糊的“应用完成”。

### 4.3 SceneCard 与 Canvas 放置状态

SceneCard 本体没有业务状态字段；它只有存在/删除与单调递增的 `version`。Web 另行投影：

```text
SceneCard created or replaced
  → referenced_in_canvas
  └→ pending_placement（由 SceneCard 列表 − Canvas 引用集合推导）
       └→ referenced_in_canvas

SceneCard deleted
  → Canvas 引用已移除
  └→ unavailable_node（实体先删、布局保存失败）→ 可移除
```

本流程不新增 SceneCard `placement_status`。同一 Canvas 中一张 SceneCard 最多一个 SceneCardNode。

### 4.4 SceneCardGenerationRecord

一次首次生成创建一条用户可见记录；“再次生成”创建新记录；“重试失败项”创建关联的新 GenerationJob，但仍归入原记录。

```text
生成中
  ├─ 全部槽位成功 → 全部成功
  ├─ 部分成功、其余终态失败/缺失 → 部分完成
  └─ 无成功且全部终态失败/缺失 → 全部失败

部分完成 / 全部失败
  └─ 重试失败项 → 生成中 → 重新汇总
```

- 输出槽位在首次提交时固定。成功 Asset 永久占据原槽位；重试只补齐失败或异常缺失槽位。
- “重试失败项”复用上次实际提交的 prompt、有序参考 Asset、全部参数与同一来源快照，不打开面板。
- “再次生成”重新读取当前 SceneCard，并以当时系统默认值打开新面板。
- SceneCard 删除后不可再次生成，但仍可重试既有记录的失败项。
- 任务一经接纳即运行到终态；关闭面板、切换页面或退出 Project 均不取消任务。目标版本没有取消按钮、端点或取消状态。

### 4.5 成功 Asset 的首次放置

- 每个成功槽位成为 Project Asset，并对应一个确定性 Asset NodeItem；失败槽位不创建空节点。
- SceneCardNode 仍在 Canvas 时使用其当前位置；卡片已移动则跟随新位置。
- SceneCard 已删除或移出 Canvas 时，回退到 GenerationJob 提交时冻结的 `placement_anchor`。
- 作品处于 `InitialPlacementStatus=pending` 时，Web 可根据最新 Canvas 幂等重试放置；首次成功后变为终态 `placed`。
- User 后续移除已放置节点不得触发自动恢复。
- Canvas 冲突时重新读取最新布局，只加入缺失的确定性节点；连续冲突保持“等待放入 Canvas”，不得误报成生成失败。

Project Snapshot 与 SSE 必须共同恢复同一 SceneCardGenerationRecord、根任务/重试关系、固定槽位、Asset 结果、来源快照及首次放置状态；事件重复不得产生新的业务身份或副作用。

## 5. API 接口契约

### 5.1 通用约束

- 所有资源按服务端认证的 User 与 Project 校验归属；不存在与无权访问统一返回 `404`。
- 所有写命令使用稳定 `Idempotency-Key`。同一业务操作的网络重试复用同一键与载荷；同键异载荷返回 `409`。
- Web 不得从版本号自行拼接 `ETag`；编辑、删除或生成前读取单卡取得服务端返回的最新不透明 ETag。
- 资源正文和请求 JSON 使用 `snake_case`；下方 TypeScript 仅表达数据形状。

### 5.2 SceneCard CRUD

| 方法 | 路径 | 请求 | 成功响应 |
|---|---|---|---|
| `POST` | `/api/scene-cards` | `project_id`、`content_markdown`；`Idempotency-Key` | `201` + `Location` + SceneCard + `ETag` |
| `GET` | `/api/scene-cards?project_id=...` | Project 归属 | `200` + Project 下全部 SceneCard |
| `GET` | `/api/scene-cards/{id}` | 资源归属 | `200` + SceneCard + `ETag` |
| `PUT` | `/api/scene-cards/{id}` | 完整 `content_markdown`；`If-Match`、`Idempotency-Key` | `200` + 新 SceneCard + 新 `ETag` |
| `DELETE` | `/api/scene-cards/{id}` | `If-Match`、`Idempotency-Key` | `204` |

错误语义：

| 条件 | 响应 |
|---|---|
| 正文为空、全空白或素材 URI 非法 | `422` |
| Asset 缺失、失效或跨 Project | `422 scene_card_asset_unavailable`，不得泄露具体类别 |
| 正文超过 64 KiB | `413` |
| 缺少 `If-Match` | `428` |
| ETag 过期 | `412` |
| 缺少或非法幂等键 | 沿用既有 `400` |
| 同幂等键、不同载荷 | `409` |

批量 GET 只用于恢复。Web 在编辑或删除前必须读取单卡取得当前 ETag。

### 5.3 PlanMessage 应用

```http
POST /api/plan-messages/{messageId}/applications
Idempotency-Key: <stable-command-id>
Content-Type: application/json

{ "operation": "create" | "replace" }
```

- 服务端从 `messageId` 读取权威 Markdown，客户端不提交 `content_markdown`。
- `replace` 只能使用 PlanMessage 冻结的默认目标与 `base_scene_card_version`。
- `create` 可用于新建计划，也可用于更新计划的“保存为新场景卡”。
- 写入前依次校验权限、正文大小、安全性、素材可用性、目标存在性与基准版本。
- 成功时在同一事务写 SceneCard 与 `PlanApplicationReceipt`。
- 失败不创建成功记录；系统不得自动把覆盖切换成新建。
- API 必须支持按 `command_id` 恢复首次结果，以处理响应丢失与跨刷新确认。

### 5.4 Conversation、Snapshot 与 SSE 扩展

- PlanMessage 使用新的 `content_type="scene_card_plan"`，不复用生成结果 Card。
- 现有 `conversation.message_completed` 携带完整 PlanMessage 字段；Web 按服务端 `message_id/sequence_no` 一次性 upsert。
- Snapshot 返回同一正式消息形状，SSE 重连不需要 PlanMessage 专用传输通道。
- 计划正文不通过可见 chunk 渐进投影。临时生成状态来自 AgentRun/临时交付投影，不是 ConversationMessage。
- `SceneCardMention` 在 User 消息接纳事务中冻结，并随 Conversation 历史恢复。

### 5.5 GenerationJob 复用

SceneCard 生成继续调用：

```http
POST /api/projects/:projectId/generation-jobs
Idempotency-Key: <stable-command-id>
```

现有 `type`、`input_asset_ids`、`expected_output_count` 与 `parameters` 表达面板最终实际值；新增可选 `origin`。非 SceneCard 的 BottomDock 请求可以不传 `origin`。

```json
{
  "type": "image",
  "input_asset_ids": [101, 102],
  "expected_output_count": 2,
  "parameters": {
    "prompt": "User 在面板中最终确认的完整提示词",
    "aspect_ratio": "1:1",
    "model_id": "doubao-seedream-5.0-lite",
    "size": "2k",
    "web_search": false,
    "sequential_image_generation": false
  },
  "origin": {
    "kind": "scene_card",
    "scene_card_id": "scene-card-id",
    "scene_card_etag": "opaque-etag-from-get",
    "placement_anchor": {
      "x": 120,
      "y": 240,
      "width": 400,
      "height": 1080
    }
  }
}
```

- `model_id`、`size` 与其他参数是控件提交时的真实值，不是固定默认值。
- Product API 以 `scene_card_id + scene_card_etag` 读取权威 SceneCard，并冻结来源 Markdown 快照与摘要；客户端不自报来源正文。
- ETag 变化返回 `412`；SceneCard 删除或无权访问返回统一 `404`。两者均不得创建 GenerationJob、Asset 或生成记录。
- `input_asset_ids` 是 User 最终提交的有序参考 Asset；它可以不同于 SceneCard 原始引用，但来源快照仍保留打开面板时的完整 SceneCard 内容。

### 5.6 Canvas 保存边界

- SceneCardNode 与成功 Asset NodeItem 均通过现有 Canvas `If-Match` 完整 PUT 保存；不新增增量放置端点。
- Product API 本期继续透明保存 Canvas JSON，不解析 SceneCard 引用；Web 保存前检查同一 SceneCard 的重复引用。
- Snapshot 恢复时，重复、失效或越权 SceneCardNode 统一显示“场景卡不可用”并允许移除；Web 绝不读取或显示其他 Project 的正文。
- Product API 接纳首次包含 pending Asset NodeItem 的完整 Canvas PUT 时，在同一提交中保存布局并把对应首次放置状态改为 `placed`。

## 6. 数据模型

### 6.1 SceneCard

```ts
type SceneCard = {
  id: string;                 // 服务端生成的不透明资源 ID
  project_id: string;
  content_markdown: string;   // 非空、非全空白，UTF-8 最大 64 KiB
  version: number;            // 从 1 开始递增；不是版本历史
  created_at: string;
  updated_at: string;
};
```

不持久化标题、镜头数组、素材数组、来源、业务状态或放置状态。服务端原样保存 Markdown，不裁剪、不格式化、不规范化换行。

### 6.2 SceneCardNode

```ts
type SceneCardNode = {
  id: `scene-card:${string}`;
  type: "scene-card";
  position: { x: number; y: number };
  width: number;
  height: number;
  zIndex: number;
  data: { sceneCardId: string };
};
```

Canvas JSON 不保存 Markdown、SceneCard version、时间戳、素材状态、Project 信息或界面状态。React Flow ID 由 SceneCard ID 确定性生成，不形成第二个产品资源身份。

SceneCardNode 的 `width` 固定为 `400`；`height` 保存当时的实际渲染高度。生成提交中的 `placement_anchor` 同样冻结该次提交时的实际尺寸，而不是使用固定高度。

### 6.3 PlanMessage

```ts
type PlanConversationMessage = {
  message_id: string;
  conversation_id: string;
  sequence_no: number;
  role: "assistant";
  content_type: "scene_card_plan";
  content: string; // 权威 Markdown
  based_on_plan_message_id?: string;
  default_application:
    | { operation: "create" }
    | {
        operation: "replace";
        scene_card_id: string;
        base_scene_card_version: number;
        target_preview: string;
      };
  created_at: string;
  asset_references: DerivedAssetReference[]; // 从 Markdown 按出现顺序派生，只读
  recent_application?: PlanApplicationReceipt;
};
```

- `based_on_plan_message_id` 只记录直接来源，不是版本号；来源可以形成并行分支。
- `target_preview` 是发送时的内容摘要或首个非空文本，不是 SceneCard 名称。
- `DerivedAssetReference` 至少表达 Asset ID、Markdown 标签/位置与 `available | unavailable | invalid`；它是服务端派生只读投影，不是第二份可写清单。
- 所有历史 PlanMessage 完整保留、独立可应用；不存在全局唯一“最新版”。

### 6.4 SceneCardMention

```ts
type SceneCardMention = {
  scene_card_id: string;
  scene_card_version: number;
  display_summary: string;
  content_markdown_snapshot: string;
};
```

引用内容随 Conversation 保留，并随 Project/Conversation 删除一并清理；不提供 SceneCard 版本浏览或恢复能力。

### 6.5 PlanApplicationReceipt

```ts
type PlanApplicationReceipt = {
  application_id: string;
  command_id: string;
  plan_message_id: string;
  operation: "create" | "replace";
  scene_card_id: string;
  result_scene_card_version: number;
  applied_content_digest: string;
  applied_at: string;
};
```

`applied_content_digest` 必须证明结果 SceneCard 内容与被点击 PlanMessage 完全一致。Canvas 放置不是该记录的成功条件；失败尝试不创建该记录。计划卡默认只展示最近一次成功应用；完整成功记录按需查看。

### 6.6 SceneCardGenerationOrigin 与记录投影

每个由 SceneCard 发起的 GenerationJob 必须冻结：

- SceneCard ID、生成时完整 Markdown 快照与内容摘要；
- 打开面板时的 SceneCard ETag；
- 提交时 SceneCardNode 的 `placement_anchor`；
- User 实际提交的 prompt、按首次出现顺序去重后的参考 Asset、生成类型、模型、比例、分辨率、时长、数量及其他开关；
- 首次 GenerationJob ID、根任务 ID、`retry_of_job_id` 链、固定输出槽与对应 Asset；
- 每个成功 Asset NodeItem 的确定性身份及首次放置状态。

这些事实属于 Project 权威状态，并通过 Snapshot 与 SSE 恢复。SceneCard 只表达生成来源，不拥有 GenerationJob 或 Asset。

## 7. Markdown 与安全约定

### 7.1 权威正文

- PlanMessage 与 SceneCard 接受自由 Markdown；平台不规定标题、镜头、画面、动作、台词、时长等固定业务模板。
- Agent、Rule 或 Creative Skill 可以提供自己的内容模板，但该模板不成为保存条件。
- 应用 PlanMessage 时逐字保存同一份 Markdown，不重新总结、补全、转换格式或运行 Agent/Creative Skill。
- 直接编辑时富文本只是呈现层，保存结果仍是 `content_markdown`。编辑器不得静默删除未修改的受支持 Markdown 内容。

### 7.2 Asset 引用

唯一素材语法为：

```md
![说明](asset://<asset_id>)
```

- `img_N` 或 `Image N` 只是推荐的可读标签，真正身份是 Asset ID。
- 写入时验证 Asset 存在且属于当前 Project；禁止保存临时 `http(s)` 媒体 URL。
- 读取不因素材后来失效而失败；正文保持原样，Web 将该引用显示为“素材不可用”。
- 失效或无效引用阻止计划应用。系统不得静默删除、替换、忽略或猜测素材。

### 7.3 安全渲染

- 原型冻结的富文本呈现层只为一级标题、二级标题、非空正文行和 `asset://` 引用提供专门样式：一级标题按“主标题 · 弱化时长”展示，二级标题按 Shot 标题展示，其余非空行按段落展示。
- 列表、引用、表格、代码围栏、普通链接及其他自由 Markdown 在本期按不可信普通文字显示，不提供对应富文本控件或可点击行为；其文字内容仍须保留。
- 所有 Markdown 都按不可信内容处理。原始 HTML、脚本、事件属性、内嵌组件与其他可执行内容只作为普通文字显示。
- 图片和视频仅通过平台 `asset://` 引用及鉴权后的预览展示；UI 不直接暴露 `asset://` 地址。
- 外部 `http(s)` 地址只作为普通文字显示；`javascript:`、`data:`、`file:` 等 URI 同样不得执行或内嵌。

## 8. 失败与恢复矩阵

| 场景 | User 可见结果 | 恢复动作 |
|---|---|---|
| PlanMessage 生成中断或校验失败 | 非消息失败投影，不留下半成品 | 按原因修复或用原意图重试 |
| PlanMessage 应用响应丢失 | “正在确认应用结果…” | 用原 `command_id` 查询或安全重放 |
| 覆盖时 SceneCard 版本变化 | 保留计划，提示旧方案不可直接覆盖 | 查看当前版本、重新 @ 修改，或保存为新卡 |
| SceneCard 创建后 Canvas 保存失败 | “场景卡已创建，尚未放入 Canvas” | 只重试确定性节点放置 |
| SceneCard 删除后 Canvas 保存失败 | “场景卡不可用”节点 | 只重试移除节点 |
| 直接编辑 ETag 冲突 | 保留未保存内容 | 停止自动提交，由 User 决定基于当前内容继续编辑 |
| 生成提交时 SceneCard ETag 变化 | 保留面板中的调整 | 重新载入最新内容后由 User 再次提交 |
| GenerationJob 失败或部分完成 | 原记录显示槽位结果 | “重试失败项”只补失败/缺失槽位 |
| 产物 Canvas 放置冲突 | 生成仍成功，显示等待放入 Canvas | 读取最新布局，只新增缺失节点 |
| Snapshot/SSE 重复或重连 | 不出现重复消息、记录、卡片或节点 | 以服务端身份、命令 ID、根 Job + slot 去重 |

## 9. 验收标准

1. Agent 创作可完整走通“需求对齐 → 原子 PlanMessage → 手动新建 SceneCard → 放入 Canvas”，直接生成入口不会产出计划卡。
2. `@SceneCard` 冻结发送时快照；覆盖按基准版本 fail closed，冲突时零写入且保留另存为新卡入口。
3. SceneCard 支持单击选中、双击富文本编辑、`Ctrl/⌘↵`/失焦保存、无确认删除，以及 `asset://` chip 的安全阅读/编辑/预览。
4. 视频面板固定 `1x` 并执行 15 个参考素材上限；“先预览分镜图”走默认值快捷提交，“分镜图设置…”调整后提交。两者均进入 GenerationJob，任务和页面生命周期解耦，失败重试不覆盖成功槽位。
5. Snapshot、SSE、刷新与网络重试恢复同一消息、SceneCard、应用结果、生成记录和首次放置状态，不产生重复副作用。

## 10. 非目标

- SceneCard 或 PlanMessage 的版本历史、回收站与删除确认。
- 后端、Web、mock、数据库迁移或测试代码实现；本文只冻结后续实现所需契约。
- 多张 SceneCard 的编排、时间线、成片合成或多卡任务关系。
- SceneCard 产物在素材库中的运营管理与跨 Project 引用；本期只冻结产物仍是当前 Project Asset。
- 计费系统的任何设计，包括费用提示、额度门禁、`cost_confirmation`、报价、成本预留、结算、对账与费用幂等。
- 生成取消能力、自动核对结果不明的外部供应商任务、自动合并 SceneCard 冲突。
- H3 及更深标题、列表、引用、表格、代码块与普通链接的所见即所得编辑或专门渲染；本期只保证其文字安全显示与保留。

## 11. 决策来源

- [场景卡数据模型与 scene-cards 接口契约](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK4Q4B)：SceneCard、Markdown/Asset 引用、CRUD、ETag 与 Canvas 引用边界。
- [对话计划卡消息类型与应用节律契约](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK4Q4C)：PlanPhase、PlanMessage、SceneCardMention、应用记录与 Snapshot/SSE。
- [场景卡生成链路与产物归属契约](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK4Q4D)：GenerationJob 来源、记录、重试、不可取消与首次放置。
- [场景卡画布交互与视觉原型](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK4Q4E)：SceneCardNode 视觉、富文本编辑、生成面板与产物几何。
- [ADR-0045：Provisional Assistant Delivery 只经 RunCommit 提升为正式消息](../adr/0045-provisional-assistant-delivery-runcommit-boundary.md)：Node 目标架构下正式消息的原子提交边界。
