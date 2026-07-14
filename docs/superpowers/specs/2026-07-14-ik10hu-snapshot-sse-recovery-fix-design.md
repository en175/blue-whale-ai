# IK10HU Snapshot 与 SSE 恢复闭环修复设计

## 背景

IK10HU 已在原功能分支完成第一版实现，并通过本地 `master` 的 merge commit `8e9ab13` 集成；后续 IK10CW 又建立在该本地集成结果之上。代码评审确认第一版已经搭出 Snapshot、Project 事件日志、Project 游标、SSE 和 Outbox 表结构，但尚未形成可验收的恢复闭环：首次游标没有持久化、实体与表结构不一致、Snapshot 不是一致性读取、SSE 只依赖单进程内存通知、Outbox 不投递、前端没有 Project 恢复状态机，部分测试也未进入默认测试生命周期。

本修复从当前本地 `master` 新建 `fix/IK10HU-修复快照恢复缺陷`，不改写已经被本地集成及后续任务依赖的原功能分支。

## 目标与成功标准

本修复完成后必须同时满足：

1. 未登录请求被拒绝；Project 不存在和越权访问对外统一为 HTTP `404 RESOURCE_NOT_FOUND`，不泄漏资源是否存在。
2. Snapshot 在同一个数据库一致性快照中读取受支持的 Project、Canvas、GenerationJob、Asset 和 `high_watermark_cursor`。
3. Project 游标从 1 开始严格单调递增；权威状态、产品事件和 Outbox 在同一事务内提交或回滚。
4. SSE 能从任意有效游标之后分批重放到追平，不因单批 500 条上限或服务实例不同而漏事件。
5. Outbox 投递失败后重试同一个 `message_id`，不新增产品事件、游标或聚合版本。
6. 前端先应用 Snapshot，再从高水位之后消费 SSE；刷新、断线、重复投递和 `410 CURSOR_EXPIRED` 均能恢复。
7. 客户端按 `cursor` / `event_id` 去重，并以 `aggregate_version` 拒绝旧状态覆盖新状态。
8. 后端单元/集成测试和前端 Vitest 覆盖工单列出的恢复路径，且集成测试进入 Maven 默认 `verify` 生命周期。

## 非目标

- 不实现 AgentRun 编排、GenerationJob Worker、Asset 转存或供应商 Adapter。
- 不引入 Kafka、RabbitMQ 等消息队列，也不实现完整 Event Sourcing。
- 不承诺跨 Project 全局顺序、多区域复制或完整生产级 Outbox 隔离/告警平台。
- 不重构全仓统一响应模型；只为本票涉及的受保护 Project 资源建立一致的 404 语义。
- 不扩展现有 UI 功能；前端只接入恢复协议并把已支持的 Project/Canvas 状态落回现有 reducer。

## 已考虑方案

### 方案 A：保留进程内 EventBus，只修游标、事务和前端

改动最少，但事件写入实例与 SSE 连接实例不同时无法实时唤醒；心跳仍可能让一个永远不更新的连接看起来健康。不满足“交付不依赖单进程内存缓存”。

### 方案 B：数据库轮询驱动每条 SSE 连接

不需要 Redis，正确性容易建立，但每个长连接都持续查库，连接数与查询量线性增长；仓库已经选定 Redis/Redisson 作为 SSE 多实例通知通道，纯轮询会放弃已有基础设施。

### 方案 C：数据库事件日志 + Outbox + Redis 唤醒信号（采用）

数据库 `project_events` 是唯一重放真相；Outbox 在事务提交后把稳定的 Project/游标信号发布到 Redis Pub/Sub；每个实例收到信号后只唤醒本机订阅者，本机订阅者再按自己的最后游标从数据库追平。Redis 丢失或重复信号不会改变产品事实，重复通知也不会重复应用状态。

该方案同时满足跨实例、至少一次交付和恢复语义，并复用仓库现有 Redisson 选型，不引入新的消息系统。

## 后端设计

### 1. 表结构与实体契约

`ProjectEvent` 和 `OutboxMessage` 继续沿用仓库的 `BaseEntity`，生产与 H2 schema 补齐 MyBatis-Plus 自动填充会写入的 `gmt_modified`、`version`、`is_delete` 字段，避免首次 insert 因列缺失回滚。

Outbox 增加 `project_id` 与 `cursor`。`message_id` 固定等于产品事件的 `event_id`；投递器只发布下列唤醒信号，不复制业务 payload 作为第二份真相：

```json
{
  "message_id": "evt_...",
  "project_id": 123,
  "cursor": 42
}
```

`project_events` 仍保存完整产品事件封套，SSE 发送内容只从该表读取。

### 2. 游标分配

首次创建 `project_event_stream` 行时直接写入 `high_watermark=1` 并返回 1；已经存在时在 `SELECT ... FOR UPDATE` 锁内递增并写回。并发首次创建仍以唯一主键作为最终防线：失败方重新锁定现有行并继续递增。

测试必须证明：

- 连续两次追加得到 1、2，表中高水位为 2；
- 并发初始化不产生重复 `(project_id, cursor)`；
- 调用方事务回滚后状态、事件、Outbox 与高水位全部回滚。

