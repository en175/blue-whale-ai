# ADR-0048：Timeout、Deadline、Lease 与 Cancellation 分属不同事实

- **状态**：Accepted
- **日期**：2026-07-26
- **决策者**：KimJohn
- **关联工单**：[确定 Node Agent Worker 的编排与恢复模型](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UWA)
- **关联决策**：[ADR-0046 Runtime 错误与终态边界](0046-runtime-error-evidence-policy-and-terminal-boundary.md)、[ADR-0047 AgentRun 用户取消](0047-agent-run-user-cancellation-boundary.md)
- **终态后收敛**：[ADR-0049 AgentRun 终态封口与独立收敛](0049-agent-run-terminal-seal-and-independent-convergence.md)

## 背景

Runtime 同时受单次调用等待、结果核对、Worker lease、单次 advance deadline、累计活动预算和产品取消命令约束。
这些边界看似都能“停止运行”，但表达的事实不同。合并成 `timed_out` 或 `system_cancelled` 会掩盖 Provider
是否执行、Worker 是否仍有权限以及用户是否真正要求停止。

因此冻结：

> timeout、deadline、lease expiry 和 cancellation 表示不同事实，不共用 `timed_out` 或 `cancelled` 终态。

## 决策

### 1. 权威映射

| 触发条件 | 实际含义 | 权威处理 |
| --- | --- | --- |
| `attempt_timeout` | Runtime 本地等待超过单次调用上限 | 按 dispatch 证据进入 `abandoned_before_dispatch`、`failed_definitive` 或 reconciliation |
| `reconciliation_deadline` | 对原调用的核对窗口耗尽 | InvocationAttempt 进入 `outcome_unknown` |
| lease expiry | 当前 lease 不再有效 | 仅使旧 Worker 无权继续；自然过期本身不写状态 |
| lease takeover | 新 Worker 实际取得同一 advance 的执行权 | 原子递增 fence、中断旧交付并重新调度 |
| `advance_deadline` / 活动执行预算耗尽 | 本轮不允许产生新的外部执行 | 使用既有成功结果仅收敛，或形成 terminal candidate |
| 明确取消命令 | Product API 接纳停止继续推进的产品意图 | AgentRun 进入 `cancelled` |

### 2. Attempt timeout 必须结合 dispatch 证据

```text
能证明从未 dispatch
→ abandoned_before_dispatch
→ RuntimeErrorPolicy 可申请安全的新 attempt

Provider 明确返回失败
→ failed_definitive

可能已经 dispatch
→ reconciliation
```

AbortSignal、HTTP 客户端 timeout、连接中断、缺少 Provider reference 或本地进程退出均不能单独证明
Provider 没有执行。任何安全 retry 仍创建新的 InvocationAttempt，并重新取得 AttemptPermit 与 CostReservation。

### 3. Reconciliation deadline 只决定 InvocationAttempt

核对窗口耗尽使原 attempt 进入 `outcome_unknown`，不直接改变 AgentRun：

- 主模型结果不可替代且无获准新路径：可以形成 `INVOCATION_RESULT_UNRECOVERABLE` terminal candidate；
- 可选远程读取：RuntimeErrorPolicy 可以忽略、fallback 或降级；
- 存在可靠替代路径：Product API 按独立预算、deadline 与 fence 决定是否签发新 AttemptPermit。

`outcome_unknown` 的审计历史与 CostReservation 继续遵循 [ADR-0050 §6 / §8](0050-stateless-agent-advance-and-invocation-boundary.md)。

### 4. Lease expiry 与 takeover 分离

自然 lease expiry 不改变 AgentRun、AssistantDeliveryAttempt、InvocationAttempt 或 `advance_id`。只有新 Worker
执行 claim/takeover 时，Product API 才在同一事务中：

1. 递增 AgentRun fence 并授予新 lease；
2. 拒绝旧 Worker 的 chunk、新 attempt 与 RunCommit；
3. 将旧 AssistantDeliveryAttempt 置为 `interrupted(reason=lease_takeover)`；
4. 撤销未消费 AttemptPermit；只有持久证据证明未 dispatch 的 prepared attempt 才可进入 `abandoned_before_dispatch`；
5. 保留已 dispatch attempt 的精确迟到证据通道，并重新调度同一 `advance_id`。

