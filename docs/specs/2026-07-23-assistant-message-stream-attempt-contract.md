# Assistant 回复流尝试（AssistantMessageStreamAttempt）abort 与重跑契约

- **状态**：Accepted for implementation
- **契约版本**：2
- **修订记录**：版本 2（2026-07-23，IK3BG3 实施定稿）——明确 F1 重试轮的文本承接
  规则：新尝试以新 stream_id 经新尝试审核门确定性重放「未放行尾部」，已放行前缀
  保留在 aborted 消息中不得重复重放；空尾部（全文已放行）时模型可附简短过渡说明
  以满足 commit 可见文本非空约束。
- **关联工单**：[扩展回复流尝试的 abort 与重跑契约](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3GIM)
- **下游消费**：[迁入真流式链路并落地 F1/F3 fail-closed 规则](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3BG3)
- **前置契约**：[Runtime Agent Bundle 领域契约与资源规范](2026-07-20-runtime-agent-bundle-contract.md)、[ADR-0025 证据门控流式输出](../adr/0025-evidence-gated-agent-text-streaming.md)、[ADR-0043 AgentRun 终态](../adr/0043-agent-run-terminal-outcomes.md)

本文冻结 Java Product API 与 Python Agent Worker 之间 Assistant 消息内部协议的
**回复流尝试**语义：一个 `stream_id` 表示一次尝试，尝试可被幂等 abort，abort 后可用新
`stream_id` 重跑。它只定义跨进程交换的字段、状态机与错误分类，不定义编排重试策略
（F1/F3 由 IK3BG3 实现）。

## 1. 术语与身份

1. **AssistantMessageStreamAttempt（回复流尝试）**：`assistant_message_streams` 表的一行。
   一个 `stream_id` 唯一标识一次尝试；尝试从 `start` 建立，以 `completed` / `rejected` /
   `aborted` 之一收口，`review_failed` 是可重试的中间态。
2. `stream_id` 由 Worker 为每次尝试生成，是不透明标识，**不得可从 AgentRun ID 推导**。
   同一尝试的传输重试复用同一 `stream_id`；abort 后的新尝试必须使用新 `stream_id`。
3. 每次尝试在 `start` 时建立自己的 `ConversationMessage`；任何尝试不得续写或复用
   其他尝试（尤其 aborted 尝试）的消息。

## 2. 尝试额度与活动约束

1. 同一 AgentRun 最多 **2** 个顺序尝试，该额度由 F1（混合流规范轮重试）与 F3
   （取消/断连重跑）共用。
2. 任意时刻同一 AgentRun 最多一个活动尝试（`streaming` 或 `review_failed`）。
   存在活动尝试时，新 `stream_id` 的 `start` 返回 `409 AGENT_RUN_CONFLICT`。
3. 第三次 `start`（尝试数 ≥2 且无活动冲突之外的请求）返回稳定错误码
   **`409 ASSISTANT_STREAM_ATTEMPT_EXHAUSTED`（业务码 100305）**。Worker 收到该错误后
   不得再次调用模型，应通过 ADR-0043 的规范化错误 commit 使 AgentRun 进入 `failed`。
4. 仅租约自然过期不改变任何尝试状态。

## 3. abort 操作

### 3.1 端点与载荷

```text
POST /internal/agent-runs/{runId}/assistant-messages/abort
```

请求体（snake_case JSON）：

| 字段 | 约束 | 语义 |
|---|---|---|
| RunBinding 七字段 | 同 start/chunk/complete | `project_id` / `user_id` / `expected_run_version` / `fencing_token` / `engine` / `engine_version` / `adapter_schema_version`，校验语义与现有流操作完全一致 |
| `stream_id` | 必填 | 要 abort 的尝试 |
| `idempotency_key` | 必填，≤64 字符 | abort 操作的幂等键 |
| `reason_code` | 必填，≤64 字符 | 规范化原因码，见 §3.3 |

响应复用 `AssistantMessageStreamResponse`（`stream_id` / `message_id` / `status` /
`last_sequence_no` / `released_sequence_no` / `cursor`），`status` 为 `aborted`。

### 3.2 状态机语义

- 仅 `streaming` / `review_failed` 可 abort；对 `completed` / `rejected` 调用 abort
  返回 `409 AGENT_RUN_CONFLICT`。