### 3. Snapshot 一致性

`SnapshotService.getSnapshot` 使用只读 `REPEATABLE_READ` 事务。归属校验、Project、Canvas、GenerationJob、Asset 和高水位的所有普通一致读都在同一事务/连接中完成。

因此并发写入只有两种合法结果：

- 写事务先提交：Snapshot 同时看见新状态和对应高水位；
- Snapshot 的一致性视图先建立：Snapshot 看见旧状态和旧高水位，新事件随后以更大游标从 SSE 到达。

不允许出现“旧状态 + 新高水位”，因为这会让客户端跳过唯一能补齐状态的事件。

### 4. 认证与对象级授权

浏览器身份仍由网关验证 Access Token 后覆盖 `X-User-Id`，agent-service 只消费网关注入的主体。Snapshot 和 SSE 都调用同一个 `requireOwned` 边界。

为 Project 资源增加统一的 `RESOURCE_NOT_FOUND` 系统码/异常映射：

- Project 不存在：HTTP 404 + `RESOURCE_NOT_FOUND`；
- Project 存在但不属于当前 User：同样 HTTP 404 + `RESOURCE_NOT_FOUND`；
- 缺少有效身份：维持认证拒绝，不进入对象查询。

响应体继续使用当前仓库的 `Result` 结构，避免在本票中重构全局 API 契约；HTTP 状态和语义码必须由 Controller/Advice 测试同时断言。

### 5. 权威变更的事件覆盖

现有 Project 创建/重命名和 GenerationJob 创建/状态变更保留同事务追加事件，但删除各服务中重复的 `afterCommit -> ProjectEventBus.publish` 代码，实时通知统一经 Outbox。

补齐当前 Snapshot 可见但没有事件的状态转移：

- Canvas 整体保存：`canvas.updated`，payload 包含权威 `viewport` 与 `nodes`；
- Project 逻辑删除：`project.deleted`；
- 既有 Project/GenerationJob 事件继续使用稳定事件名和完整封套。

Project 删除必须改为事务方法，并在逻辑删除前取得聚合版本、写入删除事件与 Outbox；提交后对象查询不可见，但已有连接仍可从持久事件表收到删除事实。

### 6. Outbox 投递与重试

新增小批量 `OutboxPublisher`，复用现有 `@EnableScheduling`：

1. 查询 `status=pending` 且 `next_attempt_at` 到期的记录；
2. 使用同一行的稳定 `message_id/project_id/cursor` 发布 Redis 唤醒信号；
3. 成功后更新为 `published`；
4. 失败时只增加 `attempt_count` 并设置带上限的指数退避 `next_attempt_at`。

发布 Redis 与更新数据库之间无法组成分布式事务，允许“已发布但未标记”导致同一信号重发。该重复是预期的至少一次语义；投递器绝不调用 `appendEvent`，因此重试不会分配新的事件身份、游标或聚合版本。

多实例可能同时看到同一 pending 行并重复发布，仍由相同 `message_id` 和数据库追平逻辑安全吸收。首版不为无业务副作用的唤醒信号增加租约/Inbox。

### 7. 跨实例通知与 SSE 追平

增加窄接口 `ProjectEventNotifier`：生产实现使用 Redisson `RTopic` 发布/订阅，测试使用可控 fake。通知只携带 Project 和游标，不直接把事件对象推给连接。

本机 `ProjectEventBus` 改为保存每个连接的订阅状态：`projectId`、`lastSentCursor`、`SseEmitter` 和串行化 drain 锁。任何 Redis 信号、初始订阅或心跳兜底只调用同一 `drain(subscription)`：

1. 从 `lastSentCursor` 之后按固定批次升序读取数据库；
2. 逐条发送 `id=cursor`、`event=event_type`、`data=完整封套`；
3. 发送成功后才推进该连接的 `lastSentCursor`；
4. 一批满额则继续下一批，直到不足一批或连接断开。

订阅顺序固定为“先注册本机订阅状态，再执行首次 drain”。注册前已经提交的事件由首次 drain 捕获；注册后提交的事件由通知触发 drain；通知与首次 drain 并发时由每连接锁串行化，数据库游标去重。

心跳仍发送注释帧且不占游标，但发送心跳前先做一次 drain，作为 Redis 信号丢失时的低频恢复兜底。正确性始终来自数据库重放，而不是 Redis 或内存队列。

### 8. 游标过期

`after=0` 表示从当前在线保留窗口的起点开始；正游标小于当前最早可用游标时返回 HTTP 410 和 `CURSOR_EXPIRED`。服务不替客户端跳到最新位置。

测试通过移除保留窗口前部事件构造真实过期条件，不能再用一个仍有效的游标假装覆盖该分支。

## 前端设计

### 1. 认证 fetch-SSE

原生 `EventSource` 无法设置 `Authorization`，因此 Project SSE 使用现有 `lib/api-client.ts` 的认证 `apiFetch` 发起 `fetch`，再消费 `Response.body` 的 `ReadableStream`。每次重连都重新经过该入口，401 时沿用现有单例 token refresh。

