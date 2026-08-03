# Node Agent Runtime Contract v1

- **状态**：Accepted
- **关联工单**：IK67GG（T05）、IK67GY（T06，增补 §6–§7）
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
- `activated_creative_skill_versions` 0/1 数组，其中包含 Skill/版本身份、名称、展示版本、
  `resource_digest`、来源和结构化理由；
- 可空 `reasoning_summary`。

公开投影禁止出现 Manifest 内容、RunPin、Skill 正文、Runtime 资源正文、模型内部思考链或自由文本激活理由。

## 6. 多 AgentAdvance 与 PlanPhase 对齐流程（T06）

同一 AgentRun 可包含多个 AgentAdvance，`(agent_run_id, ordinal)` 唯一，`ordinal` 从 1 严格递增。
claim 时存在 `running` Advance 则复用（租约接管）；否则创建 `ordinal = 已有最大值 + 1` 的新 Advance，
并冻结 `sequence_no > run.input_sequence_no` 的 user 消息为 `input_messages[]` 与输入水位。

AgentWork 增加 `history_messages[]`：当前 Advance 输入水位之前的全部正式消息，按 `sequence_no`
升序，元素为 `{ role: "user" | "assistant", content }`。`input_messages[]` 的冻结语义不变；
history 仅供 Runtime 构造模型上下文，不是新的接纳事实。

RunCommit 增加两个 outcome：

- `awaiting_input`：原子接纳正式澄清/确认 AssistantMessage、创建
  `UserInputRequest(request_type=creation_clarification, expires_at=接纳时间+24h)`、
  Run 置 `awaiting_input`、更新 stage、Advance 置 completed、消费输入水位。
  同一 Run 已存在活动请求时拒绝提交。
- `cancelled`：User 自然语言表达"不要创建计划 / 停止"时由 Runtime 提交；
  Run 置 `cancelled`，`terminal_reason=user_requested`，不创建 AssistantMessage，不消费输入水位。

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

- 意图：输入含 `创作：` 前缀为创作请求；含 `修改：` 前缀为修改请求；否则为普通问答。
- 创作必需项：`主体：X` 与 `预期：Y`；修改必需项：`目标：X` 与 `变化：Y`。缺失时按列表顺序每轮只问第一个。
- 回答含 `你决定`：该缺失项由系统补默认值（`由系统选择的默认主体` / `由系统选择的默认结果`，
  修改请求为 `由系统选择的默认目标` / `由系统选择的默认变化`）。
- 回答含 `不支持：Z`：`Z` 记为不受支持的明确要求，继续澄清该项，不静默降级。
- `立即出计划`：可减少可选追问，但必需项缺失仍须询问，且不得绕过最终确认。
- 对齐完成后 Runtime 复述需求并发起最终确认请求；回答含 `同意` 时提交 `completed`。
- 回答含 `继续讨论`：回到 `alignment` 继续澄清；回答含 `不要创建计划` 或 `停止`：提交 `cancelled`。
