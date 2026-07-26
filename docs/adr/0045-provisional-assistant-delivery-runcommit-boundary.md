# ADR-0045：Provisional Assistant Delivery 只经 RunCommit 提升为正式消息

- **状态**：Accepted
- **IK3UUX 范围状态**：Limited — 只保留“临时流式片段不是正式消息”；不要求 DeliveryAttempt、
  RunCommit 或迟到交付收敛机制，见 [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。
- **日期**：2026-07-25
- **决策者**：KimJohn
- **关联工单**：[确定 Node Agent Worker 的编排与恢复模型](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UWA)
- **修订**：[Assistant 回复流尝试 abort 与重跑契约](../specs/2026-07-23-assistant-message-stream-attempt-contract.md)的目标架构语义

## 背景

旧 Java/Python 实现会在 abort 后保留 OutputReleaseGate 已放行的文本前缀，把它写成
`aborted` ConversationMessage，并在永久 Snapshot 中继续展示。该行为使“用户看见过的流式文本”
同时承担临时交付与永久会话事实，和无状态单次推进、InvocationLedger 以及唯一 RunCommit 接纳边界冲突。

Node 目标架构需要区分 Provider 调用、临时交付和正式会话消息。用户已明确接受新的产品语义：
Worker crash、retry 或 attempt 切换时，已经展示的 provisional 文本可以被替换或丢弃，不进入永久会话。

## 决策

### 1. 三层身份

```text
Provider stream
    ↓
InvocationAttempt
    ↓
AssistantDeliveryAttempt
    ↓ RunCommit
AssistantMessage
```

- `InvocationAttempt` 记录实际 Provider 调用及完整可恢复结果，继续采用
  [ADR-0050 §6](0050-stateless-agent-advance-and-invocation-boundary.md) 已冻结的
  `prepared → abandoned_before_dispatch`，或 `prepared → in_flight → succeeded | failed_definitive | outcome_unknown`；
  `abandoned_before_dispatch` 只适用于可证明从未 dispatch 的尝试，不简化或掩盖结果不明。
- `AssistantDeliveryAttempt` 是 Product API 管理的短期运营投影。其 chunk 可实时展示并支持
  sequence cursor 重连，但不是 RuntimeCheckpoint、Provider 成功证明、Conversation 历史或授权事实。
- `AssistantMessage` 只在 RunCommit 成功时创建，是唯一进入永久会话、Snapshot 和后续模型上下文的 Assistant 消息。

Provider stream、InvocationAttempt、AssistantDeliveryAttempt 与 AssistantMessage 使用独立身份，
不假设严格一对一。完整 Ledger 结果可以被新的 DeliveryAttempt 重放而不产生新 Provider 调用；
protocol repair 可以产生多个 InvocationAttempt，但最终最多接纳一个 AssistantMessage。

### 2. AssistantDeliveryAttempt 状态机

```text
streaming
  ├─ provisional_completed
  │    ├─ committed
  │    ├─ interrupted
  │    └─ discarded
  ├─ interrupted
  └─ discarded
```

- `provisional_completed` 只表示交付内容完整，仍不是 AssistantMessage。
- `committed` 只能由接纳该尝试的 RunCommit 设置，并关联同事务创建的 AssistantMessage。
- `interrupted` 表示 Worker、租约或传输中断；它是该 DeliveryAttempt 的终态，恢复必须创建新尝试。
- `interrupted(reason=user_cancelled)` 表示用户已停止当前 Run；`discarded` 表示协议修复、
  supersede 或校验失败后明确不再具备提升资格。
- `interrupted` / `discarded` 的文本只按短期运营保留策略处理，不进入永久 Snapshot。

### 3. 用户体验投影

流式文本必须显式呈现为 provisional，前端不得让内容无解释地消失：

| 场景 | Product API / Runtime 事实 | 用户界面 |
| --- | --- | --- |
| 用户主动停止 | 当前 DeliveryAttempt 进入 `interrupted(reason=user_cancelled)`；不创建 AssistantMessage | 从活动投影清除半成品，展示“已停止生成”的非消息状态 |
| Worker 异常或 lease takeover | 旧尝试进入 `interrupted`；新 Worker 走 reconciliation 或新尝试 | 展示恢复中；恢复后由新尝试替换旧 provisional 内容 |
| 系统切换 attempt | 旧尝试停止接纳 chunk；新尝试使用独立身份 | 保持 transient 生成状态，不把旧文本落入永久会话 |
| 浏览器 SSE 重连 | 续接 Product API 保存的同一 DeliveryAttempt sequence cursor | 补发临时 chunk，不续接 Provider stream |

这些提示可以来自短期 DeliveryAttempt 投影或 Run 状态，但不得伪装成 AssistantMessage。

### 4. RunCommit 提升规则

存在完整可见模型输出时，RunCommit 选择一个胜出尝试：

```text
delivery_commit:
  delivery_attempt_id
  invocation_attempt_id
  final_sequence_no
  result_digest
  message_digest
```

Product API 必须在同一事务中验证：

1. DeliveryAttempt 与 InvocationAttempt 均属于当前 `advance_id`，且前者为 `provisional_completed`；
2. InvocationAttempt 已是 `succeeded`，完整结果或持久化引用存在，`result_digest` 一致；
3. chunk 序号连续至 `final_sequence_no`，交付内容与 `message_digest` 一致；
4. AssistantMessage 是 Ledger 规范化结果的确定性可见投影，不拼接其他 DeliveryAttempt；
5. 当前 advance 尚未接纳其他 RunCommit。

验证通过后，Product API 原子创建 AssistantMessage、确认 RuntimeCheckpoint、附属产品事实与唯一下一状态，
并返回 Product API 分配的 `assistant_message_id`。任何校验失败均不产生正式消息或部分 commit。

并非每次 RunCommit 都创建 AssistantMessage：`awaiting_action_result` 可以只有 proposal，
`awaiting_input` 可以只有结构化请求，`failed` 可以只有规范化错误。

### 5. Fence 与恢复

- lease takeover 后，旧 Worker 不得继续追加 chunk；Product API 以 Delivery fence 拒绝迟到写入。
- 旧 Worker仍可凭精确 InvocationAttempt 的受限证据能力回报迟到 Provider 结果；结果只进入 Ledger，
  不自动恢复旧 DeliveryAttempt。
- 新 Worker不得继续读取旧 Worker 持有的 Provider stream，也不得根据 partial chunks 推断调用成功。
- Ledger 已保存完整结果时，新 Worker可以创建新的 DeliveryAttempt 重放结果，不消耗新 InvocationAttempt。
- 两个 DeliveryAttempt 的内容永远不得拼接为最终 AssistantMessage。

## 验收测试矩阵

后续实现票据必须替换旧“abort 前缀永久保留”断言，并覆盖：

1. **用户停止**：尝试进入 `interrupted(user_cancelled)`，已展示前缀从活动投影清除，UI 显示停止状态；
   Snapshot、Conversation 历史和模型上下文均无半成品消息，短期运营记录仍保留。
2. **Worker crash / takeover**：旧 fence 追加 chunk 被拒绝，旧尝试为 `interrupted`，前端显示恢复状态；新尝试不继承旧 chunk。
3. **完整结果、commit 前崩溃**：Ledger 保留 `succeeded` 结果，新 Worker不调用 Provider即可重放；最终只创建一个 AssistantMessage。
4. **原子校验失败**：错误 advance、非 `succeeded` invocation、序号缺口或任一摘要不匹配均 fail closed，不创建消息、checkpoint 或下一状态。
5. **无消息 outcome**：纯 AgentActionProposal、结构化 UserInputRequest 与规范化失败均可成功 RunCommit，且不产生空 AssistantMessage。

现有 `AssistantMessageStreamAttemptIT` 中“aborted ConversationMessage 保留前缀并进入 Snapshot”的断言，
以及 Worker 对 `released_sequence_no` 承接永久前缀的测试，属于迁移时必须删除或改写的旧语义。
Wayfinder 阶段只冻结这些验收要求，不提前修改业务测试制造预期失败。

## 后果

- 正向：Conversation 历史、RuntimeCheckpoint、InvocationLedger 与用户可见流不再形成多套事实源；
  crash 后可复用完整 Provider 结果，同时不会把 partial chunks 误判为成功。
- 代价：中断前用户已看到的文字可能被替换或消失；产品必须持续展示停止、恢复或 attempt 切换状态，
  不能让前端自行决定是否永久保留半成品。
- 迁移：旧 Java/Python 的 `AssistantMessageStreamAttempt` 契约仅作为历史实现基线保留；Node 一次性迁移
  不兼容其 aborted ConversationMessage 语义。
