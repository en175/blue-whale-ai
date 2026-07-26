# ADR-0043：AgentRun 三种规范化收场与任意多次澄清

- **状态**：Accepted
- **IK3UUX 范围状态**：Limited — 只保留 AgentRun 可完成、失败或由 User 取消，终态不自动重开；
  `recovery_failed`、错误证据分层、迟到结果收敛与 PendingConversationInput 不作为实施前置，见
  [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。
- **日期**：2026-07-23
- **决策者**：用户（触发工单：IK3BG2 实现任意多次澄清与 Run 三种收场规范化）
- **历史扩展**：[ADR-0046](0046-runtime-error-evidence-policy-and-terminal-boundary.md)、
  [ADR-0047](0047-agent-run-user-cancellation-boundary.md)、[ADR-0053](0053-conversation-message-ordering-and-agent-run-input-queue.md)

## 背景

多轮 Agent Orchestrator 落地后，运行节奏仍被三处程序自限卡住，且 Run 缺少规范化终态语义：

1. **澄清被限「每 Run 终生一次」**：恢复后的 Run 再提议澄清被 `ACTIVE_REQUEST_ALREADY_BOUND` 拒绝；零动作 commit 仅在特定引擎 + checkpoint 形态放行（`supportsNoActionCompletion`），首轮纯咨询与恢复后纯文本收尾被 `ACTION_MISSING` 拒绝。
2. **Worker 错误无终态出口**：error commit 被 `WORKER_TERMINAL_NOT_ALLOWED` 硬拒（ADR-0036 §2），Run 滞留 running 至租约过期重放，Worker 侧已存在的规范化错误码族（`BUNDLE_*` / `ORCHESTRATOR_CONTRACT_MISMATCH` / `ORCHESTRATION_FAILED`，含脱敏保障）不落任何产品事实。
3. **在途 Run 不失效**：新目标消息只创建新 AgentRun，同 Conversation 在途旧 Run 的 Worker 租约有效期内仍可提交；Worker 把 commit 409（`AGENT_RUN_CONFLICT`）归一为 RuntimeError 崩溃重试，无法区分「被取代」。

## 决策

### D1. 澄清节奏由意图决定：「同时最多一个活动请求」取代「终生一次」

同一 AgentRun 顺序多轮澄清合法。唯一约束：同时最多一个活动 UserInputRequest——活动 = 请求状态 `pending` / `confirmed` 且未过期未消费，两种 request_type 同规则，与 ADR-0036 §4 Snapshot `activeInputRequest` 口径一致。commit 提议门由「`confirmedInputRequestId != null` 即拒」改为按活动性查询判定（覆盖来源为本 Run 的请求与经 `confirmedInputRequestId` 绑定到本 Run 的请求）；`ACTIVE_REQUEST_ALREADY_BOUND` reasonCode 保留，仅语义收紧。恢复后可再澄清、修改方案或直接行动；明确输入直接行动时不被程序强制追问。

恢复绑定的创作澄清在 commit 被接纳时即消费（任何收场形态——动作 / 再澄清 / 纯文本 / 错误终态——都算回答已吸收）；成本确认绑定仍只在动作分支按动作身份与报价严格消费（ADR-0036 §5 不变）。

### D2. 零动作完成无条件合法（completed）

任何无动作、无输入请求提议、无错误的 commit 即合法完成（completed），契约级无条件放行、不限引擎与 checkpoint 形态。`ACTION_MISSING` 闸门与 `supportsNoActionCompletion` 的引擎 / checkpoint 形态限制退役。`PROPOSAL_ACTION_MUTEX` 不变。

### D3. 新消息原子取代在途 Run（superseded）

> **目标架构已废止本节触发规则**：根据 ADR-0053，普通新消息不再 supersede 非终态 Run，而是由
> Product API 按 Conversation 排序并登记到唯一活动 Run 的待处理输入队列。本节保留为历史决策记录；
> `superseded` 终态本身仍可供其他经过独立定义的显式替代流程使用。

新用户消息创建新 Run 时，同 Conversation 其余非终态 Run（`queued` / `running` / `awaiting_job` / `awaiting_input`）在同一事务内原子置为 `superseded` 新终态：fencing token 递增、显式释放租约（`lease_owner` / `lease_expires_at` 置空——MyBatis-Plus `updateById` 的 NOT_NULL 字段策略不持久化 null，须 lambdaUpdate 显式置空，commit 主路径同步修正）、逐个发 `AGENT_RUN_STATUS_CHANGED` 事件。在途旧 Worker 下次 commit 因 version / fencing / 租约 / 状态校验失败收到 409（`AGENT_RUN_CONFLICT`）。已提交 GenerationJob 不级联改写（CONTEXT.md 既有语义不变）。

Worker 侧 409 / `AGENT_RUN_CONFLICT`（信封 code=100303）映射为专用冲突错误类型 `AgentRunConflictError`，与其余 RuntimeError 区分：命中后打一条结构化 warn 日志、exit 0、不再提交任何状态；其他错误维持崩溃重试。

### D4. error commit 接纳为 failed 终态（对 ADR-0036 §2 的显式逆转）

ADR-0036 §2「`error != null` 仍为终态拒绝（`WORKER_TERMINAL_NOT_ALLOWED`）」自此逆转：Java 接纳 Worker 错误 commit 为合法终态转移——Run 进入 `failed` 新终态，`error_code` / `error_message` 落 `agent_runs` 两个可空新列（V15 迁移，ADR-0037 框架，schema_version=1 兼容），列长截断兜底（96 / 1024）。错误消息维持 Worker 侧既有脱敏契约（不含快照正文或私有路径），Java 原样持久化。failed Run 不再被 claim / 重放（终态不可重开不变，认领 SQL 与 commit 状态校验组合天然覆盖新终态）。error commit 的幂等重放与审计证据通道行为与其余 commit 一致。

「公开事实只承认 Java 接纳的状态转移」原则不变——变化的是 error 通道从「拒绝」变为「接纳为 failed 状态转移」。

### D5. enforcement-enabled=false 维持 fail closed

Bundle pin 为 null 时 Worker 侧既有 fail closed 不变（`ORCHESTRATOR_CONTRACT_MISMATCH`，绝不回退默认提示词或 Mock）；其失败结果经 D4 错误 commit 通道正常落 failed 终态，错误码可监控归因（agent_runs 列可查 + 结构化日志）。

## 备选方案与不采纳理由

- **保留「终生一次」、靠新 Conversation 规避**：违背「多轮节奏由意图决定」的产品目标，且 Snapshot `activeInputRequest` 口径本就已按「活动」定义。
- **supersede 不递增 fencing token、仅靠状态校验**：fencing 递增让「被取代」在 fencing 语义上显式可查，与 claim 重领的 fencing 单调性一致，杜绝任何边界窗口下旧 token 复用。
- **error commit 落独立错误表而非 agent_runs 列**：失败是 Run 的收场属性而非独立事实；两列可空设计对 schema_version=1 兼容，查询归因最直接。
- **Worker 409 统一崩溃重试**：被取代是确定性终态，重试无意义且污染错误监控；专用错误类型 + exit 0 让外层循环自然推进下一个 Run。

## 后果

- 正面：澄清往返次数无程序上限；三种收场（completed / superseded / failed）各自可监控归因；Worker 规范化错误码族首次落产品事实；在途旧 Worker 确定性退出，不再滞留重放。
- 代价：`agent_runs` 增两列（V15）；commit 主路径租约释放由「静默无效」修正为「显式置空」，行为与 ADR-0036 §2 原文「释放租约」口径一致（原实现因 NOT_NULL 字段策略从未真正置空，属一并修正的潜在偏差）。
- 测试锚点：Worker `test_worker.py` / `test_http_gateway.py` / `test_pydantic_orchestrator.py`（三轮澄清往返、零追问、pin null fail closed、409 确定性退出）；Java `AgentRunTerminalOutcomesIT`（三种收场 + 顺序多轮澄清 + 活动请求铁闸）。
