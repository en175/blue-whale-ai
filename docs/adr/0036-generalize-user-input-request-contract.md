# ADR-0036：泛化 UserInputRequest 契约为产品中性输入请求

- **状态**：Accepted
- **日期**：2026-07-17

> **IK3UUX 范围状态**：保留“User 通过 Conversation 自然语言回答当前有效请求”；精确路径、字段、
> 状态码与输入队列协议由后续实施 Spec 按最小需要定义，见
> [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。

## 背景

[ADR-0016 §5](0016-project-api-and-replayable-event-stream.md) 早已规定："UserInputRequest
属于 AgentRun……不是独立聚合，因此相关事件仍使用 AgentRun 的 `aggregate_id` 和
`aggregate_version`""公开 API 不提供确认按钮端点或布尔 `confirmed` 命令"。但落地实现基于成本确认
单场景，形成了与该约束不一致的现状：

- `user_input_requests` 表的 6 个成本字段（`quoted_amount_fen`、`quoted_provider`、
  `price_catalog_version` 等）全部 `NOT NULL`，写死了"成本确认"语义；
- 实现把 `user_input_request` 列为独立聚合（`AggregateType.USER_INPUT_REQUEST`），并提供了
  `POST /api/projects/{projectId}/input-requests/{requestId}/confirm` REST 端点与 standalone
 （BottomDock）形态；
- `AgentRunWorkerService` 把 Worker 提交的 `user_input_request` 字段视为终态错误硬拒
 （`WORKER_TERMINAL_NOT_ALLOWED`），OrchestratorPort（Python）完全不产输入请求提议；
- Project Snapshot 不返回 AgentRun 当前的活动 UserInputRequest（违反 ADR-0016 §2）；
- [ADR-0017 §1](0017-product-persistence-idempotency-and-recovery.md) 又把 UserInputRequest
  列为独立聚合，与 ADR-0016 §5 矛盾。

[ADR-0019 §3](0019-agent-orchestration-scaffold-and-replacement-seam.md) 已为 OrchestratorPort
预留了"UserInputRequest 提议"作为合法输出，但 Python `contracts.py` 从未承接该能力。

父工单 IK1NMM（打通 AgentChatPanel 生图 MVP 核心闭环）要求 Agent 遇到缺少关键信息的生图意图
时创建通用 UserInputRequest 并提出创作澄清问题。本 ADR 解决其前置预重构
（IK1NRW：泛化 UserInputRequest 契约并保持成本确认兼容）。

## 决策

将 UserInputRequest 泛化为归属 AgentRun 的产品中性输入请求契约，以稳定的产品级 `request_type`
区分至少两种语义：

- **创作澄清**（`creation_clarification`）：Agent 缺少推进创作所必需的信息，向用户提出一个可见
  问题并等待自然语言回答。不带动作报价、供应商或成本策略字段。
- **成本确认**（`cost_confirmation`）：GenerationAuthorizationGate 要求用户对已绑定的付费动作进行
  自然语言确认。沿用既有动作身份、参数摘要、报价与策略版本校验、过期、幂等、一次性消费与
  AuditRecord 语义，行为不变。

### 1. Schema 中性化（schema_version=1 兼容）

`user_input_requests` 表新增三列，并将 6 个成本字段改为可空：

| 变更 | 说明 |
|------|------|
| `request_type VARCHAR(32) NOT NULL DEFAULT 'cost_confirmation'` | 产品级请求类型；默认值让旧行自动解释为成本确认 |
| `question TEXT NULL` | 创作澄清可见问题（成本确认不填） |
| `answer_message_id BIGINT NULL` | 创作澄清回答绑定到权威 Conversation 消息 |
| `quoted_amount_fen` / `quoted_provider` / `*_version` 改 NULL | 创作澄清不携带报价；成本确认路径仍显式写入 |

`action_identity` / `action_type` / `arguments_digest` 保持 `NOT NULL`：创作澄清用产品中性占位
值（`clarification:<runId>` / `creation_clarification` / 空 map 摘要），不破坏 standalone 幂等
唯一键 `uk_standalone_action_confirmation`（创作澄清走 conversation 形，`request_target_type`
为 NULL，不进该唯一键）。

依据 ADR-0016 §6，schema_version=1 内允许增加可选列与可空化既列；旧客户端忽略新字段即可安全前进。

### 2. OrchestratorPort 接纳产品中性提议

`RunCommitRequest.user_input_request` 从不透明 `Map<String,Object>` 升级为强类型
`UserInputRequestProposal(request_type, question, resume_binding)`，并以 `@Pattern` 约束首版只接受
`creation_clarification`。`AgentRunWorkerService` 把原 `WORKER_TERMINAL_NOT_ALLOWED` 硬拒改为：

> **修订（ADR-0043）**：下述两条已更新——`error != null` 自 ADR-0043 D4 起接纳为 `failed` 终态
> （本条逆转）；`ACTIVE_REQUEST_ALREADY_BOUND` 语义自 ADR-0043 D1 起收紧为「同时最多一个活动
> 请求」，顺序多轮澄清合法。互斥（`PROPOSAL_ACTION_MUTEX`）与下文接纳后的原子保存不变。

- `error != null` 仍为终态拒绝（公开事实只承认 Java 接纳的状态转移）；
- `user_input_request` 提议被校验并接纳，前提是它与同提交的 `actions` **互斥**
 （`PROPOSAL_ACTION_MUTEX`），且来源 AgentRun 未绑定待消费请求
 （`ACTIVE_REQUEST_ALREADY_BOUND`）；
- 接纳后原子保存 RuntimeCheckpoint 与创作澄清请求，令来源 AgentRun 进入 `awaiting_input` /
 `awaiting_clarification` 并释放租约。

成本确认仍由 Java 侧 `GenerationAuthorizationGate` 的 `INPUT_REQUIRED` 决策在 commit 内部创建，
不走 OrchestratorPort 提议路径——这是刻意分工：模型只提议，确定性控制面在副作用前校验
（ADR-0018 §4）。

Python `contracts.py` 新增 `UserInputRequestProposal` dataclass 与 `OrchestratorResult.input_request`
可选字段，并在 `to_commit_payload()` 序列化为 `user_input_request` 键。FakeOrchestrator 演示产出
创作澄清提议（与 `actions` 互斥）。Pydantic AI Adapter 本次不接通真实澄清策略——那属于父工单
IK1NMM 与提示词设计范畴，本 ADR Out-of-scope。

### 3. 事件聚合向 ADR-0016 §4/§5 靠拢

新增三个 AgentRun 聚合事件常量，用于创作澄清：

- `agent_run.user_input_requested`（接纳创作澄清提议时发出）
- `agent_run.user_input_answered`（用户通过 `reply_to_input_request_id` 自然语言回答时发出）
- `agent_run.user_input_expired`（预留，首版由 `confirm` 路径的 `LATE_CONFIRMATION` 体现）

这些事件使用 AgentRun 的 `aggregate_id` 与 `aggregate_version`（创作澄清 requested 事件用来源
run 的真实版本，不再硬编码 0），符合 ADR-0016 §5。

成本确认事件沿用独立聚合 `user_input_request.created`（`AggregateType.USER_INPUT_REQUEST`），
**向后兼容**现有 SSE 客户端。这是过渡形态：删除独立聚合与 REST confirm 端点属于破坏性变更，
需要 schema_version=2 迁移窗口与独立 ADR，不在本决策范围。

### 4. Project Snapshot 返回活动请求（ADR-0016 §2）

`SnapshotResponse.AgentRunDto` 新增 `activeInputRequest` 字段（产品中性
`UserInputRequestDto`：`inputRequestId / requestType / question / actionIdentity / actionType /
status / expiresAt`）。`SnapshotService` 通过 `source_agent_run_id` 查询每个非终态 AgentRun 当前的
活动请求（`pending` 或 `confirmed`）。

Snapshot 切片**不含成本版本字段**（`quotedAmountFen` / `provider` / `*_version`），避免供应商私有
信息泄漏到浏览器可见的恢复入口。

### 5. 创作澄清的回答与恢复

用户仍只通过 Conversation 消息的 `reply_to_input_request_id` 回答。`UserInputRequestService.confirm`
对创作澄清接受任意非空自然语言回答（不限确认短语），并通过 `bindAnswerIfClarification` 把回答
绑定到权威 Conversation 消息。Java 仅在该标识是来源 AgentRun 当前活动请求时接纳回答，并恢复该
请求绑定的 AgentRun（`bindResumedRun`）。

`consumeValidated` 对创作澄清请求走简化校验：只校验归属、状态、未过期与 resumed run 绑定，不校验
动作身份与报价——创作澄清无绑定动作，恢复后 Agent 会基于回答提议新动作，新动作再走正常的成本
确认门或直接执行。重复、已过期、已回答或已被后续请求替代的回复保留为消息事实，但不解除等待状态。

## 考量过的选项

- **彻底收敛到 ADR-0016 §5**（移除 standalone 形态、删除 REST confirm 端点、UserInputRequest 收回
  AgentRun 子聚合）：能让规范与实现完全一致，但会让 `BottomDockGenerationJobIT`（约 9 个用例）
  与 standalone 成本确认链路全部失效，属于破坏性变更，需要 schema_version=2 迁移窗口和独立 ADR。
  本 ADR 仅作为目标态记录，不在此执行。
- **连真实创作澄清策略一起做**：让 Pydantic AI Adapter 真正在缺少信息时产出澄清提议。但这进入
  Agent 提示词/策略设计领域，IK1NRW Out-of-scope 明确排除"实现完整的创作澄清策略、提示词设计"。
- **先修订 ADR-0016/0017 矛盾再动代码**：本 ADR 即履行该职责——调和两份 ADR 的矛盾，把中性化
  决策与过渡形态正式登记。

## 后果

- UserInputRequest 成为产品中性输入请求，创作澄清与成本确认共享同一持久化、过期、幂等与审计骨架，
  但通过 `request_type` 走不同的校验、消费与事件路径。
- OrchestratorPort 获得提出产品中性输入请求的能力（ADR-0019 §3 预留位落地），为父工单 IK1NMM
  的创作澄清闭环奠定契约基础。
- Project Snapshot 首次返回 AgentRun 当前的活动请求，客户端可在断线恢复时正确重建等待态 UI。
- 现有成本确认测试（`AgentActionGovernanceIT`、`BottomDockGenerationJobIT`、
  `CostReservationServiceIT`、`AuditFailClosedIT` 等）继续通过：成本确认路径的语义、约束与审计
  决定完全不变。
- Skill 面板及 Skill 搜索、推荐、安装、执行能力零改动。

## 不包含

- 删除 standalone 形态、REST confirm 端点或独立聚合 `user_input_request`（破坏性变更，需独立 ADR）。
- Pydantic AI Adapter 接通真实创作澄清策略、提示词设计或生图闭环（父工单 IK1NMM）。
- 修改 GenerationJob、图片供应商、ContentReview 或成本阈值。
- 引入 Pydantic AI HITL、会话、事件或持久化模型作为产品事实。

## 关联

- 父工单：IK1NMM（打通 AgentChatPanel 生图 MVP 核心闭环）
- 本工单：IK1NRW（泛化 UserInputRequest 契约并保持成本确认兼容）
- 约束来源：[ADR-0016](0016-project-api-and-replayable-event-stream.md) §2/§4/§5/§6、
  [ADR-0017](0017-product-persistence-idempotency-and-recovery.md) §1/§2、
  [ADR-0018](0018-security-cost-review-audit-observability-baseline.md) §4/§7、
  [ADR-0019](0019-agent-orchestration-scaffold-and-replacement-seam.md) §2/§3
