# ADR-0047：AgentRun 用户取消是独立产品终态

- **状态**：Accepted
- **日期**：2026-07-25
- **决策者**：KimJohn
- **关联工单**：[确定 Node Agent Worker 的编排与恢复模型](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UWA)
- **修订**：[ADR-0043 AgentRun 三种规范化收场](0043-agent-run-terminal-outcomes.md)、[ADR-0045 Provisional Assistant Delivery](0045-provisional-assistant-delivery-runcommit-boundary.md)
- **时间与租约边界**：[ADR-0048 Timeout、Deadline、Lease 与 Cancellation 分属不同事实](0048-time-deadline-and-lease-facts.md)

## 背景

用户主动停止 AgentRun 是产品命令，不是 Runtime 从模型或工具结果推导出的下一状态。若必须等待 Worker
通过 RunCommit 才能取消，失联 Worker、长时间 Provider 请求或等待中的 Run 都无法及时停止；若把取消
等同 Provider 已取消，又会抹掉已经 dispatch 的调用、成本与迟到结果事实。

因此冻结：

> `AgentRun.cancelled` 表示 Product API 已接纳“停止继续推进 AgentRun”的意图，不表示所有外部调用已经取消。

## 决策

### 1. 独立产品命令

```text
用户取消命令
    ↓
Product API 原子接纳
    ↓
AgentRun.cancelled
```

取消不经过 RunCommit，也不新增 `cancelling` AgentRun 状态。Product API 先验证 User、Project 与
AgentRun 归属，再以命令幂等身份接纳；同一 Run 已 `cancelled` 时重复取消返回首次结果，不追加第二条取消事实。

取消记录至少包含：

```text
cancelled_at
cancelled_by
cancellation_source: user_requested
cancellation_reason_code
cancel_command_id
```

状态名称保持通用 `cancelled`，来源与规范化原因码说明本次由用户请求。
系统或管理员需要终止 Run 时也必须提交显式取消产品命令并记录不同 `cancellation_source`；
timeout、deadline 或 lease expiry 不得隐式映射为取消。

### 2. 原子取消事务

Product API 在锁定 AgentRun 聚合的同一事务中：

1. 将 AgentRun 置为 `cancelled`，递增 run version 与 AgentRun fence；
2. 清除执行 lease，关闭当前 `advance_id`；
3. 撤销所有尚未消费的 AttemptPermit，禁止新 InvocationAttempt 与 Provider dispatch；
4. 将当前 AssistantDeliveryAttempt 置为 `interrupted(reason=user_cancelled)`；
5. 阻止后续 RunCommit、action result 推进与最终 AssistantMessage 创建。

已提交的 AssistantMessage、InvocationAttempt、GenerationJob、Asset 和审计事实不回滚。已经 dispatch
的 InvocationAttempt 继续保留精确 attempt 的受限证据回报能力，但该能力不能创建新 attempt 或推进 Run。

### 3. InvocationAttempt 独立收敛

```text
prepared ──证明未 dispatch──→ abandoned_before_dispatch
in_flight ──继续观察──→ succeeded | failed_definitive | outcome_unknown
```

| 取消时事实 | 后续处理 |
| --- | --- |
| `prepared` 且证明从未 dispatch | 撤销 Permit，进入 `abandoned_before_dispatch`，释放 CostReservation |
| `in_flight` | best-effort 请求 Provider 取消；不能据此标记失败或取消成功 |
| `outcome_unknown` | 继续 reconciliation 与成本核对 |
| `succeeded` | 保留完整结果并结算成本；不得生成新的 AssistantMessage |
| `failed_definitive` | 保留真实失败事实 |

`abandoned_before_dispatch` 是 InvocationAttempt 的独立终态，只能由“从未越过 Provider 边界”的持久证据支持，
不能用来包装 timeout、连接中断或未知结果。

### 4. Provisional delivery 与用户体验

用户取消时，当前 DeliveryAttempt 进入 `interrupted(reason=user_cancelled)`。前端从活动生成投影移除 chunk，
展示“已停止”的非消息状态；provisional 文本不进入 Conversation 或永久 Snapshot，但按短期运营保留策略
保存以供审计和诊断，不作物理立即删除。

### 5. GenerationJob 独立收敛

AgentRun 取消事务通过 Outbox 发出关联 Job 取消请求，但不直接改写 GenerationJob 状态：

- 尚未提交 Provider 且有持久证据的 Job 可以确认取消；
- 已提交 Provider 的 Job 只能 best effort 请求取消；
- Job 的成功、失败、结果不明和成本继续由自身状态机收敛；
- 迟到 Asset 继续保留；
- Job 结果不得重开或推进已取消的 AgentRun。

这延续现有“AgentRun 终态不直接停止已提交 GenerationJob”的领域边界。

### 6. 取消与 RunCommit 线性化

取消命令与 RunCommit 必须锁定同一 AgentRun 聚合并以 version / fence 校验：

```text
Cancel 先提交
→ fence 失效
→ 后到 RunCommit 被拒绝

RunCommit 先提交终态
→ 后到 Cancel 返回 AGENT_RUN_ALREADY_TERMINAL
→ 不改写 completed / failed
```

已 `cancelled` 的重复取消幂等返回首次结果；对其他既有终态取消返回
`AGENT_RUN_ALREADY_TERMINAL`，不得谎称取消成功。`superseded` 与 `cancelled` 同样遵守先提交者胜出。

### 7. 成本

取消只禁止新的 Provider attempt，不直接释放全部 CostReservation：

- 证明未 dispatch：释放；
- `succeeded` 且 usage 完整：按实际成本结算并释放差额；
- `in_flight` / `outcome_unknown`：保持占用并继续核对；
- 新 attempt：禁止创建。

## 验收测试矩阵

后续实现必须覆盖：

1. **原子失效**：取消成功后 version/fence 递增、lease/advance 清除、未消费 Permit 撤销，旧 Worker 的 chunk、attempt 与 RunCommit 全部被拒绝。
2. **线性化竞态**：Cancel 先提交则 RunCommit 失败；RunCommit 先完成或失败则 Cancel 返回 `AGENT_RUN_ALREADY_TERMINAL`；重复取消幂等返回首次结果。
3. **调用独立收敛**：只有证明未 dispatch 才进入 `abandoned_before_dispatch` 并释放预留；in-flight / unknown 的迟到证据与费用仍被接纳。
4. **交付 UX**：用户取消使 DeliveryAttempt 进入 `interrupted(user_cancelled)`，活动文本消失并显示停止状态，永久 Snapshot 无半成品消息，短期运营记录仍存在。
5. **Job 独立性**：Outbox 取消请求不直接改写 Job；Job 与 Asset 的迟到成功、失败和成本不改变 cancelled Run。

Wayfinder 阶段只冻结验收要求，不提前修改业务测试制造预期失败。

## 后果

- 正向：用户立即停止产品推进，同时保留 Provider、Job、成本与迟到结果的真实状态。
- 代价：AgentRun 取消、Invocation reconciliation 和 Job 取消将并行收敛，运营界面必须区分 Run 已停止与外部工作仍在核对。
- 兼容：旧 Java/Python 没有独立 AgentRun 用户取消命令；Node 一次性迁移新增该产品终态与命令契约。
