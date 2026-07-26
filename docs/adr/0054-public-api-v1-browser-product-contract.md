# ADR-0054：public-api v1 浏览器产品合同与恢复边界

- **状态**：Accepted
- **IK3UUX 范围状态**：Superseded — 本文的精确路径、媒体/缓存策略、command 格式、保留期、
  timeline slice 与 API major 退役治理不再冻结；后续实施 Spec 只定义够用的最小接口，见
  [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。
- **日期**：2026-07-26
- **决策者**：KimJohn
- **关联工单**：[确定 Next.js 前端与 Product API 的新内部接口](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UWH)
- **上游决策**：[ADR-0052 跨进程契约与版本策略](0052-cross-process-contracts-and-versioning.md)、[ADR-0053 Conversation 消息排序与 AgentRun 输入队列](0053-conversation-message-ordering-and-agent-run-input-queue.md)
- **历史后续**：精确 public-api 合同票已取消；最小接口由未来实施 Spec 定义。

## 背景

现有 Web、Java Product API 与 Gateway 已形成可运行的迁移基线，但仍混有旧的 Result envelope、
`/api/projects` 路径、手写 DTO、浏览器持久 token、命令级临时状态和分散的 Snapshot/SSE 消费者。
Node.js/TypeScript 全栈重构需要先冻结浏览器看到的产品合同，避免把当前实现、代理层或 UI 投影误当成
长期领域边界。

本 ADR 定义 `public-api` v1 的目标合同和行为规范，不实现接口，也不改变 `agent-work`、
`generation-work`、`payment-control` 或第三方协议。App、第三方登录和服务调用使用独立认证流程与合同。

## 权威与迁移优先级

本 ADR 是浏览器 `public-api` v1 目标态的权威决策。它取代以下旧文档中与目标浏览器合同冲突的部分：

- ADR-0011 中 Canvas 直接保存 Asset 节点、共享 viewport 和生成结果自动落布局的描述；
- ADR-0016 中 `/api/projects/...` 路径、消息或 Job 一律 `202`、签名 URL 进入查询响应和旧事件恢复细节；
- ADR-0017 中 public-api 幂等 scope 包含 project/operation 的规则；
- ADR-0036 中无效 UserInputRequest 回复仍创建 Message 的规则；
- ADR-0052 中 public-api “只有缺少领域身份才用 Idempotency-Key”、`violations` 字段和流内 Problem 的通用描述。

这些旧规则可以继续解释迁移前实现，但不得用于生成新 public-api 合同、客户端或测试。迁移必须直接切换
到本 ADR，不建立重定向、双写、静默回退或运行时协商。

## 决策

### 1. 产品权威、入口与浏览器认证

Product API 是认证与产品事实的唯一权威。Next.js Route Handler 是同源透明代理，只负责 Cookie 边界、
请求转发和受控 header 注入，不承载领域认证、授权、幂等、资源状态机或业务 DTO。

- 外部入口全站 HTTPS 并启用 HSTS；入口到 Product API 使用双向 TLS，网络策略禁止绕过入口直连。
- 浏览器 access token 只存内存；续登凭证只存 `__Host-` 前缀、`Secure`、`HttpOnly`、
  `SameSite=Strict`、无 `Domain` 的安全 Cookie。
- Product API 原子轮换续登凭证并维护凭证族。浏览器用 Web Locks 和页面间通知协调并发续期；只有同一
  续期请求编号的网络重试可幂等返回原结果，其他已使用凭证再次出现立即撤销整次登录会话。
- 精确 Origin、`Sec-Fetch-Site` 和防伪请求头必须同时通过，缺失即拒绝。登录、续期、退出只接受改变
  状态的方法和 JSON，GET 不得改变认证状态。
- 只有明确 `access_token_expired` 的 `401` 可以触发一次协调续期和原请求重放；其他 `401`、`403` 或
  再次失败立即结束认证流程，禁止刷新循环。
- 主动退出原子撤销服务端会话、清除安全 Cookie，并通知所有页面立即清除 access token、内存投影和
  未收敛界面状态。多标签正常并发不得导致误撤销。

### 2. HTTP 资源模型、状态码与并发保护

公开接口采用资源查询与有名称的业务子资源；不引入 GraphQL、tRPC、通用 RPC envelope、通用
`/commands` 或前端可见的内部领域实体。

- GET 只读，不产生业务事实。
- 创建可查询资源或业务申请返回 `201 Created` 和同主版本 `Location`。
- 只有尚未完成接纳的后台请求返回 `202 Accepted`，且返回稳定回执和同主版本进度查询地址。
- PUT 只用于前端完整拥有的资源；其他修改使用字段受限 PATCH 或有名称的业务子资源。
- 并发修改使用强 ETag 与 `If-Match`。缺失返回 `428`，过期返回 `412` 并以 ETag 给出当前版本。
- 幂等重放返回首次接纳结果，不重复产生业务事实。

### 3. public-api 版本与共享合同制品

浏览器合同路径固定为 `/api/v1/...`；次版本和补丁版本不进入路径，也不参与运行时协商。浏览器认证接口
位于 `/api/v1/auth/...`。所有 `Location`、后台任务、Asset 内容与 SSE 重连地址保留相同主版本；不支持
的主版本返回稳定版本错误，不默认到其他版本。

TypeBox Schema 与结构化 HTTP、Snapshot、SSE、Problem 描述是唯一人工编辑源。固定版本的生成工具产出
不可变中立合同包、生成客户端、完整合同版本和标准化内容摘要。CI 必须证明重新生成无差异，并证明同一
主版本相对上一正式版本兼容。Web 只消费合同包与生成客户端，不依赖 Product API 源码，也不得手写第二套
DTO、路径或解析器。

响应中的完整合同版本只用于诊断，不能用于请求协商、自动回退或部署信任。SSE 事件携带固定的
`contract_version`、`schema_id` 和摘要；客户端不得动态下载或猜测解析器。Web 制品固定生成客户端、完整
合同版本与摘要；部署前验证客户端和服务端兼容，不要求完整版本完全相等。v1 的支持期限、通知期与退役
条件由独立决策在公开发布前冻结。

传输字段保持 `snake_case`，进入界面前显式转换。所有响应和事件先完整验证：新增可选字段可以忽略且
不得作为业务判断；缺少必需字段、未知枚举或摘要不符是不兼容；未知事件仅在合同明确标记为“不改变产品
状态”时才可跳过。不兼容先允许一次同主版本 Snapshot 恢复；仍失败则只暂停受影响 Project 或功能，保留
版本、`schema_id` 与 `request_id`，禁止循环恢复或污染已有状态。

### 4. 四类身份与一个流位置

以下身份严格分离，禁止相互推导、替代或参与其职责之外的鉴权、排序与权限判断：

1. `command_id`：业务命令身份，等于规范化的 `Idempotency-Key`。
2. `request_id`：一次物理网络尝试，由第一个可信入口生成并通过 `X-Request-ID` 返回。
3. `traceparent`：仅用于诊断；每次尝试创建新 span/parent-id，trace-id 可延续或在信任边界重建。
4. `event_id`：持久产品事件的稳定去重身份。
5. `cursor`：Project 事件的服务端排序、历史补齐和 SSE 重连位置，不是事件身份。

入口删除浏览器传入的 `X-Request-ID` 后重新生成；普通重试、401 后重放和 SSE 重连均取得新值。无效
`traceparent` 被忽略并重建，不能拒绝业务；外部 `tracestate` 与 `baggage` 默认删除，仅明确白名单的
非敏感字段可传播，客户端不能强制服务端提高采样率。

SSE `id:` 字段承载 cursor，已验证数据封套内保留 event_id。同一 event_id 对应不同 cursor 或摘要是
完整性错误。心跳与连接控制信息没有产品 event_id，也不推进 cursor。Web 只保存最后成功验证并原子应用
的 cursor，不能用“最后收到但未应用”的值重连。直接命令事件可携带 `causation_command_id`；后台事件
只把它作为诊断关联，业务判断不得依赖。

### 5. public-api 自有 Idempotency-Key 合同

`Idempotency-Key` 只用于会创建或修改产品事实的请求；GET、HEAD、SSE 建连和浏览器认证接口禁止携带。
禁止接口携带时返回 `400 idempotency_key_not_allowed`；必需接口缺失返回
`400 idempotency_key_required`；格式错误返回 `400 invalid_idempotency_key`。

线路值必须是单个、未经引号包裹、未经裁剪或大小写转换的 36 字节 ASCII 字符串，并严格匹配
`^cmd_[0-9a-f]{32}$`。客户端生成高熵值；作用域固定为
`(authenticated_subject, public_api_major, command_id)`。`authenticated_subject` 必须是认证系统不可
复用的主体身份，不能使用邮箱或显示名。相同 key 跨 operation 使用仍落入同一作用域并发生摘要冲突。

Product API 对明确的复合 JSON 对象执行 RFC 8785 JCS，再计算 UTF-8 字节 SHA-256。对象固定包含：

- 同一 major 内不可改名的 `operation_id`；
- 规范化 path；
- 合同声明的 query；
- 合同声明的业务相关 headers；
- 原始业务 body 的 JSON 值。

JSON 必须先拒绝重复字段、非法 Unicode 和非 I-JSON 数字，再进行 Schema 验证。摘要前不得补默认值、类型
强转、删除字段或执行 Unicode 规范化。合同必须提供跨语言黄金测试向量。

认证、权限、CSRF、key 格式、媒体类型、JSON 解析和请求 Schema 校验先执行，失败不消费 key。进入业务
接纳后按作用域键串行化：同 key 同摘要的并发请求只有一个执行，其余等待首次事务结果；同 key 不同摘要
返回 `409`。合同 metadata 必须为每个 Problem code 明确标记 `consumes_key`，不能按 HTTP status 推断。
`429`、`503` 和事务回滚不消费；Product API 已提交后即使网关断线或返回 `502/504`，key 已消费，重试
必须恢复原回执。缺少 If-Match 是接纳前失败；已携带旧 If-Match 的确定性 `412` 可以形成回执。

成功事务原子写入业务事实、事件和回执；确定性业务拒绝原子写入回执但不产生业务事实。回执只保存业务
状态、业务响应正文和白名单头 `Location`、`ETag`、`Content-Type`，不保存 Date、Set-Cookie、
request_id、trace 或其他传输头。重放保持首次业务结果并注入本次尝试的新 request_id；响应必须限长，
流式正文不得作为回执。

完整回执自首次形成保留 90 天，重放不续期。期满删除正文与可变元数据，仅保留作用域键的不可逆查找
摘要墓碑，至少持续到该 public-api major 最终退役后 365 天。命中墓碑统一返回 `409 key_expired`，不比较
或泄露旧摘要，也绝不重新执行。结果不明只能用原 key 和完全相同请求重试。合同借用 IETF 工作草案的
header 名称，但不采用 Structured Field 引号格式，也不依赖草案补全语义。

### 6. GenerationInbox 与 Project 恢复入口

GenerationInbox 是每位用户最多一个活动实例的特殊 Project，不建立第二套聚合或恢复模型。

- `GET /api/v1/generation-inbox` 只探测；未创建时返回 `200` 与明确 `absent`，不创建数据。
- 首条消息 POST 原子创建 GenerationInbox、Conversation、Message 和 AgentRun；同消息重试返回首次结果。
- 多页面并发首发仍只产生一个活动 GenerationInbox，不同消息按服务端顺序进入同一实例。
- 专用接口只负责发现、首次创建、对话入口和永久删除；Snapshot、SSE、Asset 使用返回的同主版本 Project
  地址。
- 普通 Project 列表、创建、重命名、删除等修改接口必须在服务端拒绝 GenerationInbox。
- 永久删除先关闭旧实例写入资格再清理；迟到 Worker、回调或重试不得恢复旧实例。删除后 GET 返回
  absent，下一条首消息创建全新实例和 `project_id`。

### 7. 单 Project Snapshot、SSE 与历史分页

每个浏览器页面内，每个活动 Project 最多运行一套恢复状态机和一条 SSE；AgentChatPanel、BottomDock、
Canvas 与 GenerationInbox 共享它，不各自轮询。

Snapshot 在同一一致性点返回完整活动工作状态和 `high_watermark_cursor`。验证成功后原子替换当前本地
投影，禁止拼接新旧状态。已归档消息与已结束任务不无限进入 Snapshot，而通过与 Snapshot 水位绑定的反向
keyset 分页读取。命令响应只确认接纳和支持立即展示，最终状态统一由 Snapshot/SSE 收敛。

SSE 从 high-watermark 后补齐历史再进入实时流，只按服务端 cursor 排序，提供心跳和退避重连。活动中的
AssistantDeliveryAttempt 作为独立临时投影进入 Snapshot 并由独立事件更新，永不成为正式
ConversationMessage。遇到 cursor 过期、事件缺口、未知关键事件、摘要错误或版本不连续时停止应用；每次
数据事故只允许一次同主版本 Snapshot 恢复，普通网络故障可以正常重连。

Snapshot 最近消息与 `/messages` 历史页使用同一 `ConversationTimelineSlice`：正式消息加固定类型的
`included`，包含重建 Card 所需的最小 AgentRun、GenerationJob、GenerationOutputSlot 和稳定 Asset
元数据。切片自包含、不返回 Card、BottomDock 结果、对象位置或临时访问地址，也不逐 Card 查询。

Snapshot 返回可空的 `message_high_watermark_sequence_no`、`oldest_included_sequence_no`、
`has_older` 和 `next_older_url`。空 Conversation 的序号为空、`has_older=false` 且无历史地址。Web 只能
请求服务端返回的地址，不能解析、修改或构造 cursor。cursor 防篡改并绑定 User、Project、Conversation、
Snapshot 水位、上一边界、方向、页大小和格式版本；每次请求重新鉴权，升级不能立即破坏仍有效的旧 cursor。

每页只读取小于上一边界且不超过 Snapshot 水位的消息；数据库可反向查询，但响应按 `sequence_no` 正序。
页面回显水位及本页最早、最晚序号，只有确有更早消息才返回下一地址。分页期间的新消息只由 SSE 加入实时
尾部。Web 完整验证后一次性合并：同 message_id 必须对应同 sequence_no 和内容摘要，同 sequence_no 只能
对应一个 message_id；相同重复项去重，冲突停止历史加载。客户端不假设序号连续，也不从缺号推断页面。

无效 cursor 返回 `invalid_history_cursor`，保留策略导致锚点失效返回 `history_anchor_expired`；二者只停止
旧消息加载，保留 Snapshot 与 SSE。新 Snapshot 必须丢弃旧 cursor；历史读取不产生产品事实且禁止共享缓存。

`included` 只允许 source=agent_run 且明确归属当前 Conversation 的输出槽。初始槽拥有不可变
`display_after_sequence_no`：优先同事务 AssistantMessage，否则取该 Advance 已消费输入最高序号；必须
指向同 Conversation 正式消息。服务端按 Job 接纳顺序和 slot 顺序生成稳定 `display_order`。重试携带不可变
`root_output_slot_id` 并继承显示锚点；Web 用 Conversation 上下文与 root id 生成 projection_key。

Snapshot 水位只冻结消息范围；`included` 在每页一致读取点返回当前权威状态及
`included_as_of_project_cursor`。资源 version 单调可比较：高版本更新、低版本忽略，同身份同版本但摘要
不同才是冲突。消息与 included 全部验证后一次性合并；服务端可以减少消息条数满足总大小限制，但不能拆开
单条消息的 Card 依赖图。

### 8. 本地提交反馈与未知结果

Web 允许本地反馈，但不能乐观创建产品事实。`201/202` 或权威 SSE 到达前，只能显示明确标记为本地临时
状态的 `submitting/confirming`；不得创建 Message、GenerationJob、结果 Card、NodeItem 或伪造服务端 ID。

接纳响应和 SSE 无顺序保证。客户端以 command identity、资源 ID 与 version 原位合并，任一权威结果都可
结束提交状态。Job 接纳后可以显示绑定真实 Job ID 的生成中 Card；只有 Asset 正式接纳后才能创建结果 Card
或 asset NodeItem。明确拒绝时保留输入、参考素材和 Skill 选择；超时或结果不明显示“正在确认”，只查询
回执或用原身份、原内容重试。

浏览器短期保存未收敛命令的身份、类型、Project、摘要和回执地址，刷新后先核对；用户修改内容必须创建新
command identity。这里的短期保存不得包含权威投影或 access token，并须在独立实现合同中限定寿命与清理。
所有本地临时状态和待提交内容不得进入 Snapshot、领域事件、Conversation 或后续 Agent 上下文。

### 9. Canvas 布局、Card、NodeItem 与首次放置

Web 完整拥有的是 Canvas 共享布局文档，而不是全部 Canvas 产品事实。布局只含 NodeItem 引用、位置、尺寸、
层级；Asset 归属、生成状态、NodeItem 身份与审计由 Product API 管理。缩放、选择、面板和拖动过程默认是
个人界面状态。

GET 返回完整布局和强 ETag；PUT 携带 If-Match、稳定 command identity 和完整文档。省略 NodeItem 只从
布局移除，不删除 NodeItem、Asset 或生成记录。Web 分开保存服务端已确认版本与本地工作副本；自动保存
合并等待，同一 Canvas 至多一个请求，保存期间的新修改在获得新 ETag 后再提交。SSE 不直接覆盖未保存内容。

服务端不静默改写提交文档；规范化规则进入合同。接纳后返回新 ETag、version 与内容摘要，由 SSE 幂等
确认。`412` 或远端更新时停止自动保存、保留完整本地版本，由用户选择加载最新或明确覆盖，禁止自动合并。
结果不明只用原 command identity、原 If-Match 和原文档重试；冲突处理后是新命令。合同限制文档大小和
节点数，并监控冲突率；只有规模或冲突数据证明需要时才另行决策增量保存。

Card 是 Web 根据 Conversation、GenerationOutputSlot、GenerationJob 与 Asset 生成的界面投影，无服务端
身份、version、表或修改接口。生成中、失败、取消且没有 Asset 的输出也可投影 Card；projection_key 只能
由权威来源身份确定，不是产品资源 ID。

NodeItem 是 Product API 管理、可放入 Canvas 的 Project 资源，拥有服务端 ID、强 version、来源和最小
审计，不保存布局、对象位置或访问地址。`kind` 创建后不可变：

- `asset` 必须引用已接纳 `asset_id`，不得含文本；同一 Asset 可对应多个独立 NodeItem。
- `text` 必须是合同限长的纯文本，不得含 `asset_id`；只表达用户明确创建的标题、说明或创意便签。

Agent 推理、Brief、审核说明、任务状态和过程文字只在 Conversation/Card 呈现。v1 禁止系统或 Agent 自动
创建 text NodeItem，text 也不能自动成为生成素材或 Agent 上下文。文本工具先产生本地草稿；用户确认非空
后返回 `201 + Location` 创建 NodeItem，再把服务端 ID 放入布局工作副本。文本 PATCH 受字段限制，使用
If-Match 与稳定 identity；`412` 保留本地内容并停止自动保存。

普通上传只创建 Asset。用户明确“添加到 Canvas”时创建新 NodeItem；浏览器不生成 ID。生成结果只有在 Job
创建时记录明确“进入 Canvas”意图，才可在 Asset 发布时原子创建初始 NodeItem；每个 job+output slot 至多
一个，Product API 不根据页面或入口猜测。永久删除 NodeItem 使用独立条件式操作；当前布局仍引用时拒绝，
且不级联删除 Asset。

NodeItem 创建与首次放置是两个产品事实。一次性 `initial_placement_status` 为 pending、placed 或
dismissed；后两者终态且不表示当前布局。只有持有原创建或 Job 回执的页面可以自动尝试首次放置，这是 UI
协调而非权限。首次包含 pending NodeItem 的 Canvas PUT 必须原子保存布局并置 placed；任一失败均不生效。
关闭页面、结果不明或 `412` 后保持 pending，通过 Snapshot 待放置投影恢复；用户可明确放入、暂不放置或
永久删除。不得自动过期、删除、后台放置或合并冲突，从布局移除也不重新产生待放置提醒。

### 10. Asset 生命周期与内容访问

Product API 管 Asset 生命周期，对象存储只执行字节存储和安全策略。上传会话不是 Asset；Product API 绑定
用户、Project 与唯一对象位置，浏览器不能指定桶或 key。一个会话至多接纳一个 Asset，重复完成通知返回
同一结果。

上传地址短期有效，只允许指定对象和方法，不带产品凭证或 Cookie。存储侧尽量预限大小、类型和摘要，但
最终接纳重新校验实际大小、合同摘要、真实类型、Project 归属和安全扫描；对象存储 ETag 不是内容摘要。
过期会话、废弃对象和未完成分片自动清理。新内容进入私有隔离区，正式接纳前不能通过规范内容地址访问。

`POST /api/v1/asset-uploads/{upload_id}/completion` 使用稳定 identity；同步完成返回
`201 + Asset Location`，需要
扫描或处理返回 `202 + 稳定回执`，拒绝不创建 Asset。只有正式 Asset 才进入 Snapshot、SSE、Card 或 Canvas。
Snapshot/SSE 只含稳定 Asset identity、version 和安全元数据，不含对象位置或签名 URL。

`/api/v1/assets/{asset_id}/content` 每次重新鉴权。敏感内容由 Product API 流式返回；普通大文件可使用极
短期只读重定向。已发重定向在过期前无法立即撤销，因此高敏感或要求即时撤权内容禁止重定向。

### 11. Conversation 消息与 AgentRun 输入队列

已有 Conversation 统一通过 `POST /api/v1/conversations/{conversation_id}/messages` 接纳消息。一个事务
创建不可变 Message、分配 `sequence_no`、创建或选择唯一活动 AgentRun、登记 PendingConversationInput、
写事件与回执，并返回 `201 + Message Location`。GenerationInbox 首条消息使用专用原子入口。

command identity 是唯一提交关联与幂等身份，删除 `client_message_id`。幂等回执查询先于当前状态校验；同
identity 同内容始终返回首次 `201`，不同内容返回 `409`。响应与 SSE 携带命令关联，支持 SSE 先到。

Conversation 内用户与助手正式消息共用服务端 sequence_no，客户端时间不排序。每个 Conversation 至多
一个非终态 Run，每个 Run 至多一个执行中 AgentAdvance。Advance 启动时固定本轮输入上限，后到消息只进入
有序队列，不改变正在执行的模型输入，也不撤销已经开始的操作。

消息接纳与 Run 封口按同一服务端顺序裁决：消息先接纳时 completed 只是完成候选，当前 Advance 提交后
Run 保持活动并为待处理输入创建下一 Advance；封口先完成时新消息创建新 Run。failed、cancelled 或
recovery_failed 封口必须在同一事务中为未消费输入创建后继 Run。Run 等待 UserInputRequest 时，只有携带
准确 `reply_to_input_request_id` 的消息可以原子创建 Message、回答并恢复同一 Run；缺失、过期或不匹配
返回稳定 `409` 且不创建 Message。成功响应返回 message_id、接纳时 agent_run_id、sequence_no 与 cursor。

详细状态机见 ADR-0053；ADR-0043 D3 的普通新消息 supersede 规则已废止。

### 12. GenerationJob cancellation 与 retries

取消和重试使用有名称的业务子资源，新合同直接退役 `/cancel` 与 `/retry`，不重定向、回退或双写。

`POST /api/v1/generation-jobs/{job_id}/cancellation` 不要求 If-Match。首次创建唯一
GenerationCancellationIntent 返回 `201 + Location`；精确幂等重放返回首次 `201`；不同命令发现意图已存在
返回 `200 + 原 Location`，不重复事件。Job 已无可停止工作且无原意图时返回稳定 `409`。

取消意图一经接纳立即禁止新 Attempt、自动重试和未开始供应商调用，但不直接把 Job 置 cancelled。已发
调用继续核对，真实结果继续审核接纳，真实成本继续结算。只有供应商确认取消或平台证明未发请求时 Job 才
进入 cancelled；Snapshot/SSE 分别表达“已请求取消”和最终状态。

`POST /api/v1/generation-jobs/{job_id}/retries` 携带源 Job If-Match、稳定 identity 与
`root_output_slot_ids`。幂等回执查询优先于版本校验；缺版本 `428`，过期 `412`。全部根槽必须整体通过
资格校验，不部分创建。完整谱系不得已有成功 Asset、活动 Job、未决供应商结果、审核恢复或其他活动重试；
普通重试与 review-retry 共享排他资格。Product API 返回稳定 `retry_eligibility` 与 `reason_code`，Web 不从
状态名推断。

新重试 Job 只复制不可变生成需求、素材引用、root_output_slot_id 与显示锚点；重新校验权限、素材、模型、
政策、额度与成本，并建立新策略绑定、Attempt 和成本预留。修改提示词、模型或参数是全新生成；审核恢复
只走 `/review-retries`，不能再次调用供应商。成功返回 `201 + 新 Job Location`，不返回 `202`。结果不明时
取消只按原请求重试；普通重试使用原 identity、原 If-Match 与原请求重试。自然语言重试与
GenerationAuthorizationGate 规则不变，接口本身不授权新增 UI 按钮。

### 13. RFC 9457 Problem、重试与安全披露

Product API 与 Gateway 产生的应用层非 2xx 统一使用 `application/problem+json`；`type` 与 `code` 一一
对应，前端业务判断只用二者。`status` 只表达 HTTP 分类，`detail` 只供用户阅读。字段错误使用 `errors[]`，
每项包含 JSON Pointer、稳定 code 与安全提示。幂等 identity 与摘要冲突返回 `409`。

`429/503 Retry-After` 只建议等待，是否重试取决于操作类型并保持原 command identity 与原请求。TLS、断网、
超时、结果不明及 SSE 建立后的流中断不是 Problem。未知错误安全停止并显示通用提示，保留 request_id；
堆栈、SQL、供应商原文、凭据和敏感审核原因不得公开。

### 14. 默认不缓存

`/api/v1` 全部成功、重定向、Problem 以及入口或网关错误默认使用 `Cache-Control: private, no-store`。
CDN 必须绕过；Service Worker 不得拦截、读取或写入其缓存。强 ETag 只用于并发保护；除合同明确声明可
重新验证外，客户端和服务端不得使用 If-None-Match 或 `304`。

SSE 使用 `text/event-stream` 与 `private, no-store, no-cache, no-transform`，入口、代理和压缩层关闭缓冲、
压缩与内容转换。Asset 稳定入口与重定向每次重新鉴权并 no-store；只有合同标记为低敏感、不可变字节时，
签名地址可以使用 `private, max-age`，有效期不超过签名剩余寿命和业务撤权窗口。即时撤权内容始终不缓存。

公开可缓存合同制品和静态资源必须位于 `/api/v1` 外，地址含内容指纹、不含用户状态，并显式使用
`public, max-age=..., immutable`。上线迁移清除旧 CDN 与 Service Worker 缓存。内存投影在退出、切换用户
或 Project 时清空；未经独立离线方案决策，不写入持久化浏览器存储。

### 15. 固定媒体类型

带 JSON 正文的操作必须携带唯一、无参数的 `application/json`；媒体类型名称按 HTTP 规则不区分大小写，
生成客户端发送小写规范值。`Content-Encoding` 必须缺失。媒体类型缺失、错误、带参数或存在编码分别返回
稳定 `415` Problem。

正文必须是无 BOM 的有效 UTF-8 JSON。已声明 JSON 但正文乱码、带 BOM、语法错误、字段名重复、含无效
Unicode 或无法进行既定 JCS 规范化时返回 `400 invalid_json`，不返回 `415`；字段结构或业务值不符合合同
进入字段校验 Problem。

有正文的普通成功响应固定为 `application/json`，错误固定为 `application/problem+json`，SSE 固定为
`text/event-stream`；无正文响应不伪造 Content-Type。媒体类型参数不得承载版本、Schema 或回退信息。

JSON 客户端发送 `Accept: application/json, application/problem+json`；SSE 客户端发送
`Accept: text/event-stream, application/problem+json`。缺失 Accept 或 `*/*` 接受唯一固定格式；明确排除
成功格式时在业务接纳前返回 `406`。任何错误仍使用 Problem，不切换错误格式。所有 `400`、`406`、`415`
均不消费 Idempotency-Key，也不产生产品事实。

Asset 内容不转码，使用服务端核验后的真实媒体类型并返回 `X-Content-Type-Options: nosniff`。只有明确
白名单的被动媒体类型可以内联；HTML、SVG、XML 等主动内容及未单独批准的复杂文档必须下载。下载文件名
由服务端安全生成，不直接采用用户原始路径或控制字符。

## 一致性与迁移结论

冻结决策之间不存在未解决冲突。需要迁移的现有实现包括但不限于：

- Web 的 `apiRequest` / `apiFetch`、手写 DTO、Result envelope 与 `/api/...` 路径；
- access token 与 refresh token 的 localStorage 持久化；
- `/cancel`、`/retry`、客户端生成 Message/NodeItem ID 和 Card 自动落 Canvas；
- 当前 Snapshot/SSE 解析器、游标恢复、错误 envelope 与旧缓存 header；
- Java 的旧 public API operation、幂等 scope、成功状态码和返回 DTO。

这些是后续合同与实现票的迁移缺口，不是允许继续存在的第二套目标合同。旧入口在新合同启用时直接退役；
不得通过兼容层把旧语义带入 v1。

## 验收矩阵

后续 public-api 合同和实现至少必须证明：

1. TypeBox 中立制品、生成客户端、跨语言 JCS/摘要黄金向量、Problem `consumes_key` metadata 与同 major
   兼容检查可重复生成且无漂移。
2. auth 多页面并发、凭证轮换/旧凭证复用、刷新恢复、全页退出、CSRF、HSTS、mTLS 和禁止直连均有场景测试。
3. 命令响应先到或 SSE 先到、超时后原 identity 重试、90 天回执与墓碑、412 消费规则都只产生一次事实。
4. Snapshot/SSE/历史页对游标过期、缺口、未知事件、摘要错、版本前后、重复页和依赖图冲突安全停止，且
   每次数据事故至多一次 Snapshot 恢复。
5. Canvas 412、保存中继续编辑、pending 首次放置、多标签首次创建、Asset 隔离/扫描/撤权和 NodeItem 删除
   均不丢事实、不静默覆盖、不产生伪造身份。
6. Conversation 消息与 Run 封口的两种先后顺序、等待输入的精确回复、失败封口输入转交和 Advance 输入
   水位固定都确定性收敛。
7. cancellation 与 retries 的并发、幂等、资格谱系、真实供应商晚到结果、审核恢复和成本结算不重复执行。
8. `/api/v1` 的 no-store、Service Worker/CDN 绕过、固定 Accept/Content-Type、非法 JSON 分类、Asset
   `nosniff` 与安全 disposition 在 Gateway 和 Product API 两层均得到验证。

## 被否方案

- 让 Next.js 形成领域 BFF 或第二认证权威；
- access/refresh token 都写入浏览器持久存储；
- refresh token 上一代凭证在时间窗内可通用重放；
- 每个组件独立 Snapshot、轮询或 SSE；
- 乐观创建产品资源、浏览器生成产品 ID；
- Card 持久化、NodeItem 保存布局、Canvas PUT 冲突自动合并；
- 通用 `/commands`、`/cancel`、`/retry`、GraphQL、tRPC 或 RPC envelope；
- 运行时版本/媒体协商、动态下载解析器或失败后回退；
- public-api 默认缓存、CDN/Service Worker 接触 `/api/v1`；
- IETF Idempotency-Key 草案隐式决定本产品的格式或语义。
