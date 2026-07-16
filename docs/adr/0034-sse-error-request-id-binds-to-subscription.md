# ADR-0034：SSE 错误的 request_id 绑定当前订阅请求

- **状态**：Accepted
- **日期**：2026-07-16

ADR-0018 已定义 `request_id` 标识一次公开 API 请求。GenerationJob 的失败事实可以由异步 Worker
产生，并通过同一条 SSE 历史事件实时发送或重放给多个订阅请求，因此该事件本身不拥有唯一的
`request_id`。

SSE 事件与历史记录保持请求无关；每个 SSE 订阅在建立时捕获自己的 `request_id`，并在向该订阅
发送或重放公开错误信封时由传输边界注入。同一业务错误发送给两个订阅时可以带有两个不同的
`request_id`。跨请求关联同一 GenerationJob 或产品流程使用 `correlation_id`；如需保留创建 Job
的原始请求标识，使用单独的 `origin_request_id`，不得用它或 Worker 生成的合成标识冒充当前
`request_id`。

IK10PT 不把 `origin_request_id` 加入公开错误 schema。原始创建请求只通过 GenerationJob、
AuditRecord、Trace 与 `correlation_id` 在内部追踪；未来只有出现明确的公开消费者后，才另行定义
该字段的来源、保留与访问边界。

`request_id` 由请求进入系统的第一个受信任入口生成一次。当前部署由 Java Product API 生成；
未来如果增加经过认证的受信任网关，则由该网关生成并向内部透传。来自不可信外部客户端的同名
请求头不构成权威标识，必须忽略或覆盖；下游服务与 Worker 只能透传，不能重新生成。

非空 `request_id` 是注册 SSE 订阅的硬前置条件。传输边界缺失该标识时，必须在注册
`SseEmitter` 前以内部错误中止并告警，不能发送 `null`，也不能由 Worker、事件总线或发送线程生成
替代值。启动验证和集成测试必须证明 Request ID Filter 覆盖全部公开 API，并验证 SSE 错误信封中
的 `request_id` 与该订阅响应头中的标识一致。

订阅级 `request_id` 只装饰 `image_failed`、`error` 等公开错误信封。`image`、`done` 等成功事件
保持纯业务载荷，不扩展公共 schema；业务事件身份继续使用事件 ID、Project cursor 或
`correlation_id`，不使用 `request_id`。

本决策约束所有公开 SSE 的错误信封。IK10PT 只修复当前实际产生该信封的 Job SSE，不迁移或重写
既有 SSE 架构；后续公开 SSE 必须复用本契约。内部消息流、Worker 通道和非公开事件不适用订阅级
`request_id`。

持久化的是业务错误事实，不是交付请求标识。进程重启后，客户端通过权威 Job 状态、Project
Snapshot 或持久化产品事件恢复；向新订阅重放错误事实时使用新订阅的 `request_id`。不得持久化、
重建或伪造旧订阅标识，当前 Job SSE 内存历史是否升级为持久化机制不属于 IK10PT。

共享 SSE 事实和历史 `SsePayload` 必须保持不可变。订阅注册保存不可变的
`SseSubscription(emitter, requestId)`；传输边界仅在向具体订阅交付公开错误时创建带该订阅
`request_id` 的 payload 与错误信封副本，禁止原地修改共享对象。成功事件可以复用请求无关的原
载荷。

因此，异步生产者不得把 Servlet 请求上下文固化进可重放的 SSE 载荷；实现必须分别验证实时发送、
历史重放和多订阅者场景下的请求标识归属。

## 验收

以下场景全部是 IK10PT 合并前的硬门槛：

- 实时错误信封的 `request_id` 非空，并与当前 SSE 响应头一致；
- 历史错误重放使用新订阅标识，不携带生产时或旧订阅标识；
- 两个并发订阅接收同一错误时各自使用自己的标识，不发生串号；
- 断线重连获得新标识，业务错误事实不变，客户端不以 `request_id` 去重事件；
- 缺失订阅标识时拒绝注册，不发送带 `null` 的错误；
- 不可信客户端提交的 `X-Request-Id` 被忽略或覆盖；
- `image`、`done` 等成功事件 schema 保持不变；
- 现有生成、成本结算、错误脱敏和 SSE 测试全部继续通过。
