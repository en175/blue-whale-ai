# Node Agent Runtime Contract v1

- **状态**：Accepted
- **关联工单**：IK67GG
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

T05 每个 Run 只有一个 `ordinal=1` 的 AgentAdvance。领取工作时冻结 `input_messages[]`、
`input_high_watermark_sequence_no`、RunPin、`fencing_token` 与 `run_version`；租约接管复用相同 Advance。

RunCommit 是 `completed | failed` 判别联合，以 `advance_id + request_digest` 线性化。相同摘要回放首次
receipt，不重复消息、激活、事件或版本；不同摘要返回冲突。`completed` 原子写入完整 AssistantMessage、
安全 `reasoning_summary`、可选单值 auto 激活、Run 状态和事件；`failed` 不创建 AssistantMessage。

## 5. 公开投影

Snapshot 与 `agent_run.created` / `agent_run.status_changed` 事件只公开：

- Run 身份、状态、阶段、版本；
- `activated_creative_skill_versions` 0/1 数组，其中包含 Skill/版本身份、名称、展示版本、
  `resource_digest`、来源和结构化理由；
- 可空 `reasoning_summary`。

公开投影禁止出现 Manifest 内容、RunPin、Skill 正文、Runtime 资源正文、模型内部思考链或自由文本激活理由。
