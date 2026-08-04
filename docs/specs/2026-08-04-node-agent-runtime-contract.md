# Node Agent Runtime Contract v1

- **状态**：Accepted
- **关联工单**：IK67GG（T05）、IK67GY（T06，增补 §6–§7）、IK67GZ（T07，增补 §8）
- **消费者**：Next.js Product API、Node Agent Worker、AgentChatPanel

## 1. `AgentRuntimeManifest`

`AgentRuntimeManifest` 随应用制品发布，不提供在线修改接口。字段固定为：

- `schema_version=1`、`manifest_id`、`manifest_version`、`manifest_digest`；
- `resources[]`：`resource_id`、`resource_version`、`kind`（`role | rule | runtime_skill`）、
  `load_mode`（`always_on | on_demand`）、`media_type`、`content`、`content_digest`；
- `role_resource_id`、有序 `rule_resource_ids[]`、有序 `runtime_skill_resource_ids[]`；
- `model_profiles[]`、`selected_model_profile_id`、`runtime_budget_policy`、`tool_grants[]`。

启动时必须校验 Schema、资源与 Manifest 摘要、唯一身份、恰好一个角色、全部引用、模型注册表和工具注册表。
任一失败时 Next.js 与 Agent Worker 都必须在开始监听或领取工作前退出。

## 2. `AgentRunPin`

新建 AgentRun 的同一事务必须复制经过验证的 Manifest，形成 `schema_version=1` 的自包含 RunPin：

- Manifest 身份、版本、摘要、`pin_digest`，以及被引用资源的完整副本；
- 唯一 `role_resource_id`、有序 `rule_resource_ids[]` 与有序 `runtime_skill_resource_ids[]`；
- 选定的完整 ModelProfile、RuntimeBudgetPolicy 和 ToolGrant；
- 始终为数组的 `auto_creative_skill_candidates` 与 `activated_creative_skill_versions`，后者最多一项；
- `creative_skill_resources` 保存本 Run 可使用版本的正文与摘要，但不得进入公开 Snapshot/SSE。

RunPin 创建后不可改写。Worker 在调用模型前校验 `pin_digest`、资源与 Skill 正文摘要、引用完整性、
模型/工具注册和预算，并严格按冻结引用顺序构造指令；恢复只消费 RunPin，不查询最新 Manifest 或 Creative Skill 版本。
旧活动 Run 缺少 RunPin 时形成 `runtime_pin_missing` 失败，不用最新配置补齐。

## 3. Creative Skill

`forced_use` 只允许在消息创建新 Run 时解析，并在同一事务写入 0/1 激活记录；官方 Skill 对全部 User
可用，个人 Skill 只允许所有者。无强制选择时，按 `creative_skill_id` 升序冻结 User 已开启 `auto`
的官方 Skill；个人 Skill 不进入自动候选。

Runtime 只能从冻结候选选择零个或一个。`auto` 理由固定为
`{type:"agent_match",detail:{matched_fields:[...]}}`，`matched_fields` 只允许
`conversation_messages | conversation_summary | canvas_nodes | project_metadata`。自动激活仅作为 RunCommit
附属事实接纳，不提供独立激活写接口。

## 4. AgentWork 与 RunCommit

T05 基线每个 Run 只有一个 `ordinal=1` 的 AgentAdvance；T06 起按 §6 支持同一 Run 内多个
顺序递增的 AgentAdvance。领取工作时冻结 `input_messages[]`、
`input_high_watermark_sequence_no`、RunPin、`fencing_token` 与 `run_version`；租约接管复用相同 Advance。

RunCommit 是 `completed | failed | awaiting_input | cancelled` 判别联合（后两者由 T06 增补，见 §6），
以 `advance_id + request_digest` 线性化。相同摘要回放首次
receipt，不重复消息、激活、事件或版本；不同摘要返回冲突。`completed` 原子写入完整 AssistantMessage、
安全 `reasoning_summary`、可选单值 auto 激活、Run 状态和事件；`failed` 不创建 AssistantMessage。