- abort 是终态操作，效果在同一事务内完成：
  1. 尝试置 `aborted`，保存 `abort_idempotency_key` 与 `abort_reason_code`；
  2. 已通过 OutputReleaseGate 放行的前缀**保留**在 `ConversationMessage.content`；
  3. 未放行的私有分块内容**擦除**（内容置空串，与 rejected 路径同一语义）；
  4. `ConversationMessage.status` 置 `aborted`，并发出 `conversation.message_completed`
     封口事件（payload `status=aborted`），使在线订阅、断线重放与 Snapshot 观察到相同
     最终状态，无重复、无缺块。
- aborted 尝试不可 append / complete：两者均返回 `409 AGENT_RUN_CONFLICT`
  （已记录的同序 chunk 重放仍按既有幂等规则处理）。

### 3.3 规范化 reason code

| reason_code | 触发方 | 语义 |
|---|---|---|
| `CANCELLED` | Worker | 用户取消，F3 整流 abort |
| `DISCONNECT` | Worker | 传输断连前主动 abort |
| `PROTOCOL_MIXED_STREAM` | Worker | F1 检测到文本与 deferred 动作混流，fail closed；规范轮以新 `stream_id` 确定性重放「未放行尾部」（经新尝试审核门放行），已放行前缀保留在 aborted 消息中不得重复重放；空尾部（全文已放行）时模型可附简短过渡说明以满足 commit 可见文本非空约束 |
| `LEASE_TAKEOVER` | Java | 租约接管时兜底 abort 遗留活动尝试 |
| `SUPERSEDED` | Java | Run 被同会话新目标取代时兜底 abort 遗留活动尝试 |

reason code 是稳定契约值；新增取值必须先修订本文档。

### 3.4 幂等语义

- abort 执行与重放均幂等：已 aborted 的尝试上，`abort_idempotency_key` 与
  `reason_code` 均相同 → 返回首次结果；
- 键不同或 reason 不同 → `409 IDEMPOTENCY_KEY_REUSED`；
- Worker 主动 abort 与 Java 兜底 abort 收敛到同一终态：先到者完成收口，迟到的一方
  收到稳定、可分类的 409（幂等冲突或绑定冲突），不产生二次副作用。

## 4. 租约接管与 supersede 兜底

1. Worker 应在租约有效时主动 abort（F3）。若断连使 abort 未送达，Java 在下一次
   租约接管（claim 命中过期 running run）时，于接管事务内先原子 abort 该 Run 遗留的
   活动尝试（`reason_code=LEASE_TAKEOVER`），再交付新租约。旧 Worker 后续写入继续由
   version / fencing / lease 校验拒绝。
2. Run 被 supersede（ADR-0043）后不会再有接管，supersede 事务内同样原子 abort 遗留
   活动尝试（`reason_code=SUPERSEDED`），避免 Snapshot 与重放留下永远"生成中"的残影。

## 5. Worker 侧契约

1. `RunGateway` 暴露 `abort_assistant_message(run_id, payload)`，与
   start/chunk/complete 同形；HTTP Adapter 使用 §3.1 路径，幂等键 ≤64 字符。
2. 冲突分类保持既有语义：`409 + 业务码 100303` → `AgentRunConflictError`；
   新增 `409 + 业务码 100305` → `StreamAttemptExhaustedError`；其余错误（含
   `409 + 100302` 幂等冲突）维持崩溃重试。
3. F1/F3 的检测、编排与重跑由 IK3BG3 实现；本契约只提供控制面能力。
4. F1 重试轮的文本承接规则（Worker 侧，配合 §3.3）：Worker 按 abort 响应的
   `released_sequence_no` 截取混流轮文本的未放行尾部（流式期间 chunk 均为
   64 字符满窗块，已放行字符数 = `released_sequence_no` × 64），在新尝试中经
   ChunkFormer 确定性重放并通过新尝试的审核门；commit 的 `visible_text` 只须与
   本尝试流内容逐字节相等。空尾部时 Worker 向模型追加过渡说明指令，模型可附
   一句简短过渡说明作为本尝试可见文本；模型仍零可见文本则 fail closed 走
   规范化失败。abort 未送达时不做尾部推算，重试 `start` 因遗留活动尝试冲突
   收敛到既有 409 分类，由 §4 的 LEASE_TAKEOVER 兜底。
