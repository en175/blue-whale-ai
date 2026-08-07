# ADR-0051：Node Generation Worker 的单步执行、供应商尝试与分域恢复边界

- **状态**：Accepted
- **IK3UUX 范围状态**：Limited — 只保留 MySQL 持久任务、短 lease/fence、重复回调去重与 Provider
  适配；WorkItem/Reconciler、多期限、结果不明核对和 24 小时审核恢复不实施，见
  [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。
- **日期**：2026-07-26
- **决策者**：KimJohn
- **关联工单**：[确定 Node Generation Worker 的执行与恢复模型](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK3UWE)
- **技术选型前置**：[评估 Generation Worker 的 Node.js 队列与供应商适配方案](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK3UW2)
- **关联决策**：[ADR-0026 生成媒体审核失败恢复](0026-content-rejected-generation-output-is-failed-slot.md)、[ADR-0029 ContentReview 契约](0029-content-review-separates-decision-from-failure.md)、[ADR-0038 统一生成流水线](0038-generation-toolkit-and-image-direct-retirement.md)、[ADR-0048 时间、Deadline 与 Lease](0048-time-deadline-and-lease-facts.md)
- **历史后续**：ProjectDeletionFence 调查已从 IK3UUX 取消，不再构成前置。

## 背景

Node Generation Worker 必须在页面刷新、进程重启、通知丢失、供应商回调与轮询竞态、审核暂时不可用、
取消和结果不明的情况下继续推进，同时不能重复生成、重复产生不可见的供应商调用，或把未审核结果发布
为用户作品。GenerationJob 是用户看到的生成任务，不等于一次真实供应商调用；作品是否发布也不等于
供应商是否产生成本。

因此采用：

> Product API 管理的 MySQL 权威工作记录、短租约单步骤执行、独立 ProviderGenerationAttempt、
> 私有候选结果、分域 Reconciler，以及作品发布与成本结算的独立收敛。

Generation Worker 是可随时替换和重启的外部副作用执行器，不持有产品数据库凭据，也不成为第二个
GenerationJob、ContentReview、Asset 或 CostControl 事实源。

## 产品行为

1. User 提交生成后，即使刷新页面、切换 Project 或 Worker 重启，任务仍由持久记录继续推进。
2. User 只看到稳定的 `queued`、`processing`、`succeeded`、`partially_succeeded`、`failed`、
   `cancelled`；内部 dispatch、poll、reconcile、transfer 和 review 阶段不对外扩展状态。
3. 不能证明重发安全时，系统只核对原调用，不自动重发；核对期限耗尽后任务失败。
4. 结果在来源验证和 ContentReview 明确通过前保持私有，不属于正式 Asset。
5. 取消只停止未来工作；真实结果和真实供应商成本不能被取消请求抹去。
6. GenerationJob 终态永久封口。迟到信息只用于核对、成本结算和审计，不重开原 Job。

## 决策

### 1. GenerationJob 与物理供应商调用分离

GenerationJob 与创建时固定的 GenerationOutputSlot 表达用户请求及产品状态。每次可能越过供应商边界并
产生执行或计费的物理调用，记录为追加式 ProviderGenerationAttempt：

- 一个 Attempt 可以覆盖一个或多个创建时已固定的输出槽；dispatch 前必须声明精确槽集合；
- 每个 Attempt 使用独立 CostReservation、供应商账号、能力快照、价格策略和交付身份；
- 自动真实重发创建新 Attempt；用户在终态后重试创建关联的新 GenerationJob；
- 对原 task 的查询、回调接纳、结果取回和可靠幂等恢复仍属于原 Attempt；
- `outcome_unknown` 禁止被普通队列 retry 偷换成重新提交。

输出槽不得在运行中增删、重排或覆盖。每个槽独立接纳候选、ContentReview、Asset 或无结果终态；
批量结果无法确定映射时形成 GenerationResultConflict，不猜测顺序或最后写入者。

### 2. Product API 发放短租约单步骤工作

Product API 基于 MySQL 数据库时间和权威事实，原子领取下一项 GenerationWorkItem。WorkItem 固定：

```text
work_item_id
job_id + job_version
attempt_id
covered_slot_ids
action
lease_owner + fencing_token
absolute_deadline
schema_version
project_ownership_fence
```

每次只执行一个明确外部步骤。Worker 完成后立即回报；等待异步回调、下一次 poll、审核退避或核对窗口
期间不持有 lease。自然 lease expiry 只使旧 Worker 失去执行权，不表示 Provider 失败、请求未发出或可以
重试。只有新 claim/takeover 才递增 fence 并重新发放尚未完成步骤。

Worker 收到关闭信号时先停止领取新工作，并在固定宽限期内排空当前短步骤。若进程崩溃或未能回报，
只让 lease 到期，由 Product API 持久记录恢复；不得读取本地任务文件或 checkpoint，也不得因进程退出
修改 Job、ContentReview 或 CostReservation。

### 3. Dispatch permit 与结果不明

每次真实 dispatch 前，Product API 原子创建或恢复 Attempt、建立最坏成本预留并签发一次性 permit。
Worker 在越过网络调用边界前持久回报“可能已 dispatch”。

只有持久证据证明请求从未发出，Attempt 才能进入 `abandoned_before_dispatch` 并释放预留。HTTP timeout、
连接中断、Abort、缺少 task id、Worker OOM 或进程退出均不能单独证明供应商没有执行；这些情况进入
GenerationAttemptReconciliation。

Adapter 能力决定原 Attempt 的安全恢复方式：

- 支持供应商幂等键：使用同一 Attempt 身份和同一幂等键恢复；
- 已取得异步 task id：只查询、取回或请求取消原 task；
- 无幂等键且不可查询的同步调用：禁止自动重发，只接受迟到结果或费用证据；
- 无法确认不会重复生成或重复计费：保持 `outcome_unknown` 并核对到绝对期限。

结果核对期限耗尽后，相关输出槽失败并推动 Job 收口；原 Attempt、成本与审计记录仍可接受受限的迟到
证据，但不得发布原 Job 的新作品。

### 4. GenerationProviderAdapter 只提供能力与证据

每个 GenerationProviderAdapter 显式声明：同步/异步、幂等键、task 查询、取消、回调验签、结果取回、
结果顺序和费用证据能力。不支持的能力必须显式缺失，不得伪造 task、retrieve 或 cancellation。

`submit` 的产品中性结果只表达：

```text
immediate_result
accepted_task
rejected
outcome_unknown
```

Adapter 归一化 ProviderObservation、错误证据和费用证据，并保留 provider、account、task、event 与原始
结果身份；它不决定 Job 状态、retry、ContentReview、Asset 发布或费用结算。Provider SDK 隐式 retry
必须关闭；任何可能产生第二次供应商执行的重发都重新经过 Product API 准入。

### 5. 回调与轮询统一为 ProviderObservation

供应商回调入口只负责验签、防重放、账号与 task 绑定校验，并把最小化原始证据写入专用 Inbox；不得
直接修改 Job、创建 Asset 或结算费用。主动查询产出同一种 ProviderObservation，经同一 Product API
接纳命令进入状态机。

Observation 可以重复、乱序和并发：

- 相同原生事件或内容摘要幂等返回首次接纳结果；
- 进度证据不能覆盖已验证终态；
- 相互矛盾的终态形成 GenerationResultConflict 并进入原 Attempt 核对；
- 未通过 Attempt、Project fence、槽位、来源、交付身份与内容摘要校验的证据不能推进发布或结算。

### 6. 候选结果、审核与作品发布

Generation Worker 先把供应商媒体写入私有隔离区，计算不可变摘要、大小和媒体类型，形成
GenerationResultCandidate。候选只关联 Attempt、输出槽和 GenerationDeliveryIdentity，不是 Asset，
不得签发用户访问 URL、展示或作为后续生成输入。

ContentReview owner 使用独立 ReviewWorkItem 获取外部审核证据。ReviewWorkItem 可以由同一个
Generation Worker 运行服务执行，但必须与 GenerationWorkItem 使用独立处理容量、故障隔离、lease/fence、
Adapter 和重试策略。Worker 只返回 ReviewEvidence；`pass | reject | failed` 仍由 Product API 的
ContentReview owner 决定。

只有来源验证和 `decided + pass` 同时成立，Product API 才执行 AssetPublicationCommit。该短事务原子包含：

- 命令幂等与 Project ownership fence；
- Attempt、WorkItem、job version、槽位、fence、交付身份与对象摘要校验；
- 隔离对象接纳、Asset 创建与槽位绑定；
- Job 聚合状态；
- ProductEvent、Outbox 与强制 AuditRecord。

对象字节已在事务前写入私有存储；数据库提交结果不明时，以相同交付身份和摘要从头重试。相同身份与
相同摘要返回首次 receipt；相同身份但内容、槽位或来源不同必须 fail closed 并记录冲突。

### 7. 审核恢复与 ADR-0026 的窄修订

审核暂时不可用时，原 Job 保持 `processing`，最多 15 分钟只重试同一候选的 ContentReview，不重新调用
生成供应商，也不建立第二次生成成本。恢复耗尽后，原 ContentReview 与 GenerationJob 分别进入不可变
`failed`，候选继续隔离保留 24 小时。

本 ADR 对 ADR-0026 作窄修订：User 在 24 小时内明确重试时，创建关联的新 GenerationJob 与新
ContentReview，复用原候选，只执行审核与 Asset 发布；不创建 ProviderGenerationAttempt，不产生第二次
生成费用，也不重开旧 Job。24 小时到期后删除隔离结果；之后重试必须重新生成并重新确认可能费用。

### 8. 成本独立按 Attempt 收敛

作品是否发布与供应商成本是否发生是两条独立事实链：

- 每个 ProviderGenerationAttempt 独占 CostReservation；无预留不签发 dispatch permit；
- 有证据证明供应商未接纳请求时释放预留；
- 供应商已经执行时，即使结果被审核拒绝或调用后收到取消，也按实际证据结算；
- `outcome_unknown` 进入独立费用核对，Job 失败不自动释放，也不按零成本处理；
- 财务核对期限仍无精确证据时，按冻结价格策略形成有上限 UnresolvedProviderExposure 并释放临时占用；
- 迟到供应商账单只能形成追加调整，不重写历史结算或 GenerationJob。

AssetPublicationCommit 不等待费用结算成功；费用结算失败不得撤回已发布 Asset，作品未发布也不得抹去
真实供应商成本。CostReservation 与 UnresolvedProviderExposure 是运营事实，不直接等同于用户账单。

### 9. 取消、重试与期限

GenerationCancellationIntent 只表达停止未来工作：

- 立即阻止新 Attempt、自动重试和未开始的 dispatch；
- 能证明未 dispatch 的 Attempt 才能 abandoned 并释放预留；
- 可取消异步 task 通过独立 WorkItem 请求取消，不支持或结果不明时继续观察原 Attempt；
- 只有供应商确认取消或平台证明请求从未发出，Job 才进入 `cancelled`；
- 取消确认前已产生的真实结果仍经隔离、审核和发布门，真实成本仍结算；
- 多输出 Job 已成功 Asset 永久保留，其余槽位才标记 `cancelled`。

GenerationRetryPolicy 在 Job 创建时固定，由 Product API 按错误类别、最大次数、退避、绝对期限和预算
决定 `retry | reconcile | fail`。明确未 dispatch、明确未接纳或明确终止且不会再产出结果时，可以在原
Job 内用新 Attempt 自动重试；结果不明、证据冲突、参数非法、内容拒绝和硬额度不足不得自动重发。

Job execution deadline、Attempt reconciliation deadline、15 分钟审核恢复、24 小时候选保留与费用核对
期限是独立绝对时间。lease expiry 和传输 timeout 不属于这些业务终态；所有资格由 Product API 数据库
时间判断。

### 10. 分域 Reconciler 只恢复缺失下一步

Generation Reconciler 只扫描 GenerationJob owner 的到期事实、遗漏 WorkItem、过期 lease 与 deadline，
幂等创建或恢复正常 GenerationWorkItem；不直接调用 Provider、对象存储或审核服务。

ContentReview、Asset 与 CostControl 各自核对自身记录，跨域推进只通过公开 owner 端口和 Outbox。Redis、
回调和进程内通知只是可丢失唤醒；即使通知全部丢失，周期性 MySQL 巡检也必须恢复所有未完成步骤。
禁止建立直接执行外部副作用、跨 owner 改表的万能 Reconciler。

### 11. 回报身份与接纳规则

Product API 为每个 Worker 回报签发 GenerationDeliveryIdentity，绑定 workload identity、Project ownership
fence、job version、WorkItem、Attempt、输出槽、fencing token、Schema version、预期来源与内容摘要。

```text
same identity + same canonical digest
→ return original receipt, zero repeated side effects

same identity + different content / slot / source
→ conflict + audit + fail closed
```

网络异常和数据库提交结果不明时只能使用原命令身份从头重试。旧 lease、旧 fence 或不同摘要不得通过
换 id 绕过校验。唯一约束与命令幂等记录共同守住候选、Asset、事件、审计和费用的单次产品副作用。

## 被否方案

- **认领整个 Job 并持有长 lease**：异步等待、审核退避和进程重启会扩大重复执行窗口。
- **依赖 Redis 队列或内存 timer 恢复**：通知丢失后无法证明完整进度，形成第二事实源。
- **普通队列 retry 处理 outcome_unknown**：可能重复生成并重复计费。
- **回调直接更新 Job 或创建 Asset**：绕过统一验证、ContentReview、fence 和幂等接纳。
- **Worker 决定审核、发布、重试或结算**：让执行器成为第二产品控制面。
- **作品发布与成本结算共用一个成败事务**：会用费用故障撤回作品，或用作品拒绝抹去真实成本。
- **本地 checkpoint 恢复 Generation Worker**：把正确性绑定到特定进程和本地磁盘。
- **万能 Reconciler 直接执行所有领域工作**：破坏 owner 边界并产生不可审计的恢复旁路。

## 验收矩阵

后续实现必须覆盖：

1. **短步骤重领**：等待期间无 lease；自然 expiry 不写业务失败；takeover 后旧 fence 回报被拒绝。
2. **dispatch 三分法**：证明未 dispatch 才 abandoned；明确供应商结果按证据处理；可能已 dispatch 只核对。
3. **Adapter 能力**：同步、异步、幂等、查询、取消和无能力组合均显式；SDK 隐式重试无法绕过 permit。
4. **结果不明**：同步不可查询 Provider 的 timeout 不产生第二 Attempt；核对耗尽后 Job 失败且成本继续核对。
5. **回调/轮询竞态**：重复、乱序、回调先到、轮询先到与矛盾终态均确定性收敛。
6. **固定输出槽**：批量数量不足、额外结果、顺序不明与重复结果不能覆盖成功槽或猜测映射。
7. **候选边界**：未审核候选无用户 URL、Card/NodeItem 或输入资格；来源或摘要不符 fail closed。
8. **审核隔离**：ReviewWorkItem 与 GenerationWorkItem 容量和故障隔离；审核失败不触发重新生成。
9. **审核恢复**：15 分钟内复用候选；耗尽后旧 Job 封口；24 小时内新 Job 仅审核且零新生成费用。
10. **发布幂等**：同交付身份同摘要返回首次 Asset receipt；同身份异摘要/槽位/来源记录冲突。
11. **发布事务**：Asset、槽位、Job、Event、Outbox、Audit 要么同时提交，要么全部不提交。
12. **成本独立**：内容拒绝仍结算真实成本；结算故障不撤回 Asset；结果不明不按零成本释放。
13. **取消竞态**：未 dispatch、取消已确认、Provider 先完成、不支持取消和多输出混合结果均符合产品语义。
14. **重试边界**：自动重发必有新 Attempt 与新预留；结果不明、永久错误和策略耗尽不得自动重发。
15. **期限与时钟**：Worker 时钟偏差不能改变 lease、permit、deadline、终态或费用核对资格。
16. **崩溃与通知丢失**：dispatch 前后崩溃、对象写后数据库提交不明、Redis 清空均从 MySQL 正常恢复。
17. **分域恢复**：Generation、Review、Asset、Cost 各 Reconciler 不跨 owner 改表或直接执行外部副作用。
18. **终态封口**：迟到结果和费用只进入核对、结算与审计，不能重开 Job 或补发原 Job 的用户作品。
19. **Project ownership fence**：删除围栏后拒绝新 WorkItem、Attempt、审核和发布；精确迟到费用证据只进入受限核对。

Wayfinder 阶段只冻结决策与验收要求，不修改业务实现或测试。

## 后果

- Product API 保持 GenerationJob、ContentReview、Asset 和 CostControl 的唯一产品权威；Worker 可以水平扩展、
  独立故障和随时重启。
- 一次外部调用的真实执行、产品作品发布和供应商成本分别有可追溯身份，不因重试、取消或审核结果互相
  覆盖。
- 代价是需要维护 WorkItem、Attempt、Observation、候选、交付 receipt、分域 Reconciler 和多组绝对期限；
  这些复杂度用于消除重复付费副作用与不可恢复的模糊窗口。
- Project 删除围栏、回调墓碑、legal hold、物理清理和删除后迟到结果的最终处置不在本 ADR 冻结，由
  「确定 ProjectDeletionFence 与异步物理清理模型」统一决策。