解析器支持：

- `\n\n` 与 `\r\n\r\n` 帧边界；
- 多行 `data:`；
- `id:`、`event:`；
- 以 `:` 开头的心跳注释；
- 流结束、AbortController 取消和网络错误。

### 2. Project 恢复状态机

新增可独立单测的纯状态机，状态至少包含：

- 当前 Snapshot 数据；
- `lastCursor`；
- 当前会话已见 `eventId` 集合（有界）；
- `(aggregateType, aggregateId) -> latestVersion`；
- 当前恢复世代，用于丢弃旧 Project/旧连接的迟到回调。

应用规则：

1. Snapshot 原子替换当前恢复状态，并把 `lastCursor` 设为 `high_watermark_cursor`；
2. `cursor <= lastCursor` 或已经见过 `event_id` 的事件不重复应用；
3. `aggregate_version` 小于等于已应用版本时不改状态，但该合法重复事件的游标仍可安全前进；
4. 已知事件更新对应 Project/Canvas/GenerationJob/Asset 切片；兼容但未知的事件忽略 payload 并前进游标；
5. 只有成功解析且属于当前 Project 的完整封套才可推进游标。

### 3. 生命周期

`useCanvasProjects` 的在线恢复路径调整为：

1. 列出 Project 并确定 active Project；
2. 为 active Project 获取 Snapshot，原子应用 Project/Canvas，并同步保存基线，避免恢复数据被 debounce 回写；
3. 从 Snapshot 高水位建立 Project SSE；
4. 流断开后从最后已应用游标指数退避重连；
5. 收到 HTTP 410 时清空旧流状态，重新获取 Snapshot，再从新高水位订阅；
6. 切换 Project 或组件卸载时 abort 旧 Snapshot/SSE，旧恢复世代的回调不得写入新 Project。

本票只把当前 UI 已消费的 Project/Canvas 事件映射到现有 reducer；GenerationJob/Asset 数据保留在恢复状态中，供后续切片复用，不新增界面。

## 错误处理

- Snapshot 认证失败：停止恢复并沿用全局认证失效流程，不降级为已认证用户的 mock 数据。
- Snapshot 404：视为当前 Project 已删除或无权访问，从本地项目列表移除/重新拉取列表。
- SSE 410：重新取 Snapshot，不继续使用旧 cursor。
- SSE 网络错误或正常 EOF：从 `lastCursor` 退避重连；退避在收到任何有效帧后重置。
- 单个事件 JSON/封套无效：终止当前连接并从未推进的 `lastCursor` 重连，不能跳过未知损坏事实。
- Redis 发布失败：保留 pending Outbox 并退避；数据库事件仍可通过重连和心跳 drain 恢复。

## 测试策略

### 后端单元测试

- `ProjectEventServiceTest`：首次高水位持久化、递增、稳定 Outbox 身份。
- `ProjectServiceTest` / `CanvasServiceTest` / `GenerationJobServiceTest`：每个权威变更只追加一次产品事件与 Outbox。
- `ProjectSseServiceTest` / `ProjectEventBusTest`：超过 500 条分页追平、重复通知、注册竞态、发送失败不推进游标。
- `OutboxPublisherTest`：首次发布失败、同一消息重试成功、无新增事件/游标/版本。
- Controller/Advice 测试：未认证、越权/不存在统一 404、真实 410。

### 后端集成测试

H2 MySQL 模式覆盖：

- 实际 schema 可插入 `ProjectEvent` 与 `OutboxMessage`；
- 权威状态/事件/Outbox/游标同事务提交和回滚；
- 并发写入时游标唯一且单调；
- Snapshot 与并发提交只产生“旧+旧”或“新+新”组合；
- 断线后从最后游标只重放缺失事件；
- 清理旧事件后返回真实 `CURSOR_EXPIRED`。

Maven 配置 Failsafe 执行 `*IT`，`mvn verify` 必须实际运行这些集成测试，而不是仅编译。

### 前端 Vitest

- Snapshot 初始化并从高水位接续；
- 重复 `cursor` / `event_id` 只应用一次；
- 旧 `aggregate_version` 不覆盖新状态；
- 断线从最后已应用游标重连；
- 410 触发 Snapshot 重取；
- 切换 Project 后旧连接迟到事件失效；
- SSE parser 覆盖拆包、多行 data、CRLF 和心跳。

## 验证命令

实现阶段至少运行：

```bash
cd blue_whale_server
./mvnw -pl blue-whale-agent/blue-whale-agent-service -am test
./mvnw -pl blue-whale-agent/blue-whale-agent-service -am verify

cd blue_whale_web
npm test -- --run
npm run lint
npm run build
```

若本机仍缺少 JDK 17，先安装并固定该任务验证使用的 Java 运行时，再运行后端红/绿测试；不得以“环境缺失”代替通过结论。

## 交付边界

本修复只在本地修复分支提交。未经新的明确授权，不 push、不创建 PR、不合并远端。实现完成后先运行独立代码评审并报告剩余风险，再由用户决定是否进入发布流程。
