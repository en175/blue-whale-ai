# ADR-0053：Conversation 消息排序与 AgentRun 待处理输入队列

- **状态**：Accepted
- **IK3UUX 范围状态**：Limited — 只保留服务端消息顺序、已接纳消息不丢失与重复提交不重复创建；
  PendingConversationInput、Advance 水位和终态转交协议不作为实施前置，见
  [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。
- **日期**：2026-07-26
- **决策者**：KimJohn
- **关联工单**：[确定 Next.js 前端与 Product API 的新内部接口](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK3UWH)
- **替代规则**：[ADR-0043 D3 新消息 supersede 旧 Run](0043-agent-run-terminal-outcomes.md)
- **关联决策**：[ADR-0036 UserInputRequest](0036-generalize-user-input-request-contract.md)、[ADR-0049 AgentRun 终态封口](0049-agent-run-terminal-seal-and-independent-convergence.md)、[ADR-0050 无状态 AgentAdvance](0050-stateless-agent-advance-and-invocation-boundary.md)

## 背景

ADR-0043 D3 规定新用户消息创建新 AgentRun，并在同一事务中把 Conversation 内其他非终态 Run
置为 `superseded`。该规则把普通追发消息解释为取消旧意图：多标签页并发发送时，后到消息会让已接纳
消息失去继续处理的 Run；正在执行的模型输入与用户看到的消息顺序也可能分歧。

新 public-api 已要求命令身份幂等、权威服务端排序、SSE 与响应乱序合并，以及每段 Conversation
只推进一个活动 AgentRun。为使这些规则在消息接纳、AgentAdvance 输入冻结和 Run 终态竞态中保持
一致，需要一个由 Product API 线性化的待处理输入队列。

因此冻结：

> 消息由 Product API 按 Conversation 排序并持久接纳；普通新消息不 supersede 活动 Run；
> AgentAdvance 只消费启动时冻结的输入集合，后到消息进入同一 Run 的有序待处理输入队列。

## 决策

### 1. 废止 ADR-0043 D3 的普通新消息 supersede 规则

ADR-0043 D3 自本 ADR 起不再适用于目标架构。普通用户消息不得把同一 Conversation 的非终态
AgentRun 改为 `superseded`，不得递增旧 Run fencing token，也不得仅因消息到达而撤销正在执行的
AgentAdvance、Provider 调用或已经开始的业务操作。

`superseded` 终态本身继续保留，供其他经过独立定义的显式替代流程使用；本 ADR 只废止“普通新消息
自动触发 superseded”的来源规则。

### 2. 已有 Conversation 使用统一消息接纳接口

已有 Conversation 统一通过：

```text
POST /api/v1/conversations/{conversation_id}/messages
```

请求使用 JSON，并携带稳定命令身份。一次权威事务必须同时完成：

1. 创建不可变 ConversationMessage；
2. 分配 Conversation 内唯一递增的 `sequence_no`；
3. 创建或选择唯一非终态 AgentRun；
4. 登记该用户消息为该 Run 的待处理输入；
5. 写入产品事件和不可变幂等回执。

任一部分失败则全部不生效。事务完成即返回 `201 Created`、Message `Location`、`message_id`、接纳时的
`agent_run_id`、`sequence_no` 与接纳 cursor；Worker 是否已经领取工作不影响接纳，因此不得返回 202。
GenerationInbox 首条消息继续通过专用入口原子创建 GenerationInbox、Conversation、Message 与
AgentRun；取得 Conversation 身份后的消息复用本节规则。

### 3. 命令身份是唯一提交关联与幂等身份

新合同删除 `client_message_id`。Product API 必须先查询命令幂等回执，再校验 Conversation、
UserInputRequest 或 AgentRun 的当前状态：

```text
same command identity + same canonical request digest
→ return original 201 receipt

same command identity + different canonical request digest
→ 409 idempotency conflict
```

因此，原成功命令即使在首次接纳后遇到 Run 封口、UserInputRequest 已回答或其他状态变化，精确重放
仍返回首次 201 结果，不重复创建 Message、待处理输入或事件。响应与对应 SSE 事件都携带命令关联标识，
Web 用它原位替换本地 `submitting` / `confirming` 状态；命令身份不是 Message 产品 ID。

### 4. ConversationMessage 只按服务端序号排序

同一 Conversation 的正式用户消息与正式助手消息共享一个由 Product API 分配的 `sequence_no` 空间。
客户端时间、接收时间、SSE 到达顺序和浏览器生成值不得参与正式排序。AssistantDeliveryAttempt 仍是
临时投影，不取得正式 Message `sequence_no`；只有 RunCommit 接纳的 AssistantMessage 才进入该序列。

不同命令并发到达时，Product API 按权威事务顺序逐一接纳并分配序号。相同命令的重放只返回原序号，
不得占用新序号或重复发事件。

### 5. 每段 Conversation 最多一个非终态 Run

消息接纳事务必须在 Conversation 级权威顺序中创建或选择 Run：

- 不存在非终态 Run 时，创建一个新 AgentRun，并把消息登记到它的待处理输入队列；
- 已存在非终态 Run 时，选择该 Run，不创建并行 Run；
- 同一 AgentRun 最多一个执行中的 AgentAdvance；
- 待处理输入按 Message `sequence_no` 排序，不允许 Worker、Web 或通知系统重排。

响应中的 `agent_run_id` 只表示接纳事务当时为消息选择的 Run。若该 Run 后续以失败类终态封口并把
未消费输入转交后继 Run，Message 身份和序号不变，新的处理归属通过 Snapshot / SSE 收敛。

### 6. AgentAdvance 启动时冻结输入边界

Product API 创建 AgentAdvance 时，从待处理输入队列取得一个有序前缀，并持久化本轮不可变的输入消息
集合及 `input_high_watermark_sequence_no`。选取数量与上下文预算不得超过 AgentRun 固定策略；一旦
Advance 创建，输入集合不可增删或重排。

Advance 启动后到达的新消息只追加到待处理队列：

- 不进入正在执行的模型输入；
- 不改变当前 RuntimeCheckpoint；
- 不撤销当前 AssistantDeliveryAttempt；
- 不自动取消已 dispatch 的 InvocationAttempt、GenerationJob 或其他业务操作。

当前 Advance 接纳 RunCommit 后，Product API 才能按服务端顺序创建消费后续消息的新 Advance。

### 7. `completed` 是需要再次裁决的终态候选

Runtime 提交 `completed` 只表示当前 Advance 对其冻结输入已经完成，不再无条件表示 AgentRun 可封口。
Product API 在线性化接纳 RunCommit 时必须检查是否存在尚未消费的已接纳输入：

- 没有待处理输入：接纳 `completed` 并按 ADR-0049 封口 Run；
- 存在待处理输入：接纳当前 Advance 的合法 Message、checkpoint 与其他附属事实，但只记录
  `completed` 候选，不封口 Run；Run 保持活动，并为队列中的下一有序输入创建新 Advance。

这不是第五种 Runtime outcome，也不允许 Worker 自行选择“继续”。Run 是否封口完全由 Product API
在同一权威事务顺序中裁决。只要有已接纳但未消费的输入，`completed` 就不能丢弃它们。

### 8. 失败类终态必须转交未消费输入

`failed`、`cancelled` 或 `recovery_failed` 仍可按各自规则正常封口，不被普通待处理输入阻止；但
终态事务必须同时检查旧 Run 的未消费输入：

- 有未消费输入时，在同一事务中创建唯一后继 AgentRun；
- 按原 Message `sequence_no` 把全部未消费输入转交后继 Run；
- 写入可重放的归属变化事件；
- 任一转交步骤失败则旧 Run 终态也不生效。

终态先完成时，随后到达的新消息创建新 Run；消息先接纳时，终态事务必须观察并转交它。Message
本身永远不改写，接纳响应也不追溯修改。已被某个 Advance 冻结的输入不属于“未消费输入”，其失败
处置继续由对应终态和恢复策略决定，不得静默重新执行。

### 9. UserInputRequest 回复使用同一消息事务

Run 处于等待 UserInputRequest 状态时，只有携带准确 `reply_to_input_request_id` 的请求可以在同一
事务中创建 Message、回答请求、登记输入并恢复原 Run。缺失、过期、已回答或归属不匹配时返回稳定
409，且不得创建 Message、序号、输入记录或事件。

幂等回执查询仍先于上述状态校验：原成功命令的精确重放返回首次 201，即使请求当前已经回答；同命令
不同内容仍返回 409。

## 验收测试矩阵

后续实现必须覆盖：

1. **原子接纳**：Message、序号、Run 选择、待处理输入、事件与回执任一步失败时全部回滚。
2. **幂等优先**：原成功命令在 Run 或 UserInputRequest 状态变化后仍返回首次 201；摘要冲突返回 409。
3. **统一排序**：并发用户消息与 RunCommit 助手消息只按服务端事务顺序取得唯一 `sequence_no`。
4. **输入冻结**：Advance 创建后的消息不进入当前模型输入、不改变 checkpoint，也不取消在途操作。
5. **completed 竞态**：消息先接纳时 completed 只成为候选并创建下一 Advance；封口先完成时消息创建新 Run。
6. **失败转交**：failed、cancelled、recovery_failed 封口与后继 Run、未消费输入转交原子成功或原子失败。
7. **UserInputRequest**：只有准确请求身份可创建回复 Message 并恢复原 Run；精确幂等重放优先返回原回执。
8. **SSE 先到**：Web 能以命令关联标识结束本地提交状态，后到 201 不重复创建界面事实。

Wayfinder 阶段只冻结验收要求，不提前修改业务测试制造预期失败。

## 后果

- 正向：多标签页消息不会互相取消；每条已接纳消息都有稳定序号与处理归属；模型输入不会被执行中
  到达的消息静默改变；completed 与新消息竞态由 Product API 唯一线性化。
- 代价：Product API 需要持久化待处理输入、Advance 输入水位与终态转交；RunCommit receipt 需要表达
  `completed` 候选被继续推进的接纳结果。
- 兼容：`client_message_id` 从新 public-api 删除；旧实现中“新消息 supersede 旧 Run”的行为不得作为
  兼容目标。精确字段、Schema、Problem code 与事件名称由 public-api v1 合同工单冻结。
