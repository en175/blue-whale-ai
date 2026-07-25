# IK3UW2：Node Generation Worker 队列与供应商适配方案评估

- **工单**：[评估 Generation Worker 的 Node.js 队列与供应商适配方案](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UW2)
- **父地图**：[Wayfinder：Node.js/TypeScript 全栈重构决策蓝图](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UUX)
- **类型**：wayfinder-research（AFK）
- **日期**：2026-07-25

## 1. 决策摘要

推荐采用 **Product API 管理的 MySQL 8 持久调度队列 + 纯 TypeScript Generation Worker**：

- `generation_jobs`、输出槽、provider attempt、Callback Inbox、成本预留、内容审核和 Asset
  仍是 MySQL 中的产品事实；
- Product API 是这些产品事实的唯一写入权威；
- Generation Worker 不直写领域表，只调用 Product API 的内部
  `claim / renew-or-prepare / accept / reconcile` 命令；
- Product API 在短事务中使用数据库时间、
  `SELECT ... FOR UPDATE SKIP LOCKED`、单调 fencing token、聚合 version 和 lease 完成领取；
- Worker 用进程内异步循环触发领取；`next_action_at`、绝对 deadline 和 Callback Inbox
  承担持久调度，进程内 timer 不承担恢复事实；
- Redis 只允许承担可丢失的唤醒/通知。BullMQ 不作为默认队列，Temporal 不在本轮引入。

这不是“恰好执行一次”。触发与外部调用按最坏情况视为 at-least-once；
产品状态转换通过稳定 identity、唯一约束、version、lease、fence 和结果接纳实现幂等。

## 2. 必须保持的现有语义

本票不重新发明 GenerationJob。Node 方案必须保持现有基线已经冻结的语义：

| 语义 | Node 方案必须保持的事实 |
|---|---|
| 产品权威 | Product API 是唯一产品事实写入者；Worker、队列和 provider 都不是 Job 终态权威 |
| 领取 | 数据库时间、短 lease、单调 fence、聚合 version、owner 与绝对 deadline |
| 多输出 | `(job_id, slot_index)` 唯一；允许部分成功，只重试缺失或有明确证据的槽 |
| 外部副作用 | 调用前先固化 attempt 与成本许可；不把 provider HTTP 放进数据库事务 |
| 模糊结果 | 已可能发出请求但结果不明时进入 `submission_unknown/outcome_unknown`，禁止盲重投 |
| 结果接纳 | 校验 version、fence、owner、delivery identity、不可变对象 hash 后才创建 Asset |
| Callback | 先验身份与 capability，再以 dedup key 持久化 Inbox；重复回调成功应答但只唤醒一次 |
| 审核 | provider 安全标签只是 evidence；只有产品侧明确 `PASSED` 决策可以发布 Asset |
| 成本 | 可计费调用前按最坏上界预留；成功、明确失败、取消、模糊结果分别结算、释放或待对账 |
| 恢复 | callback、轮询、Worker 重启、lease 过期和持续 Reconciler 汇入同一状态机 |

仓库现状证据：

