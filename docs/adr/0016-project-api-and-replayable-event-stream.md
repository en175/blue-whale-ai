# ADR-0016：Project 公开 API 与可重放产品事件流

- **状态**：Accepted（事件流部分已退役，见下方 IKQY3J 说明）
- **日期**：2026-07-14

> **IK3UUX 范围状态**：Limited — 只保留 Product API 是唯一控制面，以及页面刷新/重连后能恢复
> 已接纳状态；Snapshot、SSE、路径、状态码和分页形状由后续实施 Spec 按最小需要定义，见
> [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。

> **IKQY3J 范围状态**（2026-10-27）：`project_events` / `project_event_stream` 两张表、`GET /api/projects/{projectId}/events` 与快照里的 `high_watermark_cursor` 已删除；本文关于 SSE 与可重放事件游标的条款不再实施，快照是唯一恢复面。

## 背景

AgentChatPanel 与 BottomDock 都会在同一 Project 内产生长耗时工作，但两者的产品职责不同：
AgentChatPanel 通过 Conversation 驱动 AgentRun，BottomDock 通过显式参数直接创建
GenerationJob。二者需要共享 Project、GenerationJob、Asset 和状态推送基础设施，同时不能被
压成同一条应用命令路径。

Product API 已被确定为唯一公开控制面。Agent Worker、Generation Worker、
供应商任务和运行时 checkpoint 都是内部实现，不得成为浏览器可见的事实来源。仓库现有 Demo
中的 FastAPI 桩、内存 `JobStreamBus` 与按 Job 建立的临时 SSE 只作为迁移盘点，不定义目标协议。

## 决策

### 1. 两条命令路径独立，共享一个 Project 事件流

公开写入面首版只保留两类入口：

1. **AgentChatPanel**：`POST /api/projects/{projectId}/conversation/messages`
   - 请求携带客户端消息标识、自然语言内容，以及可选的 `reply_to_input_request_id`。
   - 新目标、修改、暂停、恢复、重试、澄清和授权都通过 Conversation 消息表达，不另设
     AgentRun 创建、推进、确认或恢复端点。
   - Product API 先持久化消息，再异步判断它应创建、继续、暂停或排队哪个 AgentRun。
   - 接口返回 `202 Accepted`、权威 `message_id` 与接受该命令后的 `cursor`，不等待 AgentRun
     或 GenerationJob 完成。

2. **BottomDock**：`POST /api/projects/{projectId}/generation-jobs`
   - 请求只接受产品中性的生成类型、输入 Asset、参数与预期输出数量；供应商私有字段不得进入
     公开 DTO。
   - Product API 固定写入 `source=bottom_dock`，客户端不能提交或覆盖来源。
   - 重试通过创建带 `retry_of_job_id` 的新 GenerationJob 表达，原 Job 终态不可改写。
   - 接口返回 `202 Accepted`、`generation_job_id` 与接受该命令后的 `cursor`。

AgentRun 需要生成时，由 Agent Worker 提交内部 RunCommit，Product API 校验并创建
`source=agent_run` 且关联 AgentRun 的 GenerationJob。AgentChatPanel 不直接调用 BottomDock
端点，BottomDock 也不创建 Conversation 或 AgentRun。

公开命令优先使用领域原生身份；只有缺少原生身份的副作用命令才使用 `Idempotency-Key`。身份 scope、
指纹、冲突响应、持久化与留存遵循 [ADR-0052](0052-cross-process-contracts-and-versioning.md)。

### 2. 查询以一致快照为恢复起点

恢复入口为 `GET /api/projects/{projectId}/snapshot`。响应提供：

- Project、Conversation 消息、当前及排队中的 AgentRun；
- AgentRun 当前的活动 UserInputRequest；
- GenerationJob、输出槽位与关联 Asset；
- Canvas 对 Asset 的引用；
- `high_watermark_cursor`。

快照中的全部状态必须至少反映到 `high_watermark_cursor`，客户端随后只需订阅该游标之后的
增量。消息历史或大型集合可以提供分页查询，但分页结果必须声明其 `as_of_cursor`，不能成为
另一套状态权威。

单资源查询用于按标识补取或核对详情：

- `GET /api/projects/{projectId}/agent-runs/{agentRunId}`
- `GET /api/projects/{projectId}/generation-jobs/{generationJobId}`
- `GET /api/projects/{projectId}/assets/{assetId}`

Asset 查询返回产品控制的元数据和带明确 `expires_at` 的签名访问 URL；URL 过期可以重新签发，
但不得改变 Asset 身份。

### 3. 每个 Project 只有一条持久、可重放的 SSE

浏览器通过 `GET /api/projects/{projectId}/events?after={cursor}` 订阅 Project 事件。AgentChatPanel
和 BottomDock 消费同一条流，再按事件类型和聚合标识更新各自视图；命令路径仍保持独立。

- SSE `id` 等于 Project 内单调递增的 `cursor`，`event` 等于 `event_type`，`data` 为完整事件封套。
- 只保证单个 Project 内按 `cursor` 有序，不承诺跨 Project 全局顺序。
- 交付语义为至少一次；客户端按 `cursor` 或 `event_id` 去重，并用 `aggregate_version` 拒绝旧状态。
- 断线后从最后已应用游标重连。若游标已超过保留窗口，服务返回
  `410 CURSOR_EXPIRED`；客户端必须重新获取快照，不允许静默跳到最新位置。
- SSE 心跳使用注释帧，不写事件表、不占游标，也不作为业务进度。

### 4. 事件是 Product API 已接纳的产品事实

每个事件使用下列稳定封套；不发送 JSON Patch、完整快照、供应商原始回调或框架内部消息：

```json
{
  "schema_id": "https://schemas.blue-whale.ai/public-api/events/generation-job-status-changed/v1",
  "contract_version": "1.3.0",
  "schema_digest": "sha256:...",
  "content_digest": "sha256:...",
  "event_id": "evt_...",
  "event_type": "generation_job.status_changed",
  "cursor": "12345",
  "project_id": "prj_...",
  "aggregate_type": "generation_job",
  "aggregate_id": "job_...",
  "aggregate_version": "4",
  "correlation_id": "cor_...",
  "causation_id": "cmd_...",
  "occurred_at": "2026-07-14T10:00:00.000Z",
  "payload": {}
}
```

`contract_version` 是 `public-api` 契约族的完整发布版本；`schema_digest` 标识发布合同，
`content_digest` 覆盖除自身外的完整持久事件，只作为一致性指纹。`occurred_at` 固定为 Product API
接纳该产品事实的时间，事件排序只使用 Project 内单调递增的 `cursor`。`causation_id` 可以引用直接
导致该事件的命令、消息或事件；没有直接原因时缺省，不使用 `null`。

首版公开事件族为：

- Conversation：`conversation.message_accepted`、`conversation.message_chunk_appended`、
  `conversation.message_completed`；
- AgentRun：`agent_run.created`、`agent_run.status_changed`、`agent_run.stage_changed`、
  `agent_run.user_input_requested`、`agent_run.user_input_answered`、
  `agent_run.user_input_expired`；
- GenerationJob：`generation_job.created`、`generation_job.status_changed`、
  `generation_job.progress_changed`、`generation_job.output_attached`；
- Asset：`asset.created`、`asset.metadata_changed`。

Agent 文本只发送 Product API 已持久化并接纳的合并文本块，不逐 token 转发，不暴露原始 reasoning。
`message_chunk_appended` 必须携带消息内单调序号或偏移，重复重放不得重复拼接。生成进度只有在
供应商提供可靠事实时才发送，并进行节流；不得伪造百分比或预计时间。终态与输出关联不得节流
或丢弃。

### 5. UserInputRequest 属于 AgentRun

关键歧义或 GenerationAuthorizationGate 要求补充信息时，AgentRun 创建带唯一
`input_request_id` 的不可改写 UserInputRequest。同一 AgentRun 最多一个活动请求；它不是独立
聚合，因此相关事件仍使用 AgentRun 的 `aggregate_id` 和 `aggregate_version`。

用户通过 Conversation 消息的 `reply_to_input_request_id` 回答。Product API 只有在该标识仍是当前
活动请求时才接纳解锁；已回答、已过期或属于旧请求的迟到回复会保留为消息事实，但不能解除
新的等待状态。公开 API 不提供确认按钮端点或布尔 `confirmed` 命令。

### 6. 版本兼容规则

- 同一 `public-api` major 内允许增加可选字段；新增事件类型必须先登记 Schema、升级接收方，再通过
  默认关闭的发送开关启用。未知 `event_type`、Schema、major 或内容指纹异常时，客户端不得应用
  事件，也不得推进已应用游标。
- 遇到上述不兼容事件时，客户端只允许进行一次同 major 的 Snapshot 恢复。只有 Snapshot 完整
  通过当前合同校验，客户端才能以其状态和 `high_watermark_cursor` 原子替换本地状态并恢复订阅；
  Snapshot 校验或恢复后的订阅再次失败时，必须进入合同不兼容状态，记录最小失败证据并告警，
  禁止循环重连、跳过事件或静默前进游标。
- 只有事件类型已在当前 major 中登记，并且消费者明确声明该事件对自身是安全 no-op 时，消费者
  才能不更新本地状态而推进游标；未知事件不能被事后推断为 no-op。
- 删除字段、改变字段含义或类型、复用旧事件名表达新事实属于破坏性变更，必须发布新的
  `public-api` major，并在迁移窗口内并行支持旧版本。
- Snapshot 与事件流必须使用兼容的 schema；服务不得让客户端以旧快照接续只支持新 schema
  的事件流。
- `correlation_id` 贯穿一条用户意图，`causation_id` 指向直接原因；二者用于追踪，不参与排序。

## 后果

- AgentChatPanel 与 BottomDock 保持两条清晰应用路径，但前端只维护一个 Project 级恢复协议。
- Product API 持久化产品事件成为查询、断线恢复和实时 UI 的共同事实来源，Worker 与供应商不能绕过。
- 需要事件日志、Project 游标、一致快照和保留窗口；其数据库、队列、幂等期限及重试实现由后续
  票据决定。
- 现有按 Job 的内存 SSE 和直接转发 token/供应商状态的做法不能迁移为公开兼容层。

## 不包含

- 后端模块、数据库表、队列或对象存储的具体实现；
- 事件保留时长、幂等键 TTL、重试次数和事务隔离级别；
- 鉴权、计费中台、多区域顺序或跨 Project 全局事件流。
