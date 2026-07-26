# ADR-0017：产品状态持久化、幂等与恢复模型

- **状态**：Accepted
- **日期**：2026-07-14

> **IK3UUX 范围状态**：Limited — 只保留短数据库事务、稳定幂等键、持久任务与简单 lease/fence；
> Outbox/Reconciler、精确幂等 scope、长期回执和结果不明收敛不作为实施前置，见
> [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。

## 背景

ADR-0015 已确定 Java Product API 是唯一公开产品控制面，Python Agent Worker 与 Java
Generation Worker 只通过产品中性的窄接口执行工作；ADR-0016 已确定 Project Snapshot 与持久、
可重放的 Project 事件流。当前仍需冻结产品事实如何落盘，以及命令、Worker、供应商回调和对象存储
跨越进程失败时如何保持幂等、可恢复且不重复付费。

首版面向单区域、小规模生产。目标是消除进入实施规划前的持久化语义歧义，而不是提前建设分布式
事务、完整 Event Sourcing 或超大规模调度平台。

## 决策

### 1. 权威状态表与产品事件共同落盘

Project、Conversation、AgentRun、UserInputRequest、GenerationJob、Asset 与 Canvas 引用使用
独立状态表和聚合版本作为当前产品事实；Project 不是覆盖全部对象的单一强一致大聚合。

每次权威状态转移在同一个短数据库事务中更新必要状态，并追加产品事件及待执行命令 Outbox。
Snapshot 读取状态表，SSE 重放产品事件。首版不采用全量 Event Sourcing，也不从事件日志重建全部
写模型。

Python Agent Worker 不直接写产品表。Java 侧通过同一套应用与持久化边界接纳 RunCommit、
GenerationJob 结果、Asset 与产品事件。

### 2. 事务不得跨越外部副作用

首版固定三类核心事务：

1. **命令接纳事务**：写入幂等记录、Conversation 消息或 BottomDock GenerationJob、产品事件
   和 Outbox。
2. **RunCommit 事务**：校验 AgentRun 聚合版本、租约与栅栏后，原子更新 AgentRun、
   RuntimeCheckpoint、UserInputRequest，创建 GenerationJob，并写入产品事件与 Outbox。
3. **生成结果事务**：校验 GenerationJob 聚合版本与执行权后，原子更新输出槽位、Job 状态、
   Asset 元数据及产品事件。

LLM、消息队列、供应商 API、媒体下载与对象存储调用全部发生在数据库事务之外。跨边界一致性由
Outbox、Inbox、稳定身份、幂等接纳和持续对账实现，不引入两阶段提交或其他分布式事务。

### 3. Project 游标与 Snapshot 使用同一一致性边界

每个 Project 维护独立事件流高水位。产生产品事件的事务锁定该 Project 的事件流记录，为本事务
分配连续游标区间，并在同一事务中更新高水位；回滚时游标分配一并回滚。

Snapshot 在一致数据库快照内读取各聚合状态和 `high_watermark_cursor`。之后提交的产品事件必然
获得更大的 Project 游标，因此客户端从该高水位接续 SSE 时不会漏掉并发事件。聚合 `version`
继续负责单个聚合的并发控制，Project 游标只定义跨聚合的客户端观察顺序。

### 4. 幂等身份按业务来源分命名空间

- 公开命令使用 `(project_id, operation, Idempotency-Key)`，并保存规范化请求摘要和首次接纳
  结果。相同键与相同请求返回首次结果；相同键但请求不同返回
  `409 IDEMPOTENCY_KEY_REUSED`。
- RunCommit 使用 `(agent_run_id, commit_id)`，同时校验 `run_version`、租约和栅栏令牌。
- GenerationJob 创建使用稳定的生成动作身份；同一动作只能创建一个原始 Job。显式重试创建新
  attempt，并通过 `retry_of_job_id` 关联原 Job。
- Outbox 消息使用稳定 `message_id`；消费者以 `(consumer, message_id)` 建立 Inbox 去重记录。
- 业务表保留相应唯一约束，作为幂等记录之外的最终并发防线。

### 5. 执行所有权使用租约与单调栅栏

AgentRun 与 GenerationJob 同时只能有一个执行者。Worker 原子认领时写入 `lease_owner`、
`lease_expires_at` 并递增 `fencing_token`；所有提交同时校验聚合版本和栅栏令牌，过期 Worker
不能覆盖接管者的结果。

租约和续租使用数据库时间。AgentRun 进入 `awaiting_user` 或 `awaiting_job` 后释放执行租约；
供应商异步任务处理期间也不长期占有 Worker，轮询、回调处理和结果转存分别短暂认领。租约过期
只表示执行权失效，不直接将 Run 或 Job 判为失败。

### 6. 重试只覆盖结果确定的安全操作

错误归一化为 `transient`、`rate_limited`、`permanent` 与 `ambiguous_outcome`。只有前两类直接
进入自动重试；供应商写请求只有在官方契约提供可靠幂等键或可查询的客户端请求身份时，才允许在
原 Job 内自动重发。

请求超时且无法判断供应商是否受理时，原 Job 保持非终态并进入核对流程。超过核对期限仍无法确定
时，以 `outcome_unknown` 原因失败；再次产生费用必须创建关联的新 Job，并在超过默认成本额度时
重新经过 GenerationAuthorizationGate。Job 失败不自动令 AgentRun 失败。

自动重试由持久化调度驱动。工作记录保存 `attempt_count`、`last_error_class`、`next_attempt_at`、
策略版本和绝对截止时间，使用带随机抖动的指数退避并优先遵守 `Retry-After`。重试同时受最大尝试
次数、执行期限和成本预算约束；供应商正常状态轮询不计为失败重试。达到快速重试上限的 Outbox
或恢复命令进入持久化隔离状态并报警，但在成功或人工处置前不得丢弃。

### 7. 超时按不同语义独立持久化

- `lease_expires_at` 只控制执行权接管。
- `attempt_timeout` 限制一次网络或模型调用，不直接决定业务终态。
- `execution_deadline` 限制 GenerationJob 的整体执行期限。
- `reconciliation_deadline` 限制结果不明时的查询、回调等待和恢复扫描窗口。

所有截止时间在工作创建时按数据库时间写成绝对值，并冻结所采用的策略版本；后续配置变化不追溯
改变已有 Run 或 Job。AgentRun 的 `awaiting_user` 与 `awaiting_job` 等待时间不计入活动执行片段
超时。Job 达到整体期限后先完成最后一次核对和尽力取消，再以 `timed_out` 原因进入 `failed`。

### 8. 取消意图与实际结果分离

GenerationJob 增加 `cancel_requested_at` 与 `cancelled` 终态。尚未提交供应商的 `queued` Job
可以原子取消；已提交 Job 只有在供应商确认取消或产品能证明调用尚未发生时才进入 `cancelled`。

如果取消确认前供应商已经完成，产品记录真实的 `succeeded` 或 `partially_succeeded`，同时保留
取消请求审计。已产生 Asset 永久保留。取消 AgentRun 只向仍可取消的 Job 发起尽力取消，不级联
改写已提交 Job，也不因迟到结果重新打开终态 Run。

Card 状态扩展为 `generating → normal | failed | cancelled`。确认取消后，已有 Asset 的输出槽位
仍为 `normal`，未产生结果的槽位为 `cancelled` 且不创建 NodeItem；取消不伪装成失败。

### 9. 供应商回调先进入 Callback Inbox

回调入口在完成供应商身份校验后，先持久化 Callback Inbox，再返回 `2xx`，不在回调 HTTP 请求内
执行产品状态转换或媒体转存。

供应商提供事件 ID 时，以 `(provider, account, event_id)` 去重；没有事件 ID 时，以
`(provider, provider_task_id, canonical_payload_hash)` 去重。重复回调返回成功，但不重复产生产品
事件、Asset 或状态变更。

供应商支持任务查询时，回调只触发一次权威状态核对；不支持查询时，由 Adapter 规范化回调并通过
GenerationJob 合法状态转换接纳。乱序旧状态只记录审计，终态冲突进入核对流程，不能覆盖既有
终态。每个输出槽位以 `(job_id, slot_index)` 唯一。

### 10. 崩溃恢复由持续对账器驱动

AgentRun、GenerationJob、Outbox 与 Callback Inbox 保存可索引的 `next_action_at` 和恢复原因。
服务启动与常态运行使用同一套 Reconciler，分批认领到期记录；禁止启动时把全部运行中记录重置为
待执行。

AgentRun 租约过期后，只有 RuntimeCheckpoint 的引擎、版本和 schema 均匹配时才恢复；
`awaiting_job` 的 Run 由持久化 Job 事件唤醒，通知丢失时由 Reconciler 根据产品状态补发。
`processing` Job 根据是否已有供应商任务 ID，分别执行查询、结果转存或不确定提交核对。

所有恢复动作仍走正常命令、版本校验、租约和幂等事务，Reconciler 不得直接修订业务终态。

### 11. RuntimeCheckpoint 不可变且禁止自动回退

每次被 Java 接纳的 RunCommit 创建新的不可变 RuntimeCheckpoint，记录 `agent_run_id`、checkpoint
序号、对应 `run_version`、引擎标识、引擎版本、schema 版本、内容摘要和不透明 payload。
AgentRun 在同一事务中更新 `current_checkpoint_id`，只有当前指针可以用于恢复。

旧 checkpoint 只短期用于诊断，不得自动回退执行，因为产品事实可能已经前进。当前 checkpoint
缺失、损坏或不兼容时 fail closed：存在安全恢复路径则进入 `awaiting_user / recovery`，否则 Run
终止为 `failed`。终态 Run 永不再从 checkpoint 恢复。

### 12. Asset 使用对象先落盘、数据库后发布

用户上传和供应商结果先写入 staging 或确定性不可变对象键；媒体字节传输、摘要和类型校验都在
数据库事务外完成。校验通过后，短事务创建 Asset 元数据、绑定 GenerationJob 输出槽位并追加
产品事件。

对象键一旦被 Asset 引用便不可覆盖。相同 `(job_id, slot_index)` 重复接纳相同内容时返回既有
Asset；内容摘要不同则进入冲突核对。数据库事务失败、上传中断或结果转存中断产生的无引用对象
进入孤儿候选，而不是立即删除。

### 13. 产品事实与恢复辅助数据分层保留

- Project、Conversation、消息、AgentRun、UserInputRequest、GenerationJob、Asset 及关系不按
  时间自动删除，保留到未来明确的 Project 删除流程。
- Project 事件提供 30 天在线重放窗口；更早游标返回 `410 CURSOR_EXPIRED`，长期归档由后续审计
  决策确定。
- 公开 API 幂等记录保留 30 天；业务表中的稳定身份和唯一约束随业务记录长期保留。
- 已处理 Outbox、Inbox 与 Callback 的完整 payload 保留 7 天，去重 tombstone 保留 30 天；
  未成功处理或存在终态冲突的记录禁止 GC。
- 非当前 checkpoint 与终态 Run 的 checkpoint 保留 7 天。
- 无 Asset 引用、无活动传输且持续 7 天的对象才允许删除；GC 执行时必须再次核对引用。

Job 失败、取消或重试不能删除已接纳 Asset。产品 Asset 的删除只由未来明确的 Project 或 Asset
删除流程触发。

## Considered Options

- 拒绝全量 Event Sourcing：首版已有清晰状态模型，不值得承担投影、回放迁移和双模型运维成本。
- 拒绝跨 Worker 或供应商的分布式事务：外部系统不受产品数据库控制，Outbox、Inbox 与对账更符合
  实际失败边界。
- 拒绝进程内重试和启动时全量重置：二者在进程崩溃后丢失语义，并可能重复产生付费副作用。
- 拒绝从旧 checkpoint 自动回退：产品状态可能已提交，回退执行会重复创建 Job、Asset 或事件。
- 拒绝把取消、失败和结果不明合并为同一状态：三者的用户含义、费用风险和恢复动作不同。

## Consequences

- 首版需要支持本地事务、聚合版本、Project 游标、Outbox/Inbox、租约栅栏、持久化调度和按到期时间
  扫描的产品数据基础设施。
- Worker 与回调可以至少一次交付，但所有产品写入必须可幂等接纳；终态和 Asset 内容身份保持不可变。
- Snapshot、SSE、Run 恢复、Job 执行与媒体转存共享同一产品事实边界，不依赖 Python checkpoint、
  供应商任务或临时 URL 作为权威。
- 当前 Java `GenerationJob`、前端 `GenerationJobStatus` 与 `CardStatus` 尚未承接
  `partially_succeeded`、`cancelled` 和输出槽位语义，现有 JSON 输出列表、固定 0–100 进度及内存
  状态映射只作为迁移基线；本票不修改实现。
- 具体数据库、队列和对象存储产品尚未选择；本 ADR 冻结它们必须满足的语义能力，选型应作为独立
  Wayfinder 研究票继续推进。

## 不包含

- 数据库、消息队列、对象存储或调度组件的具体产品选型；
- 表结构、索引、迁移脚本或后端实现；
- 密钥管理、内容审核、成本额度、审计字段、指标与 Trace 的完整设计；
- 完整账户、计费中台、多区域复制与跨 Project 全局顺序。
