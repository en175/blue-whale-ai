# IK3UVZ：Agent Worker 的 Node.js 运行时替代方案评估

> **IK3UUX 范围状态**：保留“TypeScript 薄 Worker”方向；InvocationLedger、AttemptPermit、
> 精确 RunCommit、复杂 checkpoint 与多层恢复只是历史研究假设，不属于当前实施，见
> [ADR-0055](../adr/0055-prelaunch-typescript-unification-scope.md)。

> 研究日期：2026-07-25
>
> 研究问题：哪一种 Node.js 运行时最适合承载 Blue Whale 的 Agent Worker，同时不夺走产品层对 claim、流式提交、审批、checkpoint、资源预算和错误收场的事实权威？
>
> 结论性质：架构地图的外部研究输入，不是最终技术选型，也未包含实现或压测。

## 1. 结论

**默认推荐：Blue Whale 自有薄运行时 + Vercel AI SDK Core 作为默认 provider/tool/stream adapter；adapter 必须位于产品中立端口之后，并可被官方模型 SDK 的直接适配器替换。**

原因不是自研能力更丰富，而是 Blue Whale 已经把最难且不可让渡的语义定义在产品层：带 fence 的 claim、两次流尝试、显式 abort、关闭 pending tool call 的 checkpoint、只产出 proposal 的副作用工具、统一 `RunCommit`、可重建的资源账本，以及产品中立的错误提交。五个候选中没有一个原生实现这组组合语义；引入完整 Agent 框架反而会产生第二套运行状态和恢复事实源。

选择顺序：

1. **当前基线：Blue Whale 自有薄运行时 + Vercel AI SDK Core 默认适配器。** 精确贴合产品契约，状态重叠最少；Vercel AI SDK Core 只统一 provider、tool 和 stream，不拥有 checkpoint/lease/commit；代价是循环、checkpoint 编解码、取消、预算和错误归一化均由项目维护。
2. **条件性试验：LangGraph.js。** 它在 graph、持久 checkpoint、interrupt、事件流和失败恢复上最完整；只有当下一张票据证明薄内核的恢复复杂度不可接受时，才值得做受约束的 spike。
3. **后续耐久执行底座：Temporal TypeScript SDK。** 它最强的是 durable execution，不是 Agent 语义；当前会引入 Temporal Server/Cloud、确定性 Workflow/Activity 分层和第二套事件历史，暂不作为首阶段 Worker 内核。
4. **不作为默认内核：OpenAI Agents SDK for TypeScript、Mastra。** 前者适合 OpenAI-first handoff/HITL，后者适合快速构建一体化 Agent/Workflow；两者都无法原生满足本项目的 fence、`RunCommit` 和资源账本边界。

## 2. 不可让渡的产品边界

本评估沿用现状基线的硬边界，详见 [IK3UVU 当前状态基线](./IK3UVU-node-rewrite-current-state-baseline.md) 第 5 节：

1. Product API 是唯一事实权威；Worker 只执行 `claim → stream → commit`，不得另立运行状态。
2. claim 必须携带 `run_version + fencing_token`；过期 fence 必须确定性退出。
3. `start/chunk/complete/abort` 是独立流事件；单次运行最多两次 stream attempt，混合文本与 deferred action 必须先 abort，再以纯 action 重试；usage 跨 attempt 汇总。
4. `RuntimeCheckpoint` 必须包含 `{engine, engine_version, adapter_schema_version, opaque_payload}`；损坏或引擎不匹配时 fail-closed，恢复后不得遗留开放的 pending tool call。
5. `ToolGrant` 动态决定工具可见性；读工具可直执，副作用工具只能提出 proposal；最终动作、资源账本和产品中立错误都只能经 `RunCommit` 落地。

此外，Runtime Bundle、ModelProfile 和 Creative Skill 必须固定版本并校验 digest；Creative Skill 在模型调用前注入；`ResourceGate` 必须覆盖初始、单次和活动 token 预算及读取证据，并能从历史重建账本。

## 3. 比较口径与版本快照

版本快照来自 2026-07-25 的官方 npm 包页：

