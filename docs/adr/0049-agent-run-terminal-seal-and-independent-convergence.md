# ADR-0049：AgentRun 终态封口，关联独立聚合与运营事实继续收敛

- **状态**：Accepted
- **日期**：2026-07-26
- **决策者**：KimJohn
- **关联工单**：[确定 Node Agent Worker 的编排与恢复模型](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UWA)
- **关联决策**：[ADR-0047 AgentRun 用户取消](0047-agent-run-user-cancellation-boundary.md)、[ADR-0048 时间、Deadline 与 Lease](0048-time-deadline-and-lease-facts.md)
- **后续调查**：[确定 ProjectDeletionFence 与异步物理清理模型](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK40DP)

## 背景

AgentRun 是创作推进聚合，不拥有 InvocationLedger、GenerationJob、ContentReview、Asset 或成本记录的完整
生命周期。Run 终态后，Provider 回报、生成结果和成本证据仍可能迟到。若全部拒绝，会丢失真实结果与费用；
若据此重开 Run，又会破坏终态、Conversation 与 checkpoint 的唯一事实边界。

因此冻结：

> AgentRun 终态封口，关联独立聚合与运营事实继续收敛。

## 决策

### 1. 所有 AgentRun 终态不可逆

本规则覆盖 `completed`、`failed`、`cancelled`、`superseded` 与专用 `recovery_failed`。Product API 首次
接纳终态后：

- `terminal_status`、`terminal_reason`、`terminal_version` 不可改写；
- 当前 `advance_id` 永久关闭；
- 不再签发 AttemptPermit；
- 不再创建 RuntimeInvocation 或 InvocationAttempt；
- 不再追加该 Run 派生的 AssistantMessage 或 RuntimeCheckpoint；
- 不允许任何后续事实重新打开 Run。

终态后的 owner-specific reconciliation 不能修改 AgentRun，也不能产生通用 `agent_run.updated` 事件。

### 2. 精确幂等回放不是新 RunCommit

Product API 为已接纳 RunCommit 保存不可变 RunCommitReceipt：

```text
same advance_id
+ same request_digest
→ return original receipt
```

回放不增加 run version，不新建消息或 checkpoint，也不重复产品事件。相同 `advance_id` 携带不同
`request_digest` 继续 fail closed。该规则适用于 Run 后来已进入终态的历史 advance。

### 3. 既有 InvocationAttempt 继续收敛

终态后只允许作用于既有 attempt 的：

- Provider 状态查询；
- 原结果取回；
- 迟到结果、usage 与安全错误证据回报；
- `outcome_unknown` 向决定性结果收敛，同时保留不确定历史；
- CostReservation 结算；
- AuditRecord 与冲突记录。

这些入口使用精确 attempt 的受限能力，不得创建可能产生新 Provider 执行的新 attempt。模型完整结果即使
迟到，也只能更新 InvocationLedger 与成本，不创建 AssistantMessage、checkpoint 或 Run outcome。

### 4. GenerationJob、ContentReview 与 Asset 独立收敛

AgentRun 终态不改写其他 owner 的聚合。关联 GenerationJob 的迟到结果继续：

- 经过 ContentReview 与结果接纳门；
- 更新 Job 与输出槽位；
- 创建或保留 Asset；
- 完成对象存储转存与成本结算；
- 产生 GenerationJob、ContentReview、Asset 与 Cost 自身的产品事件。

真实生成结果不得仅因 AgentRun 已失败或取消而丢弃；Job 成功也不得反向把 Run 改成 `completed`。
既有 Card / NodeItem 可以继续投影 Job / Asset 状态，这不是追加 Conversation 消息，也不得产生
AssistantMessage 或 AgentRun 推进事件。

### 5. Conversation 边界

禁止的是迟到事实追加或改写原 AgentRun 派生的 AssistantMessage、UserInputRequest 与正式消息历史。
User 仍可在同一 Conversation 发送新消息并创建新的 AgentRun；未来若要利用迟到 Asset 继续创作，
也必须显式创建新 Run，而不是恢复旧终态 Run。

### 6. 终态后事件语义

允许 owner-specific 事件，例如：

```text
invocation.reconciled_after_run_terminal
cost_reservation.settled
generation_job.succeeded
asset.created
```

禁止产生或伪装成：

```text
agent_run.resumed
agent_run.progressed
assistant_message.committed
runtime_checkpoint.advanced
agent_run.updated
```

Project Snapshot 可以因 Job / Asset 独立聚合变化而更新，但 AgentRun 的 terminal seal 与 Conversation
消息历史保持不变。

