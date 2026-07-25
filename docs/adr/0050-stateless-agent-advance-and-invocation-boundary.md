# ADR-0050：无状态 AgentAdvance、InvocationLedger 与单提议提交边界

- **状态**：Accepted
- **日期**：2026-07-26
- **决策者**：KimJohn
- **关联工单**：[确定 Node Agent Worker 的编排与恢复模型](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UWA)
- **消息交付**：[ADR-0045 Provisional Assistant Delivery](0045-provisional-assistant-delivery-runcommit-boundary.md)
- **错误与恢复**：[ADR-0046 Runtime 错误边界](0046-runtime-error-evidence-policy-and-terminal-boundary.md)、[ADR-0048 时间与 Lease](0048-time-deadline-and-lease-facts.md)
- **终态封口**：[ADR-0049 AgentRun 终态封口](0049-agent-run-terminal-seal-and-independent-convergence.md)

## 背景

Node Agent Worker 必须在进程崩溃、租约接管、Provider 结果不明和框架替换后恢复，同时不能成为第二个
产品事实写入者。若逐模型 step 保存框架对象，会把恢复协议锁死在 SDK；若完全依靠进程内状态，则重领后
无法识别已经发生的外部调用。若允许一次推进提交多个副作用动作，又会引入部分授权、部分成本预留和
fan-out/fan-in 恢复问题。

因此采用 Blue Whale 自有的无状态单次推进、版本化 checkpoint、独立 InvocationLedger 与
Single Proposal Commit Boundary。

## 决策

### 1. Agent Runtime Executor 每次只推进一个稳定轮次

Product API 在 AgentRun 每次进入可运行轮次时持久化稳定 `advance_id`：

- 首次可运行、用户输入被接纳或动作结果被接纳时创建新 `advance_id`；
- claim 与 lease reclaim 复用当前 `advance_id`；
- RunCommit 接纳后关闭当前 advance；
- Worker 崩溃只重放当前 advance，不创建新的运行事实。

Worker 从最近一次已接纳 RuntimeCheckpoint 恢复，执行一次 AgentAdvance，然后只通过 RunCommit 提交
唯一下一状态。模型调用、只读工具调用和 SDK step 都是该推进的内部实现，不成为 checkpoint 或产品事实。

### 2. RunCommit 是 AgentRun 推进的唯一接纳边界

每次 AgentAdvance 的请求只能携带一个判别式 outcome：

```text
completed
awaiting_input
awaiting_action_result { proposal }
failed
```

这些状态互斥；proposal 不能与 UserInputRequest 或 terminal outcome 并存。RunCommit 可以同时携带：

- 新 RuntimeCheckpoint；
- 可选的单值 Auto CreativeSkillActivation；
- 可选的胜出 AssistantDeliveryAttempt；
- 与 outcome 对应的结构化产品事实。

Product API 以 `advance_id` 和规范化 `request_digest` 线性化接纳。相同身份与摘要返回原
RunCommitReceipt，不增加 version 或重复事件；相同身份、不同摘要 fail closed。

### 3. RuntimeCheckpoint 使用 Blue Whale canonical codec

checkpoint payload 固定为 `agent-runtime-checkpoint/v1`，只包含：

1. Blue Whale 规范化模型消息历史；
2. 已提交 proposal 与待回传工具结果之间的单一 binding；
3. Runtime 粗粒度推进 cursor；
4. checkpoint、消息与 Adapter codec 版本。

明确不包含：

- AgentRun、Bundle、ModelProfile 或其他产品事实与 pin；
- stream、chunk、usage、计费或预算余额；
- Provider 私有对象、SDK step、不可重建 response ID；
- Skill、Bundle、资源正文；
- 凭据或临时 Secret。

Product API 负责归属、原子持久化、版本关联与恢复选择，并将 payload 视为不透明数据；Runtime 负责
Schema 校验、编解码和版本迁移。

### 4. Single Proposal Commit Boundary

一次 AgentAdvance 最多提交一个具有外部副作用的业务原子 AgentActionProposal。业务原子性不等于
单输出：例如 `generate_images(count=4)` 是一个 proposal，由 Product API 创建一个 GenerationJob
与多个输出槽位。