- 当前领取服务已经使用数据库时间、lease、owner、递增 fence 和聚合 version：
  [GenerationJobClaimService](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/GenerationJobClaimService.java#L33-L75)。
- 当前扫描 SQL 使用 `FOR UPDATE`，但尚未加入 `SKIP LOCKED`：
  [GenerationJobMapper](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/mapper/GenerationJobMapper.java#L17-L37)。
  这是 Node 多 Worker 目标实现需要补齐的明确差距。
- 当前同步图片调用会先登记 provider call evidence、检查成本预留并延长执行 lease；
  已存在 attempt 时不会再次调用，超时后转为结果不明：
  [ImageProviderCallService](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/ImageProviderCallService.java#L29-L98)。
- 当前视频路径已经把 submit、observe、取消、退避、证据对账和 ingest 分成短步骤：
  [SeedanceVideoGenerationProcessor](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/generation/SeedanceVideoGenerationProcessor.java#L25-L188)。
- 当前 Callback Inbox 在事务中验证 task/account/capability、按 payload/event 去重并只唤醒 Job：
  [SeedanceCallbackService](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/SeedanceCallbackService.java#L35-L76)。
- 当前结果接受事务负责 fence、owner、对象引用、Asset、槽位、Job 聚合、成本和 Project Event：
  [GenerationResultAcceptanceService](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/GenerationResultAcceptanceService.java#L48-L203)。
- 当前成本模型明确区分 `ACTIVE / SETTLED / RELEASED / PENDING_RECONCILIATION`：
  [CostReservationService](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/governance/CostReservationService.java#L27-L148)。

完整迁移基线见
[Node 重构现状基线](./IK3UVU-node-rewrite-current-state-baseline.md#6-generation-job-与当前-generation-worker)。

## 3. 候选比较

| 候选 | 优点 | 无法自动解决的问题 | 本轮判断 |
|---|---|---|---|
| Product API 管理的 MySQL 队列 | 与 Job、slot、成本、Inbox 同库；短事务可原子 claim；无第二事实源；复用现有设施 | 需要正确索引、批量领取、空闲退避、Reconciler 和可观测性 | **选定** |
| BullMQ | 复用 Redis；延迟、重试、并发、限流和 Worker 生命周期工具成熟；无需空轮询 Redis | 最坏情况仍会重复处理；Redis lock 不是产品 fence；MySQL 与 Redis 无原子提交；callback、审核、成本和未知结果仍需产品状态机 | **不作默认队列** |
| Temporal | durable Workflow、timer、Signal、Activity retry 和恢复能力强 | 新增 Temporal 服务/Cloud 与事件历史；Workflow 必须确定性；Activity 仍需幂等或禁重试；Product API 权威不变时形成第二耐久控制面 | **本轮不引入** |
| 仅进程内 timer/cron | 实现最小，可作为 claim/reconcile 的触发器 | 进程重启会丢 timer，不能承载 Job、重试或 deadline | **只作触发器** |

### 3.1 为什么选 MySQL 权威队列

MySQL 官方明确说明 `SKIP LOCKED` 会跳过已锁行，并特别指出它适合多个会话访问
queue-like table 的场景。这里返回的是“可领取行的不一致视图”，正符合竞争领取，
但不应把这种读取方式用于普通产品查询。

目标 claim 事务应满足：

1. 以 `(status, next_action_at, id)` 可用索引选到期 Job；
2. 使用 `FOR UPDATE SKIP LOCKED`，多 Product API 副本不等待同一热行；
3. 使用数据库当前时间判断 due、lease expiry 和 deadline；
4. 在同一短事务内递增 fence、写 owner/lease、必要时转 `queued → processing`；
5. 提交后才把 claim payload 返回给 Worker；
6. provider HTTP、对象上传和内容审核均不在该事务内执行。

Worker 只需要一个带 jitter 的异步领取循环。空队列时退避，领取到任务后立即继续；
退避是性能策略，不是持久调度语义。进程退出后，`next_action_at` 和 lease expiry
仍能让其他 Worker 恢复工作。

当前 Java SQL 的 `ORDER BY id LIMIT 1 FOR UPDATE` 在竞争领取时可能让请求等待同一候选行；
Node 目标实现应加入 `SKIP LOCKED`，并把排序收敛为到期时间优先、ID 稳定打破平局。

### 3.2 为什么 BullMQ 不作为默认队列

BullMQ 的官方目标是通常尽量单次交付、最坏情况 at-least-once。
Worker 丢失 Redis lock 时，任务会被标记 stalled 并重新进入 waiting，
因此 processor 可能执行多次。官方也要求 Job processor 自身保持幂等。

这与 Blue Whale 的领域模型不冲突，但 BullMQ 不能替代：

- MySQL 中的 Job version、lease、fence 与 slot 唯一约束；
- provider 调用前的 attempt/成本事实；
- `submission_unknown` 的禁止重投规则；
- Callback Inbox 和持续 Reconciler；
- 内容审核、对象发布与结果接受事务。

若 Product API 先写 MySQL、再写 Redis，会出现 MySQL 已提交而 Redis 未入队的间隙；
若先写 Redis、再写 MySQL，会出现无产品 Job 的孤儿任务。要正确使用 BullMQ，
仍需同事务 Outbox + relay + MySQL Reconciler。此时 Redis 队列只是通知加速层，
并没有减少现有正确性机制，反而增加第二套待观测状态。

BullMQ 的 `jobId` 去重也不能作为产品幂等：

- 去重只在队列作用域内；
- Job 被自动或手动删除后，同一 ID 可以再次入队；
- 它不理解 GenerationJob retry lineage、provider attempt、slot、fence 或内容 hash。

因此本轮不引入 BullMQ。未来若实测证明索引、批量 `SKIP LOCKED` 与退避轮询仍无法满足
已冻结 SLO，可把 BullMQ 作为**非权威唤醒层**重新评估，前提是：

- 只传稳定 `jobId`/wake reason，不复制产品 payload；
- 消息来自 MySQL 同事务 Outbox；
- processor 第一步仍向 Product API claim，旧消息直接幂等结束；
- Redis 数据全部丢失后，MySQL Reconciler 仍能恢复所有到期 Job；
- BullMQ completed/failed 绝不直接等同于产品 Job 终态。

### 3.3 为什么 Temporal 当前不进入

Temporal 通过事件历史重放 Workflow；Workflow 代码必须确定且无普通外部副作用，
外部 I/O 放入 Activity。Temporal 官方架构仍要求 Activity 要么幂等、要么不可重试。
因此它不会消除 provider 模糊提交、成本预留、对象发布、Callback Inbox 或领域 fence。

在本地图的权威边界下，即使采用 Temporal：

- Activity 仍要调用 Product API 的 claim/prepare/accept 命令；
- Product API 仍要保留 GenerationJob、slot、成本、review 和 Asset；
- Temporal history 会成为另一套耐久执行状态；
- 自托管需要 Temporal Cluster 与持久化数据库，使用 Cloud 也会新增外部控制面；
- 长期 Workflow 还需要确定性变更、patch 或 Worker Deployment Versioning 策略。

当前 GenerationJob 已经是一个窄而明确的持久状态机：一次同步图片调用，
或一个异步视频 task 的 submit/observe/ingest。为它引入 Temporal 的收益不足以覆盖
第二控制面和运维成本。

以下需求出现时再单独评估 Temporal：

- 一个 GenerationJob 演变为跨多个服务的长 DAG；
- 需要显式 saga/compensation；
- 大量流程需要长时间人工暂停、Signal 和 child workflow；
- MySQL Job 状态机无法在不失去清晰边界的前提下表达流程。

## 4. 推荐拓扑与权限边界

```text
Product/API Client
        |
        v
Product API  -------------------------> MySQL
  |  create/reserve/claim/accept          |
  |  callback inbox/reconcile             | authoritative facts
  |                                       |
  +---- internal claim/result API <-------+
                    |
                    v
        TypeScript Generation Worker
          |         |            |
          |         |            +------> private object staging
          |         +-------------------> async provider submit/observe
          +-----------------------------> sync provider call

Redis: optional wake signal only; loss is repaired by MySQL scan.
```

Product API 拥有：

- Job、slot、provider attempt、lease/fence/version；
- 成本预留和结算；
- Callback Inbox、安全审计和 Project Event；
- ContentReview 决策；
- Asset 发布和 Job 终态。

Generation Worker 拥有：

- provider SDK/HTTP client 与凭据使用；
- 请求/响应规范化；
- 对象字节下载、校验与私有 staging；
- 对 Product API 内部命令的调用；
- 无产品事实的短暂内存和 telemetry。

Provider Adapter 不得：

- 直接写任何产品领域表；
- 自行把 provider status 当成产品 Job 终态；
- 自行释放或结算成本；
- 跳过 Product API 的 review/accept；
- 把 provider task ID、临时 URL 或原始错误暴露为公开产品契约。

## 5. Provider Adapter 契约

同步图片与异步视频不是同一种 provider job。共同端口必须用判别联合保留差异，
不能给 OpenAI 伪造 retrieve/cancel，也不能把 Seedance 长任务阻塞成一次同步调用。

建议产品中性端口：

```text
submit(spec, attempt_context) -> SubmissionOutcome
observe(provider_ref, attempt_context) -> ProviderObservation
request_cancel(provider_ref, attempt_context) -> CancelObservation
fetch_result(result_handle, attempt_context) -> BinaryStream
normalize_error(provider_error) -> NormalizedProviderError
```

`SubmissionOutcome` 至少包含：

```text
immediate_result  最终结果已随本次响应返回
accepted_task     provider 已返回可持久查询的 task reference
rejected          有证据确认 provider 没有接受任务
outcome_unknown   请求可能已被接受，但当前没有可靠结果
```

每次外部调用 evidence 至少固化：

- `job_id / slot_index / attempt_id`；
- `provider / account / model`；
- 产品 idempotency context；
- provider request ID、task ID（若有）；
- submission state、规范化 status、原始 code 的安全副本；
- submit/observe 时间、绝对 deadline；
- callback capability digest；
- 当前 job version、fence 和 owner；
- 能用于成本对账的 usage/计费 evidence。

Adapter 只能返回 evidence 和规范化观察；Product API 决定产品状态转换。

现有供应商差异与字段核验见
[图片与视频供应商真实 API 契约](./image-video-provider-api-contracts.md)。

## 6. 分阶段恢复规则

### 6.1 同步图片

1. Worker claim Job/slot；
2. Product API 验证有效成本预留，写入 `SUBMITTING` attempt，并把 lease 延长到绝对 call deadline；
3. Worker 只调用 provider 一次；
4. 明确成功：解码结果，写私有 staging，提交 manifest；
5. Product API 完成 review、对象保护、Asset/slot/Job 接纳和成本结算；
6. 明确未提交的失败：按错误分类决定持久退避或终止；
7. 请求可能已发出但响应丢失：进入 `outcome_unknown`，不得自动重新生成。

对没有 retrieve API 的同步 provider，`outcome_unknown` 不能被队列 retry 偷换为重调。
它应保留成本预留并进入截止后对账/人工证据路径。用户发起的 retry 是新的
GenerationJob 和新的 attempt lineage，不复用旧调用身份。

### 6.2 异步视频

1. Worker claim 待提交槽；
2. Product API 写入提交意图、成本许可和 callback capability；
3. Adapter submit；
4. 返回 task ref 后，Product API 持久化 provider/account/task，释放执行 lease，
   并设置下一次 `next_action_at`；
5. callback 先写 Inbox 并唤醒；无 callback 时按持久退避继续 observe；
6. callback 与 poll 都进入同一 observe/accept 状态转换；
7. succeeded 结果立即 ingest 到自有私有对象，再做 review 和接纳；
8. 失败、取消或 deadline 到达后仍按 evidence 决定释放、结算或待对账。

视频等待期间不应长期占有 Worker 或 Redis queue lock。每次 submit/observe/ingest
都是可领取的短步骤，等待时间由 `next_action_at` 表达。

### 6.3 自动重试边界

允许自动重试：

- 有证据确认 provider 未接受的容量/网络前置失败；
- 幂等的 observe/status GET；
- 已有成功 task/result handle 后的结果下载与本地 ingest；
- Product API 内部命令的幂等重送。

禁止自动重试：

- 可能已到达 provider 的 submit；
- provider 没有幂等承诺、也没有 retrieve 证据的同步生成；
- moderation/参数类确定性拒绝；
- 旧 fence、旧 version 或已被新 retry lineage 取代的 attempt；
- 已到达产品终态的 Job。

## 7. Callback、审核、对象与成本

### 7.1 Callback Inbox

Callback endpoint 属于 Product API。处理顺序必须是：

1. 限制 body 大小并完成 provider/account/task/capability 校验；
2. 规范化 payload 后计算 hash/dedup key；
3. 在 MySQL 中先持久化 Inbox 或安全审计；
4. 把 `next_action_at` 唤醒到当前数据库时间；
5. 提交事务后返回 2xx。

重复 callback 是成功的重复通知，不重复发布产品事实。callback payload 只作为 evidence；
必要时用服务端凭据 observe 复核，最终仍走普通 result acceptance。

### 7.2 内容审核与对象发布

provider 自带审核不替代 Blue Whale 的产品审核。明确的产品 `PASSED` 决策前：

- 结果对象保持私有、未发布；
- 不创建可见 Asset；
- 未接纳对象可由 transfer/GC 回收。

成功路径保持 object-first/DB-publish：

1. Worker 写不可变私有 staging；
2. Product API 验证 hash、size、mime 和逻辑 identity；
3. 持久化 ContentReview 决策；
4. 在结果接受事务中保护对象引用、创建 Asset、绑定 slot、聚合 Job；
5. 未被接受或发生 fence 冲突的对象进入可回收路径。

### 7.3 成本事实

- 成本预留发生在任何可计费调用前；
- queue attempts 不是 provider billing attempts；
- 每个 provider attempt 必须有稳定 identity 和 append-only audit evidence；
- 成功按可靠实际值或已冻结的最坏上界结算；
- 确认未调用可释放；
- `submission_unknown/outcome_unknown` 必须进入 `PENDING_RECONCILIATION`；
- BullMQ/Temporal 的 retry policy 不得直接驱动成本状态。

## 8. 硬约束与验收标准

后续“确定 Node Generation Worker 的执行与恢复模型”必须把以下项目作为验收门：

1. 两个 Worker 并发 claim 时，使用 `SKIP LOCKED` 各领取不同 Job；旧 lease/fence 的结果被拒绝。
2. Product API 与 Redis 间断开或 Redis 全量清空后，所有到期 Job 仍可由 MySQL 扫描恢复。
3. Worker 在 provider 调用前、调用中、返回后、对象上传后和 acceptance 前崩溃，
   均不会盲重投模糊调用，也不会重复发布 Asset。
4. 同一 callback 重放、callback 与 poll 竞态、晚到 terminal callback 均只产生一次合法状态转换。
5. OpenAI 同步结果和 Seedance 异步 task 通过同一产品 Job/Asset 表面呈现，
   但 adapter 内不伪造不存在的 provider 能力。
6. moderation、429、5xx、网络超时、storage failure、review unavailable、
   cancellation 和 deadline 各有稳定且互不混淆的失败语义。
7. provider 调用前无有效成本预留时 fail closed；模糊结果不释放预算。
8. Worker/Adapter 没有产品领域表写权限；只有 Product API 身份可以执行 acceptance。
9. Job、slot、attempt、provider task、callback、review、cost、Asset 和 Project Event
   可以通过稳定 correlation identity 追踪，但日志不泄露 secret 或临时 URL。

容量预算、轮询间隔和长期扩缩容阈值仍属于地图的 Not yet specified；
本票不凭无生产流量的假设提前冻结数值。

## 9. 升级触发条件

只有出现实测证据时才重新选型：

- **重新评估 BullMQ**：正确索引、批量 `SKIP LOCKED`、jitter/backoff 和水平扩 Worker
  后，领取/调度仍持续突破既定 SLO，或权威库扫描造成不可接受负载。
- **重新评估 Temporal**：GenerationJob 已演变为跨服务长 DAG、saga/compensation
  或大量长期人工暂停，且现有窄状态机无法清晰表达。

重新评估不等于迁移产品权威。任何新底座仍必须说明 MySQL 产品事实、幂等接纳、
Callback Inbox、review、cost 和 Asset 的所有权如何保持。

## 10. 地图影响

本研究不新增票据，也不毕业当前 fog。

结论由既有下游票据
[确定 Node Generation Worker 的执行与恢复模型](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UWE)
吸收；该票据负责把这里的推荐拓扑、Adapter 判别状态、失败分类和验收门冻结为最终目标设计。

## 11. 一手资料

### 调度与队列

- [MySQL 8.4 Reference Manual：InnoDB Locking Reads / `SKIP LOCKED`](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
- [BullMQ：What is BullMQ](https://docs.bullmq.io/)
- [BullMQ：Stalled Jobs](https://docs.bullmq.io/guide/jobs/stalled)
- [BullMQ：Idempotent Jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [BullMQ：Job IDs](https://docs.bullmq.io/guide/jobs/job-ids)
- [BullMQ：Retrying Failing Jobs](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [BullMQ：Going to Production](https://docs.bullmq.io/guide/going-to-production)
- [Redis：Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis：Replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)

### Temporal

- [Temporal：Workflow Execution](https://docs.temporal.io/workflow-execution)
- [Temporal：Activity Execution](https://docs.temporal.io/activity-execution)
- [Temporal：Retry Policies](https://docs.temporal.io/encyclopedia/retry-policies)
- [Temporal：Self-hosted Deployment](https://docs.temporal.io/self-hosted-guide/deployment)
- [Temporal Server Architecture](https://github.com/temporalio/temporal/blob/main/docs/architecture/README.md)
- [Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript)
- [Temporal TypeScript Activity cancellation semantics](https://github.com/temporalio/sdk-typescript/blob/main/packages/common/src/activity-options.ts)
- [Temporal TypeScript Worker deployment options](https://github.com/temporalio/sdk-typescript/blob/main/packages/worker/src/worker-options.ts)

### Provider

- [OpenAI：Image Generation](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI：Images API Reference](https://developers.openai.com/api/reference/resources/images)
- [火山方舟：创建视频生成任务](https://api.volcengine.com/api-docs/view?action=CreateContentsGenerationsTasks&serviceCode=ark&version=2024-01-01)
- [火山方舟：查询视频生成任务](https://api.volcengine.com/api-docs/view?action=GetContentsGenerationsTask&serviceCode=ark&version=2024-01-01)
- [火山方舟：删除视频生成任务](https://api.volcengine.com/api-docs/view?action=DeleteContentsGenerationsTasks&serviceCode=ark&version=2024-01-01)