## 5. 公开投影

Snapshot 与 `agent_run.created` / `agent_run.status_changed` 事件只公开：

- Run 身份、状态、阶段、版本；
- `terminal_reason`（`user_requested | runtime_error | null`）、`failure_code`、`retry_count`（T07 增补，见 §8）；
- `activated_creative_skill_versions` 0/1 数组，其中包含 Skill/版本身份、名称、展示版本、
  `resource_digest`、来源和结构化理由；
- 可空 `reasoning_summary`。

公开投影禁止出现 Manifest 内容、RunPin、Skill 正文、Runtime 资源正文、模型内部思考链或自由文本激活理由。

## 6. 多 AgentAdvance 与 PlanPhase 对齐流程（T06）

同一 AgentRun 可包含多个 AgentAdvance，`(agent_run_id, ordinal)` 唯一，`ordinal` 从 1 严格递增。
claim 时存在 `running` Advance 则复用（租约接管）；否则创建 `ordinal = 已有最大值 + 1` 的新 Advance，
并冻结 `sequence_no > run.input_sequence_no` 的 user 消息为 `input_messages[]` 与输入水位。

AgentWork 增加 `history_messages[]`：当前 Advance 首条输入消息之前的全部正式消息，按 `sequence_no`
升序，元素为 `{ role: "user" | "assistant", content }`。`input_messages[]` 的冻结语义不变；
history 仅供 Runtime 构造模型上下文，不是新的接纳事实。

`UserInputRequest.resumed_agent_run_id` 不施加唯一约束：同一 AgentRun 可随多个 AgentAdvance
顺序创建并回答多个请求（每次仅一个活动请求）。

RunCommit 增加两个 outcome：

- `awaiting_input`：原子接纳正式澄清/确认 AssistantMessage、创建
  `UserInputRequest(request_type=creation_clarification, expires_at=接纳时间+24h)`、
  Run 置 `awaiting_input`、更新 stage、Advance 置 completed、消费输入水位。
  同一 Run 已存在活动请求时拒绝提交。
- `cancelled`：User 自然语言表达"不要创建计划 / 停止"时由 Runtime 提交；
  原子接纳一条取消确认 AssistantMessage，Run 置 `cancelled`，
  `terminal_reason=user_requested`，消费输入水位，不创建 UserInputRequest。

stage 为受控枚举，进入公开投影（Snapshot/SSE）：

```text
understanding | alignment | awaiting_final_confirmation | completed | cancelled
```

- Run 创建时为 `understanding`；claim 不覆写既有语义 stage；
- `awaiting_input` 提交必须携带 stage（`alignment | awaiting_final_confirmation`）；
- `completed` 接纳时服务端置 `completed`；`cancelled` 接纳时置 `cancelled`。

回答恢复：只有携带准确 `reply_to_input_request_id` 的消息可回答活动请求；接纳事务在同一权威顺序中
回答问题、创建 Message、把 Run 从 `awaiting_input` 置回 `queued` 并发布 `agent_run.status_changed`。
下一次 claim 为该 Run 创建新 Advance，继续同一 AgentRun。

PlanPhase 行为（意图判断、一次只问一个最关键问题、"你决定"补默认值、不受支持要求继续澄清、
复述并要求最终同意、"立即出计划"不绕过确认）是 Runtime/模型的职责；Product API 只做结构性强制：
每 Advance 至多一次成功 RunCommit、每 Run 至多一个活动 UserInputRequest、stage 转移合法性、
`awaiting_input` 的 Run 必须经 reply_to 回答。T06 不提交 PlanMessage。

## 7. 验收标记约定（fake 模式）

黑盒验收使用确定性 fake adapter，按以下标记驱动对齐流程；未命中任何创作标记的消息保持
T05 的确定性指纹回显行为：