| 候选 | 评估版本 | 运行时门槛 | 定位 |
|---|---:|---:|---|
| [OpenAI Agents SDK for TypeScript](https://www.npmjs.com/package/@openai/agents/v/0.13.5) | 0.13.5 | 以包声明为准 | OpenAI-first Agent loop、handoff、tool、HITL |
| [LangGraph.js](https://www.npmjs.com/package/@langchain/langgraph/v/1.4.8) | 1.4.8 | Node.js ≥ 18 | 状态图、checkpoint、interrupt、事件流 |
| [Mastra](https://www.npmjs.com/package/@mastra/core/v/1.52.1) | 1.52.1 | Node.js ≥ 22.13 | Agent + Workflow + Storage 一体化 |
| [Temporal TypeScript SDK](https://www.npmjs.com/package/@temporalio/worker/v/1.21.1) | 1.21.1 | Node.js ≥ 20.3 | 通用 durable execution |
| [OpenAI Node SDK](https://www.npmjs.com/package/openai/v/6.49.0) / [Vercel AI SDK Core](https://www.npmjs.com/package/ai/v/7.0.37) | 6.49.0 / 7.0.37 | AI SDK Core：Node.js ≥ 22 | 薄内核下的模型、工具、流事件适配 |

符号：**原生**表示候选直接提供；**部分**表示可组合但仍需产品层约束；**缺失**表示必须自行实现。

## 4. 能力矩阵

| 能力 | OpenAI Agents SDK TS | LangGraph.js | Mastra | Temporal TS SDK | 薄内核 + 模型 SDK |
|---|---|---|---|---|---|
| 多轮编排 | **原生**模型→工具/handoff 循环；不是任意持久 DAG | **原生**StateGraph、条件边、循环、子图 | **原生**Agent loop 与 workflow 分支/并行/循环 | **部分**可写任意 Workflow；Agent loop 需自行建模 | **缺失**；按产品状态机精确实现 |
| 流式事件 | **原生**raw model、run item、agent/tool/approval 事件 | **原生**token、state、tool、checkpoint、task/debug 模式 | **原生**Agent 文本、workflow 生命周期和自定义 writer | **部分**Workflow Streams 仍为实验能力；通用消息可持久 | **部分**模型 SDK 提供 SSE/full stream；产品流事件自行映射 |
| 工具调用 / 人工审批 | **原生**`needsApproval`，序列化 `RunState` 后 approve/reject 恢复 | **原生**节点或工具内 `interrupt()`，同 thread 恢复 | **原生**tool approval、workflow suspend/resume | **部分**Signal/Update + `condition` 可建持久审批 | **缺失**；最容易严格实现 read/proposal 分离 |
| 持久 checkpoint / 恢复 | **部分**`RunState` 可序列化，Session/Conversation 保存模型上下文；应用仍需持久化运行状态并锁定 agent graph/SDK 版本 | **原生**checkpointer + `thread_id`，可接 Postgres/SQLite，支持 pause/failure 后恢复 | **部分**snapshot + `runId`；必须配置 durable Storage，默认内存不够 | **原生**事件历史重放、Activity 状态、Continue-As-New | **缺失**；实现项目定义的版本化 opaque checkpoint |
| 租约或幂等 | **缺失**AgentRun lease/fence 与副作用幂等均由应用负责 | **部分**任务可重放，未完成任务可能重跑；官方要求副作用使用幂等键/去重，无 Worker lease | **部分**LeaseProvider 仅覆盖 Signals/PubSub 的单所有者 TTL/转移，不等同 AgentRun fence；副作用幂等仍需应用负责 | **部分**任务队列与 durable retry 原生；Activity 必须幂等，产品 fence 仍需外置 | **缺失**；但可直接复用 Product API 的 claim/fence/commit |
| 取消 / 超时 | **部分**`AbortSignal`、工具超时；未提供产品级统一 deadline | **原生/部分**node timeout、idle timeout、`AbortSignal`、可恢复 drain | **部分**`Run.cancel()` 发出 `AbortSignal`，step 必须协作；未发现统一 workflow deadline | **原生**Workflow/Activity/heartbeat timeout、取消传播、reset | **部分**官方 SDK 提供 request timeout/abort；统一 deadline 与安全收场自行实现 |
| 资源预算 | **部分**`maxTurns`、工具并发、usage；无产品 token/cost 硬预算 | **部分**`recursionLimit`、node timeout；无 token/cost 账本 | **部分**TokenLimiter、部分运行/并发限制；无统一 cost/CPU/memory/wall budget | **部分**Worker slot 与 CPU/内存调优；不是每个 AgentRun 的 token/cost 预算 | **缺失**；最适合直接实现 `ResourceGate` 与跨 attempt usage |
| 错误收场 | **部分**max-turn、model refusal、invalid-final-output handler 与 tool error；补偿、DLQ、产品错误归一化需自研 | **部分**node retry/timeout/error handler；补偿、DLQ 和产品错误提交需自研 | **部分**retry、failure、`onError`/`onFinish`/fallback；产品错误归一化需自研 | **原生/部分**typed failure、retry、timeout；仍需映射为产品中立 `RunCommit` | **缺失**；直接把 provider/framework 错误封装在端口内 |

## 5. 候选证据与边界

### 5.1 OpenAI Agents SDK for TypeScript

官方运行指南把执行定义为模型生成最终输出、handoff 或工具调用的循环，并提供 `maxTurns`、stream、`AbortSignal`、session、工具并发和有限的 error handler；这满足常规 Agent loop，但不等于产品级 durable workflow。[运行 Agent](https://openai.github.io/openai-agents-js/guides/running-agents/) [流式输出](https://openai.github.io/openai-agents-js/guides/streaming/)

HITL 会暂停并返回带 interruption 的 `RunState`；状态可以序列化、存入数据库，再以相同 agent graph 恢复并 approve/reject。官方同时提示长期待审批状态需要考虑应用代码和 SDK 版本兼容，这意味着它只能成为 `RuntimeCheckpoint.opaque_payload` 的一种编码，不能成为唯一产品事实源。[Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) [Sessions](https://openai.github.io/openai-agents-js/guides/sessions/)

缺失项：AgentRun lease/fence、幂等副作用、两次 stream attempt 协议、跨 attempt usage、版本化产品 checkpoint、`RunCommit`、产品资源预算和错误归一化均需自研。

### 5.2 LangGraph.js

LangGraph.js 原生支持条件图、循环和子图；事件流覆盖 token、状态更新、工具、checkpoint、task 和 debug；`interrupt()` 可以在节点或工具中暂停并通过同一 `thread_id` 恢复。[Graph API](https://docs.langchain.com/oss/javascript/langgraph/use-graph-api) [Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming) [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

它是五个候选里最接近“可插拔 Agent 编排器”的一个：checkpointer 能持久化 thread 状态，并在暂停或失败后恢复。代价是产品 AgentRun 与 LangGraph thread/checkpoint 同时存在；必须证明一一映射、版本兼容和 fail-closed 行为，不能让 graph checkpoint 反向成为产品事实权威。[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) [Fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)

关键风险：恢复时未完成任务可能重跑；官方要求副作用使用幂等键或去重。因此 LangGraph 不能替代 Product API 的 fence、proposal/accept 分离和 `RunCommit`，只能位于这些边界之内。

### 5.3 Mastra

Mastra 同时提供 Agent loop、workflow 的分支/并行/循环/嵌套、文本与 lifecycle streaming、tool approval 以及 workflow suspend/resume，开发体验完整。[Workflow control flow](https://mastra.ai/en/docs/workflows/control-flow) [Streaming](https://mastra.ai/en/guides/concepts/streaming) [Agent approval](https://mastra.ai/en/docs/agents/agent-approval) [Suspend and resume](https://mastra.ai/en/docs/workflows/suspend-and-resume)

持久恢复依赖 snapshot、`runId` 和显式配置的 durable Storage；默认内存存储不构成进程重启后的恢复保证。[Snapshots](https://mastra.ai/en/docs/workflows/snapshots) [Error handling](https://mastra.ai/en/docs/workflows/error-handling)

其 LeaseProvider 文档限定在 Signals/PubSub 的单所有者 TTL 和原子转移，不是 Blue Whale 的 AgentRun claim/fencing token；取消依赖 step 响应 `AbortSignal`；TokenLimiter 也不能替代跨 stream attempt 的产品资源账本。[LeaseProvider](https://mastra.ai/en/reference/pubsub/lease-provider) [Cancel](https://mastra.ai/en/reference/workflows/run-methods/cancel) [TokenLimiter](https://mastra.ai/en/reference/processors/token-limiter-processor)

### 5.4 Temporal TypeScript SDK

Temporal 对 durable execution 的覆盖最强：Workflow 历史重放，Activity 可 retry/timeout，heartbeat 同时承担进度记录和取消传递；官方明确建议 Activity 幂等。[Activity execution](https://docs.temporal.io/develop/typescript/activities/execution) [Activity timeouts](https://docs.temporal.io/develop/typescript/activities/timeouts) [Activity idempotency](https://docs.temporal.io/activity-definition#idempotency)

Signal、Query 和可跟踪的 Update 能表达外部消息和审批；Workflow/Activity timeout、取消、reset、Continue-As-New 能覆盖长生命周期运行。[Message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing) [Workflow timeouts](https://docs.temporal.io/develop/typescript/workflows/timeouts) [Cancellation](https://docs.temporal.io/develop/typescript/workflows/cancellation) [Continue-As-New](https://docs.temporal.io/develop/typescript/workflows/continue-as-new)

但它不是开箱即用的 Agent 内核。模型调用必须放入 Activity，Workflow 代码必须保持确定性，还要运营 Temporal Server/Cloud。官方 OpenAI Agents 集成仍标记为 pre-release，Workflow Streams 仍是实验能力，Continue-As-New 还需手动携带 session；因此不应成为当前迁移的稳定前置依赖。[OpenAI Agents integration](https://docs.temporal.io/develop/typescript/integrations/openai-agents) [Worker performance](https://docs.temporal.io/develop/worker-performance)

### 5.5 薄编排内核 + 官方模型 SDK

以官方 OpenAI Node SDK 为例，基础传输已经提供 Responses API、SSE streaming、超时、自动重试、typed errors、request ID 和多轮 response 链接；这些适合封装进产品中立的模型端口，但不提供 AgentRun checkpoint、lease 或 commit。[OpenAI Node SDK README](https://github.com/openai/openai-node/blob/v6.49.0/README.md) [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) [Function calling](https://developers.openai.com/api/docs/guides/function-calling)

Responses API 的 background mode 可以轮询、取消和按 `sequence_number` 恢复单个 provider response 的 HTTP 流；这仍不是产品级 durable AgentRun，不能替代 `RuntimeCheckpoint` 或 Product API 的 claim/commit。[Background mode](https://developers.openai.com/api/docs/guides/background) [Responses create API](https://developers.openai.com/api/reference/resources/responses/methods/create)

Vercel AI SDK Core 可作为可替换适配器：官方明确允许用 `generateText`/`streamText` 手写复杂循环；无 `execute` 的工具只返回 tool call，适合让副作用停在 proposal；`streamText` 提供 full stream、usage、`AbortSignal` 和 total/step/first-chunk/chunk/tool timeout。它仍不提供 checkpoint、lease/fence、`RunCommit` 或 `ResourceGate`。[Loop control](https://ai-sdk.dev/docs/agents/loop-control) [streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) [Tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)

## 6. 风险清单

| 风险 | 最易受影响的路线 | 控制措施 |
|---|---|---|
| 第二事实源：框架 thread/workflow 状态与 Product API 冲突 | LangGraph、Mastra、Temporal | 产品表只保存版本化 opaque payload；恢复前重新 claim 并校验 fence；框架状态不得直接触发外部动作 |
| 重放导致副作用重复 | LangGraph、Temporal；其余路线也可能发生 | read/proposal 分离；所有 accepted action 以产品幂等键经 `RunCommit` 执行 |
| 长期待审批状态在升级后不可恢复 | OpenAI Agents SDK、LangGraph、Mastra | 固定 engine/engine version/adapter schema；升级前做 checkpoint 迁移或保留旧适配器；不兼容时 fail-closed |
| 流取消后仍继续耗费资源或错误提交 | 全部路线 | 把 Product API 取消、deadline 和 fence 组合进统一 abort；commit 前二次校验；每次 attempt 强制 complete/abort |
| 资源限制只有“轮数/并发”，没有产品 token 账本 | 全部路线 | `ResourceGate` 留在产品端口；从历史重建 usage/read evidence；框架限额只作附加护栏 |

## 7. 下一票必须验证的缺口

这些验证由现有地图节点 **“确定 Node Agent Worker 的编排与恢复模型”** 吸收；本研究不新增票据。

1. **恢复闭环：** 对每个保留候选做“模型返回 tool call 后进程崩溃”的故障注入；恢复必须关闭 pending tool call，损坏、错 engine、错 schema checkpoint 必须 fail-closed。
2. **fence 与幂等：** 构造旧 Worker 在 lease 过期后继续输出、同一 Activity/node 重放和重复 approve；旧 fence 不得写 chunk/commit，副作用 proposal 只能 accepted 一次。
3. **流尝试协议：** 验证 text + deferred action 会产生 `abort(attempt=1)` 后纯 action 的第二次尝试，最多两次，usage 聚合且每次都有终态。
4. **固定输入与审批：** Runtime Bundle、ModelProfile、Creative Skill digest 不匹配必须在模型调用前拒绝；动态 ToolGrant 必须隐藏未授权工具，副作用只能进入 `RunCommit`。
5. **资源与错误收场：** 注入 token 超限、read evidence 超限、timeout、取消、provider 429/5xx 和框架内部异常；结果只能是可重建账本和产品中立 error commit，不得泄露框架类型。

通过条件：薄内核满足全部五组验证，且实现复杂度可控，则保持默认推荐；只有 LangGraph 在同一组验证中显著减少恢复代码、又不产生第二事实源时，才升级为运行时候选；只有持久恢复和任务重放仍不可接受时，才进一步评估 Temporal。

## 8. 地图影响

本研究不改变现有依赖图，也不新增地图节点。它把“确定 Node Agent Worker 的编排与恢复模型”的决策空间收敛为：

1. 先实现并验证薄内核端口：model、tool visibility、checkpoint codec、resource gate、stream attempt、error mapper。
2. 将 LangGraph.js 仅作为同一验收用例下的受约束对照 spike。
3. 将 Temporal 保留为“产品表恢复模型不足”时的后续耐久执行底座，不阻塞 Node.js 迁移。
4. OpenAI Agents SDK 和 Mastra 不进入默认实现路径；只有未来产品明确需要其 handoff 或一体化 workflow 能力时再重评。
