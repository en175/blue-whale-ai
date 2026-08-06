# ADR-0046：调用错误证据、执行权与 AgentRun 终态分离

- **状态**：Accepted
- **IK3UUX 范围状态**：Superseded — 不迁移错误证据/策略/处置分层；结果无法确认时明确失败并允许
  User 重试，见 [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。
- **日期**：2026-07-25
- **决策者**：KimJohn
- **关联工单**：[确定 Node Agent Worker 的编排与恢复模型](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK3UWA)
- **修订**：[ADR-0043 AgentRun 三种规范化收场](0043-agent-run-terminal-outcomes.md)中由 Worker 错误直接形成 failed commit 的目标架构语义

## 背景

Runtime 同时观察 Provider 调用错误、AgentRun lease/fence 变化和恢复预算耗尽。如果把这些事实统一映射成
`failed`，会产生三类错误推导：

- Provider 调用失败被误认为整个 AgentRun 必须失败；
- Worker 失去执行权后仍提交终态；
- 结果不明被误报为 Provider 已失败，丢失副作用与计费不确定性。

因此必须冻结：

> InvocationAttempt 的结果、Worker 的执行权和 AgentRun 的终态是三种不同事实，不能相互直接推导。

## 决策

### 1. 责任链

```text
RuntimeAdapter
  ↓ InvocationErrorEvidence
Runtime ErrorClassifier + RuntimeErrorPolicy
  ↓ RuntimeErrorDisposition
InvocationCoordinator / Agent Runtime Executor
  ↓ terminal_candidate 才可提交
RunCommit
  ↓ Product API 校验并接纳
AgentRun failed
```

Runtime ErrorClassifier 是职责边界，不预先冻结为独立类或服务。

### 2. Adapter 只报告证据

RuntimeAdapter 可以按版本化 Adapter 契约归一化：

- 调用阶段与 dispatch 确定性；
- 已观察到的 Provider reference；
- 白名单化的 Provider / HTTP 错误类别与代码；
- `Retry-After`；
- partial result 与 usage 是否完整；
- timeout、cancel 或连接中断发生的位置。

Adapter 不返回 `retryable`、`shouldFailRun` 或其他拥有业务处置权的字段。原始 Provider payload、
堆栈、提示词、凭据、Secret 与不受控错误消息不得进入 InvocationErrorEvidence、RunCommit 或公开响应。

### 3. RuntimeErrorPolicy 与分类结果

Product API 在 AgentRun 创建时固定版本化 RuntimeErrorPolicy，并随 RunWork 下发。Runtime 按该版本将
InvocationErrorEvidence 映射为且仅映射为：

| Disposition | 含义 | 约束 |
| --- | --- | --- |
| `retry` | 策略允许或要求一次新的 Provider 执行 | 必须由 Product API 签发新的 AttemptPermit 与 CostReservation |
| `reconcile` | 核对或恢复原 InvocationAttempt | 不创建新 attempt，不复用为新 dispatch 权限 |
| `await_authoritative_state` | 本地证据不足，刷新 Product API / Ledger 权威状态 | 不是 Run 状态；不得 checkpoint 或 RunCommit |
| `stop_fence_lost` | 当前 Worker 已失去 AgentRun 执行权 | 立即停止推进；仅可按精确 attempt 能力回报迟到证据 |
| `terminal_candidate` | 策略判断 Run 已无法安全继续 | 只是 failed RunCommit 候选，不是终态事实 |

`await_authoritative_state` 后，Runtime 只能依据刷新后的权威状态继续当前 advance 或退出，不能凭本地缓存
创造等待状态。`retry` 被 Product API 拒绝后，Runtime 必须依据权威拒绝原因重新分类，不能绕过 Permit。

### 4. Product API 保持最终权威

Product API 在 failed RunCommit 中至少校验：

1. RuntimeErrorPolicy 身份、版本与 AgentRun pin 一致；
2. 引用的 InvocationErrorEvidence / Ledger 事实存在且属于当前 advance；
3. 策略要求的 reconciliation 已耗尽或已有决定性证据；
4. AgentRun fence、版本和 lease 仍授权当前 Worker 提交；
5. 不存在策略仍**强制要求**且预算、deadline 与准入条件均允许的恢复步骤。

仅仅存在一个策略允许但不强制的 retry 或 fallback，不足以拒绝 terminal candidate。Product API 验证通过后，
才通过 RunCommit 原子接纳 AgentRunFailure、RuntimeCheckpoint 与 `failed` 唯一下一状态。

### 5. Invocation 结果不直接决定 Run

| Invocation / Worker 事实 | 允许的处理 | 禁止推导 |
| --- | --- | --- |
| `failed_definitive` | retry、fallback 或 terminal candidate | 直接等同 AgentRun failed |
| rate limit / transient evidence | 按策略申请新 attempt | Adapter 自行重试 |
| `outcome_unknown` | reconciliation；耗尽后可形成准确的 terminal candidate | 宣称 Provider 调用失败 |
| fence 丢失 | `stop_fence_lost`，不提交 outcome | failed RunCommit |
| `succeeded` | 恢复并校验完整结果 | 直接等同 AgentRun completed |

timeout、AbortSignal 和 cancel 只描述本地观察；只要请求可能已经 dispatch，就不能单独证明失败。

### 6. 结果不明耗尽

达到 `reconciliation_deadline` 仍无法取得决定性结果，且策略不存在获准的新 attempt / fallback 路径时，
Runtime 可以提交：

```text
internal_code: INVOCATION_RESULT_UNRECOVERABLE
terminal_reason: execution_cannot_continue_safely
```

它表示 AgentRun 无法安全继续，不表示 Provider 调用已经失败。InvocationLedger 必须永久保留曾进入
`outcome_unknown` 的审计历史；迟到的决定性证据仍可使 Ledger 当前结果收敛，但不得自动重开或改写
已经终态化的 AgentRun。

### 7. AgentRunFailure 载荷

failed RunCommit 只携带受控字段：

```text
internal_code
public_error_code
public_message_key
evidence_ref
runtime_error_policy_version
terminal_reason
```

Product API 根据 `public_message_key` 与受控参数形成用户文案，不接纳 Runtime 提供的自由文本错误消息。
内部证据与公开错误必须分离；公开 Snapshot 和事件只暴露稳定公开错误码与安全文案。

## 验收测试矩阵

后续实现必须覆盖：

1. **Adapter 权限边界**：证据载荷无法表达 retry / fail 决策，原始 Provider payload 与敏感信息被拒绝或清洗。
2. **分类与准入**：retry 必须取得新 AttemptPermit；Permit 拒绝后不得 dispatch，必须按权威原因重新分类。
3. **结果不明**：deadline 前只 reconcile；耗尽后可提交 `INVOCATION_RESULT_UNRECOVERABLE`，Ledger 保留不确定历史。
4. **fence 丢失**：旧 Worker不得创建 attempt、写 chunk 或 RunCommit failed，但精确 attempt 的迟到证据回报仍可幂等接纳。
5. **终态原子性与脱敏**：错误策略、evidence 或 fence 任一不匹配时不产生 failed、checkpoint 或部分事实；公开面不泄露内部诊断。

Wayfinder 阶段只冻结验收要求，不提前修改业务测试制造预期失败。

## 后果

- 正向：Provider、Runtime 与产品状态各自保留准确事实；retry、reconciliation 和终态失败均有单一权威。
- 代价：Product API 需要版本化错误策略、证据引用与 failed commit 校验；Runtime 需要显式分类和重新读取权威状态。
- 兼容：旧 Java/Python 的 `error_code` / `error_message` 原样接纳只作为历史实现保留；Node 目标架构使用
  受控 AgentRunFailure，不兼容自由文本错误提交。