- 意图：当前输入含 `创作：` 为创作请求；含 `修改：` 为修改请求。仅当历史尾部仍是未回答的
  对齐提问/复述时，才把当前输入视为同一创作目标的续答。已对齐事实只从当前创作目标段
  （最近一条含创作/修改标记的用户消息起）提取，不继承此前已完成或已取消 Run 的取值。
- 创作必需项：`主体：X` 与 `预期：Y`；修改必需项：`目标：X` 与 `变化：Y`。缺失时按列表顺序每轮只问第一个。
- 回答含 `你决定`：该缺失项由系统补默认值（`由系统选择的默认主体` / `由系统选择的默认结果`，
  修改请求为 `由系统选择的默认目标` / `由系统选择的默认变化`）。
- 回答含 `不支持：Z`：`Z` 记为不受支持的明确要求，继续澄清该项，不静默降级；只有 User
  随后用必需项标记重新给出受支持的要求才解除。`你决定` 不得移除不受支持的要求。
- `立即出计划`：可减少可选追问，但必需项缺失仍须询问，且不得绕过最终确认。
- 对齐完成后 Runtime 复述需求并发起最终确认请求；回答含 `同意` 时提交 `completed`。
- 回答含 `继续讨论`：回到 `alignment` 继续澄清；回答含 `不要创建计划` 或 `停止`：提交 `cancelled`。

## 8. 临时交付、用户停止/重试与供应商调用记录（T07）

### 8.1 Provisional Delivery（临时交付）

模型生成中的助手文本是临时交付，使用独立身份与顺序，永远不是 ConversationMessage：

- 持久化表 `agent_provisional_deliveries`（`delivery_id` 独立身份，关联 `agent_run_id` /
  `advance_id` / 创建时的 `fencing_token`）与 `agent_provisional_chunks`
  （`(delivery_id, chunk_index)` 唯一，`chunk_index` 从 0 严格递增，是独立顺序）。
- 状态机：`streaming → completed | interrupted`；`interruption_reason` 取
  `user_cancelled | failed`。`completed` 只能由接纳该交付所属 Advance 的
  `completed` RunCommit 在同事务设置；`interrupted` 由用户停止（`user_cancelled`）
  或 `failed` RunCommit / 运行失败设置。
- 临时交付不进入 Conversation、Snapshot、永久模型上下文；按短期运营事实保留，不物理立即删除。
- Worker 追加 chunk 必须在短事务中校验：Run 仍 `running`、`fencing_token` 与
  `lease_owner` 匹配。租约接管、用户停止或取消后，旧 Worker 的迟到 chunk 一律返回冲突，不落库。
- SSE 新事件（与事实同事务发布，`aggregate_type=agent_run`）：
  `agent_run.provisional_delivery_started`、`agent_run.provisional_chunk_appended`、
  `agent_run.provisional_delivery_completed`、`agent_run.provisional_delivery_interrupted`。
  chunk 事件载荷含 `delivery_id`、`chunk_index`、`content`；两个交付的内容永不拼接。
- 交付时序：确定性 fake 适配器为一次性调用，Worker 在结果产出后、RunCommit 前把
  完整内容切片一次性上报；接入真实流式供应商后按到达顺序上报。临时交付的身份、
  顺序、fence 拒绝、中断与提升边界在两种时序下语义一致。

### 8.2 用户停止（独立产品命令）

`POST /api/projects/{projectId}/conversation/agent-runs/{agentRunId}/stop`，必带
`Idempotency-Key`。停止是产品命令，不经过 RunCommit，不创建任何消息：

1. 命令幂等：同键回放首次回执；同键不同请求摘要返回 `IDEMPOTENCY_KEY_REUSED_CODE`。
2. 归属校验失败返回 `RESOURCE_NOT_FOUND_CODE`（不泄漏存在性）。
3. 单事务原子接纳（仅 `queued | running` 可停止）：
   - Run 置 `cancelled`、`stage=cancelled`、`terminal_reason=user_requested`，
     `version` 与 `fencing_token` 各递增 1，清除 lease，清 `active_guard`；
   - 关闭当前 `running` Advance（置 `interrupted`）；
   - 当前 `streaming` 交付置 `interrupted(user_cancelled)` 并发布中断事件；
   - 当前 Advance 的 `in_flight` 供应商调用置 `outcome_unknown`；
   - 发布 `agent_run.status_changed`（载荷含 `terminal_reason`）。