一次推进内部可以执行多个本地或远程只读工具，但它们不得改变业务产品事实或调用具有业务副作用的
Provider 操作。具有 Provider 成本或结果不确定性的远程只读工具仍须进入 InvocationLedger、
AttemptPermit 与 CostReservation 边界。

#### 多副作用 tool call 协议错误

模型同一响应返回两个或更多副作用 tool call 时，Runtime 必须：

1. 将整次响应识别为 `MULTIPLE_SIDE_EFFECT_TOOL_CALLS` 协议错误；
2. 不执行任何一个调用，不选择第一个，不创建 proposal，不保存部分进展；
3. 按 AgentRun 固定的 RuntimeBudgetPolicy 所给 protocol repair 上限发起受限修复；
4. 要求修复响应只选择一个业务原子副作用动作，或选择其他单一合法 outcome；
5. 修复仍返回多个副作用调用且上限耗尽时，形成
   `MODEL_PROTOCOL_REPAIR_EXHAUSTED` terminal candidate，并通过正常 failed RunCommit 接纳。

每次 protocol repair 模型调用使用确定性 CallSlot、新的 InvocationAttempt、AttemptPermit 与
CostReservation。修复不得复用原调用槽位，也不得把原响应中的任一动作带入最终 proposal。

### 5. Creative Skill 激活附着于 commit

`forced_use` Creative Skill 在 AgentRun 创建时固定；`auto` Runtime 只能从 AgentRun 已固定的
AutoCreativeSkillCandidate 中选择零个或一个。自动选择产生的 CreativeSkillActivation 是可审计
RunCommit 附属事实，与 checkpoint 和唯一下一状态原子接纳；Runtime 没有独立 activation 写接口。

候选使用不可变版本与 digest，恢复时不得查询 `latest` 或候选外 Skill。Activation 不是第二个 outcome，
也不是 AgentActionProposal。

### 6. InvocationLedger 与 AgentRun 状态机分离

InvocationLedger 记录外部调用事实，不推进 AgentRun，也不替代 checkpoint、RunCommit 或
GenerationJob。RuntimeInvocation 以 `(advance_id, call_slot)` 唯一定位，`request_digest` 只作重放
一致性校验：

```text
same slot + same digest      → recover original invocation
same slot + different digest → INVOCATION_REPLAY_DIVERGED
```

CallSlot 由 Blue Whale Runtime 按语义位置确定，例如 `creative_skill_selection:0`、`model_turn:0`、
`protocol_repair:0`；不得使用 SDK step ID、Provider response ID 或随机 UUID。

InvocationAttempt 的生命周期为：

```text
prepared → abandoned_before_dispatch
prepared → in_flight → succeeded | failed_definitive | outcome_unknown
```

- `abandoned_before_dispatch` 需要持久证据证明请求从未 dispatch；
- `succeeded` 必须保存完整可恢复结果或持久引用与摘要；
- Provider 明确失败才形成 `failed_definitive`；
- 可能已经 dispatch 但无法确认结果时进入 reconciliation，核对耗尽后为 `outcome_unknown`；
- 状态查询、原结果取回和可靠幂等恢复属于原 attempt；
- 只有可能产生第二次 Provider 执行或计费的 retry 才创建关联新 attempt。

Invocation fence 与 AgentRun fence 分离。旧 Worker 失去 Run lease 后不得创建新 attempt 或 RunCommit，
但可以凭精确 attempt 的受限能力回报迟到结果证据。

### 7. 所有物理 dispatch 经过统一协调边界

InvocationCoordinator 是 Runtime 的职责边界，不预先冻结为独立服务或类。所有主模型、Creative Skill
自动选择、protocol repair 和符合条件的远程只读工具调用，都必须先申请或恢复 Product API 权威
InvocationAttempt，再取得 AttemptPermit，最后才由版本化 RuntimeAdapter 调用 Provider。

RuntimeAdapter 可以完成消息转换、tool-call 解析、结构化输出、流式消费和 usage 解析，但只返回：