### 7. SettlementOnlyRunCommit 只适用于非终态 Run

SettlementOnlyRunCommit 仅用于 Run 尚未终态、执行 cutoff 已到且存在 cutoff 前已持久化成功结果的窗口。
一旦任何终态先被接纳，后续结果全部进入 Ledger、Cost、GenerationJob、ContentReview、Asset 或 Audit
各自入口，不再允许 settlement commit。

### 8. 终态与迟到成功线性化

Product API 接纳 terminal RunCommit 前，必须在同一权威事务视图中验证当前 advance 已知的 Ledger：

- 已存在可恢复且 RuntimeErrorPolicy 要求采用的成功结果时，不得接纳
  `INVOCATION_RESULT_UNRECOVERABLE`；
- terminal transaction 先完成、成功证据后到时，只更新 Ledger / Cost；
- 成功证据先被接纳且策略要求采用时，terminal candidate 必须重新分类；
- Product API 的事务接纳顺序是唯一线性化顺序。

### 9. 迟到事实矩阵

| 迟到事实 | 可以更新 | 不得更新 |
| --- | --- | --- |
| 模型完整结果 | InvocationLedger、CostReservation、AuditRecord | AssistantMessage、AgentRun |
| Provider usage | CostReservation、AuditRecord | Run outcome |
| GenerationJob 成功 | Job、输出槽位、ContentReview、Asset、既有结果视图 | AgentRun、RuntimeCheckpoint |
| ContentReview 结果 | Job / Asset 接纳状态 | Conversation 消息历史 |
| 旧 Worker RunCommit | 精确 RunCommitReceipt 回放 | 新版本、新终态或新事件 |

### 10. Project ownership fence 是外部写入资格，不是 Run 终态

Agent Runtime 的 claim、AttemptPermit、AssistantDeliveryAttempt 与 RunCommit 都必须通过 Product API
权威 Project ownership fence 校验。Project 已进入删除围栏时：

- Runtime 必须停止推进；
- 不得创建新 InvocationAttempt、AssistantMessage、RuntimeCheckpoint、AgentActionProposal 或其他
  Project 产品投影；
- 既有已 dispatch 调用的精确迟到证据仍可进入 InvocationLedger 与成本核对；
- 迟到证据不得恢复、重开或改写 AgentRun。

Project 删除围栏不把 `completed` 改成 `cancelled`，不把 `failed` 改成其他状态，也不重写 Run 历史。
它只是更高层的写入资格约束。Project 删除的用户可见语义、owner/tombstone、数据保留期限、
GenerationJob / Asset / 对象存储清理、Go 计费记录与物理删除后回调处理不在本 ADR 冻结，统一由
[确定 ProjectDeletionFence 与异步物理清理模型](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK40DP)
继续调查。当前不存在的 Conversation 独立删除入口也不得从本技术边界推导。

## 验收测试矩阵

后续实现必须覆盖：

1. **终态封口**：所有终态永久关闭 advance，并拒绝新 Permit、Invocation、Delivery、AssistantMessage、checkpoint 与非回放 RunCommit。
2. **幂等回放**：同 advance / 同摘要返回首次 receipt 且零副作用；同 advance / 不同摘要 fail closed。
3. **迟到 Invocation**：既有 attempt 可收敛结果和 usage、结算成本，但不能产生新 attempt、消息或 Run 状态。
4. **独立聚合**：Job / Review / Asset / 存储 / 成本继续接纳迟到结果，既有 Card 投影可更新，Run 与消息历史不变。
5. **终态竞态**：事务先观察到策略要求采用的成功结果时拒绝不可恢复失败；终态先提交时，后到成功只进入 owner-specific 事实。
6. **Project ownership fence**：删除围栏先被接纳后，claim、Permit、Delivery 与 RunCommit 全部拒绝；
   已 dispatch attempt 的精确迟到证据仍可进入 Ledger / Cost，但不能产生任何 Project 产品投影或重开 Run。

Wayfinder 阶段只冻结验收要求，不提前修改业务测试制造预期失败。

## 后果

- 正向：Run 终态不可逆，同时不丢 Provider、Job、Asset 与成本的真实迟到事实。
- 代价：Project Snapshot 与运营事件需要按 owner 区分更新来源，不能依赖通用 AgentRun updated 信号。
- 兼容：当前 GenerationJob 已具备独立于 AgentRun 终态继续执行的基线；Node 目标架构进一步禁止其结果
  反向生成旧 Run 的 AssistantMessage 或 checkpoint。