4. Run 已处于其他终态（completed/failed/cancelled/recovery_failed）返回
   `AGENT_RUN_ALREADY_TERMINAL_CODE`（100307），不改写既有终态。
5. 线性化：停止先提交 → fence 失效，旧 Worker 的迟到 chunk、续约与 RunCommit 全部被拒；
   RunCommit 先提交终态 → 停止返回 `AGENT_RUN_ALREADY_TERMINAL_CODE`。
6. 前端从活动投影清除半成品 chunk，展示非消息的「已停止生成」状态。

### 8.3 手动重试（同一 AgentRun）

`POST /api/projects/{projectId}/conversation/agent-runs/{agentRunId}/retry`，必带
`Idempotency-Key`，幂等与归属规则同停止：

- 仅 `failed` 的 Run 可重试：CAS `failed → queued`，`version+1`、`retry_count+1`；
  不接纳新的 UserMessage，不改动 `conversation_messages` 与 `input_sequence_no`。
  下一次 claim 创建新 Advance，按既有规则冻结 `sequence_no > input_sequence_no`
  的同一批输入。
- 非 `failed` 状态返回 `AGENT_RUN_NOT_RETRYABLE_CODE`（100308）。
- 重试不自动执行；Run 回到队列由 Worker 正常领取。

### 8.4 供应商调用记录与接管重放

`agent_provider_calls` 以 `(advance_id, call_slot)` 唯一定位一次模型调用（T07 基线
`call_slot=0`，每 Advance 恰好一次物理调用）：

- 状态机：`in_flight → succeeded | failed_definitive | outcome_unknown`。
  `succeeded` 必须持久化完整可重放结果（content、reasoning_summary、action、usage）；
  用户停止时 `in_flight` 置 `outcome_unknown`。
- Worker claim 后先读当前 Advance 的调用记录：
  - `succeeded` → 直接重放持久化结果，不调用 Provider，不新建记录；
  - `failed_definitive` → 重放失败，提交 `failed` RunCommit；
  - `in_flight | outcome_unknown` → 置 `outcome_unknown`，提交
    `failed(code=provider_outcome_unknown)` RunCommit，进入手动重试状态；
  - 无记录 → 开 `in_flight` 记录 → 调用 Provider → 结算。
- 结算绑定开记录时的 `fencing_token` 并以 `status=in_flight` 为守卫：接管侧先行
  把 `in_flight` 记录置 `outcome_unknown` 后，任何迟到结算（含旧 Worker 持原 fence
  的真实结果）都不得覆写；重放与置未知的竞争收敛由 claim 后的读取分支保证。
- 成本事实：调用记录行数与状态即 Agent 调用的成本事实；接管重放 `succeeded`
  结果不得新增记录或物理调用。fake 验收模式不经 new-api，账本断言以调用记录为准。

### 8.5 验收标记增补（fake 模式）

- `fake:hold-result:N`：调用结果结算为 `succeeded` 落库后、RunCommit 前睡眠 N ms，
  构造确定性「结果已持久化、尚未提交」窗口，供停 Worker 与接管重放场景使用。
  与既有 `fake:delay:N` / `fake:failure` 标记正交。
- `fake:failure-once`：同一 prompt 的首次调用确定性失败，其后正常回显；供手动重试
  场景验证 failed→重试→completed。判定优先于 `fake:failure` 子串匹配。

### 8.6 公开投影增补

`agent_run.status_changed` 与 Snapshot 的 Run 投影增加 `terminal_reason`、
`failure_code`、`retry_count`（见 §5）。provisional 交付永不进入 Snapshot；
刷新恢复后活动投影中没有临时文本，只有已接纳事实与 Run 状态。