- dispatch 确定性与 Provider reference；
- 完整规范化结果和 usage；
- InvocationErrorEvidence；
- Adapter 身份、能力版本与 `Retry-After`。

Adapter 不决定 retry、fallback 或 AgentRun 终态。SDK 隐式自动 retry 必须关闭，或者保证每次物理
dispatch 都重新经过 Coordinator 和 Product API 准入。

### 8. Product API 持久化跨推进预算

Product API 在 AgentRun 上固定版本化 RuntimeBudgetPolicy，并持久化跨 AgentAdvance 的：

- InvocationAttempt 总数；
- 累计成本与 CostReservation；
- AgentRun 活动执行时间；
- reconciliation deadline 与未结算成本占用。

Runtime 负责单请求和单次 AgentAdvance 的 context、token、资源读取、模型轮数及 protocol repair
限制，并只能收紧策略。Worker 重放时，已经形成的模型或远程调用由稳定 CallSlot 和 InvocationLedger
恢复；本地确定性只读步骤可以安全重放，不能产生产品事实变化。

每次可能产生 Provider 执行或计费前，Product API 原子校验 invocation fence、attempt 上限、deadline、
额度和最坏成本，并签发与请求摘要绑定的单次 AttemptPermit 和 CostReservation。Adapter 不得突破
Permit 固定的模型、最大输出、超时与成本上界。

结果不明的原 CostReservation 不能被新 attempt 复用；新 attempt 必须申请独立预留。原结果查询、
Provider 状态核对与可靠幂等恢复不增加 Provider attempt，但可以有独立 reconciliation 查询预算。

## 验收测试矩阵

后续实现必须覆盖：

1. **advance 重领**：lease reclaim 复用 `advance_id`；接纳输入或动作结果才创建新 advance。
2. **checkpoint codec**：只接受 `agent-runtime-checkpoint/v1` canonical payload；所有产品 pin、SDK /
   Provider 对象、stream、usage、资源正文与 Secret 均被拒绝。
3. **RunCommit 幂等**：同 advance / 同摘要返回首次 receipt 且零副作用；同 advance / 不同摘要返回
   稳定 RunCommit 重放分歧错误并 fail closed。
4. **单 proposal 互斥**：proposal、UserInputRequest 与 terminal outcome 任意组合均被拒绝；批量输出仍可
   由一个业务原子 proposal 表达。
5. **多副作用响应**：两个副作用 tool call 时零执行、零 proposal、零部分 checkpoint，并进入
   protocol repair；多个只读 tool call 仍合法。
6. **协议修复成功**：修复响应只返回一个副作用动作时，仅该动作进入唯一 proposal，原响应动作全部丢弃。
7. **协议修复耗尽**：修复持续返回多个副作用调用直到策略上限时，形成
   `MODEL_PROTOCOL_REPAIR_EXHAUSTED` failed RunCommit，且没有任何副作用调用被执行。
8. **Invocation 重放**：同 slot / 同 digest 恢复原调用；同 slot / 不同 digest fail closed；SDK 隐式 retry
   无法绕过 Ledger。
9. **attempt 生命周期**：只有证明未 dispatch 才能 abandoned；成功必须可恢复；timeout 与断连不能把
   可能已 dispatch 的调用伪装成失败。
10. **Permit 与预算**：每次物理 dispatch 都消费独立 Permit；结果不明的新 attempt 使用新预留；
    reconciliation 不增加 Provider attempt。
11. **Creative Skill**：auto 只能选择固定候选 0/1，并与 RunCommit 原子接纳；独立 activation 写入被拒绝。

Wayfinder 阶段只冻结验收要求，不提前修改业务测试制造预期失败。

## 后果

- Product API 继续掌握 AgentRun、调用准入、预算与成本的最终权威，Worker 可以随时被替换或重启。
- crash replay 仍可能重复本地只读步骤；模型与远程调用通过稳定身份和 Ledger 避免不可见重复。
- 维护 canonical message / tool-call codec、InvocationLedger、Permit 与 reconciliation 增加实现成本，
  但避免 checkpoint 被 AI SDK、Provider 或编排框架内部结构锁定。