takeover 不产生 AgentRun failed / cancelled，也不创建新 advance。

### 5. Deadline 后允许仅收敛

`advance_deadline` 或 `run_active_execution_budget` 耗尽后：

- 拒绝新 AttemptPermit、模型调用、Provider dispatch 与 retry；
- 允许有效执行者读取适用 deadline 或预算耗尽 cutoff 前已按 Product API 数据库时间持久化为
  `succeeded` 的 Ledger 结果；
- 允许从该结果创建新的 provisional DeliveryAttempt，确定性形成最终消息并提交 SettlementOnlyRunCommit；
- 禁止接纳会启动 GenerationJob 或其他副作用的新 AgentActionProposal；
- 没有可恢复结果时，RuntimeErrorPolicy 才形成 deadline / budget terminal candidate。

SettlementOnlyRunCommit 仍是当前 `advance_id` 唯一的普通 RunCommit，不新增 outcome、checkpoint 类型或第二次提交。
它只适用于尚未终态的 AgentRun；任何终态一经接纳，后续事实只能进入各 owner 的收敛入口。
若旧 Worker 已因 takeover 失去 fence，其 deadline 后提交仍被拒绝；新执行者从 Ledger 恢复并收敛。

### 6. Product API 数据库时间是唯一权威

Product API 下发绝对 deadline、预算快照与策略版本，并以数据库时间判断：

- AttemptPermit 是否仍可签发；
- InvocationAttempt 的 `succeeded_at` 是否早于适用 deadline / 预算耗尽 cutoff；
- 活动执行预算是否耗尽；
- SettlementOnlyRunCommit 是否符合资格。

Runtime 本地定时器只负责及时停止等待或 dispatch，不得决定 AgentRun 终态。等待 UserInputRequest、
GenerationJob 结果和无 Worker 持有 lease 的空闲时间不计入活动执行预算；reconciliation 使用独立 deadline。

### 7. 失败原因与取消来源

AgentRun 继续使用统一 `failed` 终态，由 AgentRunFailure 区分：

```text
AGENT_ADVANCE_DEADLINE_EXCEEDED
RUN_ACTIVE_EXECUTION_BUDGET_EXHAUSTED
INVOCATION_RESULT_UNRECOVERABLE
RUNTIME_ERROR_POLICY_EXHAUSTED
```

不新增 `AgentRun.timed_out` 或 `AgentRun.system_cancelled`。系统或管理员需要终止 Run 时，必须提交显式
取消产品命令并记录 `cancellation_source`，才能进入 `cancelled`。

## 验收测试矩阵

后续实现必须覆盖：

1. **dispatch 三分法**：证明未 dispatch → `abandoned_before_dispatch`；Provider 明确失败 → `failed_definitive`；可能已 dispatch → reconciliation。
2. **核对耗尽**：只把 attempt 置为 `outcome_unknown`；主模型、可选读取与可靠替代路径按固定策略产生不同处置。
3. **expiry / takeover**：自然 expiry 不写状态；实际 takeover 原子换 fence、中断旧 Delivery、撤销未消费 Permit并复用 `advance_id`。
4. **deadline settlement**：cutoff 前 succeeded、commit 前崩溃时不产生新 Provider 调用即可完成；无结果或包含新副作用 proposal 时形成准确 terminal candidate。
5. **权威时间**：Worker 时钟偏快/偏慢均不能改变终态；Product API 数据库时间、策略版本和聚合锁决定 Permit、settlement 与 failed commit。

Wayfinder 阶段只冻结验收要求，不提前修改业务测试制造预期失败。

## 后果

- 正向：每个停止信号保留准确事实；已成功但未 commit 的 Provider 结果不会因 deadline 被丢弃。
- 代价：Product API 需要按数据库时间维护多种独立 deadline，并支持无新外部调用的收敛恢复。
- 兼容：旧 Java/Python 的 lease takeover 已具备“expiry 本身不 abort、实际 takeover 才中断”的基线；
  Node 目标架构在此基础上增加 Ledger settlement 与多 deadline 权威校验。
