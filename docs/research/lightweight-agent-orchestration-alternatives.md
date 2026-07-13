# Blue-Whale 轻量 Agent 编排替代方案筛选

> 调研问题：在 Blue-Whale 产品领域模型、API、持久化与事件协议继续权威的前提下，
> 哪个轻量 Agent 编排内核最适合进入首版受限 Spike。
> 本文只做选型研究，不实施集成。
> 触发工单：[筛选更轻量的 Agent 编排替代方案](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7N)。

## 结论（TL;DR）

**将 `pydantic-ai-slim==2.9.0` 提升为首选受限 Spike 候选，AgentScope Python Core
降为备选；LangGraph 只在 Spike 证明需要显式 graph/checkpointer 时进入备选；
OpenAI Agents SDK 不优先；smolagents 不承担耐久恢复；DBOS 只作为第二阶段耐久底座；
最小自研是明确退出路径。**

理由不是“功能最多”，而是 Pydantic AI Slim 在当前 Python 3.10+ 基线上，用最小基础依赖
提供异步 Agent 循环、结构化类型、事件流和 deferred tools。它最接近 Blue-Whale 所需的
“薄编排内核”，且不自带另一套产品 API、session 数据库或 Gateway。

结论有两个硬前提：

1. Blue-Whale 数据库继续唯一权威地保存 Project、AgentRun、GenerationJob、Asset、
   GenerationAuthorizationGate、公开 API、产品 SSE 与事件序号。
2. Pydantic AI 的 `DeferredToolRequests` / message history 只能作为版本化不透明 checkpoint；
   不得让工具函数在抛出 `CallDeferred` 前直接提交 GenerationJob。

第二条刻意比官方 external-tool 示例更严格。官方示例允许工具先调度后台任务再抛
`CallDeferred`，见 [Deferred Tools 官方说明](https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/)；
但 Blue-Whale 必须先拿到完整 `DeferredToolRequests`，再以产品幂等键把 Job 创建、
AgentRun `awaiting_job` 与 checkpoint 更新放进可恢复边界，避免“Job 已提交而断点未落盘”。

## 1. 不可让渡的产品边界

本次比较的是内部执行内核，不是产品后端平台。以下对象与协议不能交给候选框架：

- Project：顶层聚合根，拥有 Canvas 与 AgentChatPanel 历史；
- AgentRun：持续创作意图、用户可见阶段、暂停与恢复；
- GenerationJob：多输出、部分成功、冻结输入、缺失输出关联重试；
- Asset：生成输入与输出的独立文件实体；
- GenerationAuthorizationGate：按意图、成本和不可逆性做自然语言授权；
- 产品 API、SSE、`event_id`、单调 sequence、重连游标和公开错误；
- API/Worker 独立扩展、同一 AgentRun 执行所有权和产品数据库。

框架只能回答“模型、工具和循环如何执行”。它的 run、thread、state、checkpoint、session、
interrupt、approval 或 event 都不是同名产品概念，必须停留在抗腐层内。

本结论继承 [明确首版 Agent 创作行为状态机](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7K)
和仓库 [`CONTEXT.md`](../../CONTEXT.md) 的边界，也延续
[评估 AgentScope 对本项目的适配性](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7M)
的“单一产品真相源”要求。

## 2. 固定版本、运行时、依赖与许可

所有比较固定到可复现制品，不把浮动 `main` 当依赖。

| 候选 | 固定版本 | Python | 基础依赖画像 | 许可 | 角色 |
|---|---:|---:|---|---|---|
| Pydantic AI Slim | 2.9.0 | >=3.10 | Pydantic、pydantic-graph、httpx、OTel API 等；模型 SDK 按 extra | MIT | 首选 Agent 内核 |
| LangGraph | 1.2.9 | >=3.10 | langchain-core、checkpoint/prebuilt/sdk、Pydantic | MIT | 显式 graph/checkpointer 备选 |
| OpenAI Agents SDK | 0.18.2 | >=3.10 | openai、MCP、Pydantic、websockets 等 | MIT | 不优先 |
| smolagents | 1.26.0 | >=3.10 | huggingface-hub、requests、rich、Jinja2、Pillow | Apache-2.0 | 简单循环参考 |
| DBOS | 2.26.0 | >=3.10 | psycopg、SQLAlchemy、websockets、PyYAML 等 | MIT | 第二阶段耐久底座 |
| 最小自研 | 仓库版本 | 项目基线 | 已有 FastAPI/数据库/Worker 依赖 | 项目许可 | 退出路径 |

版本和 `Requires-Python`、基础依赖以各制品元数据为准：
[Pydantic AI Slim 2.9.0](https://pypi.org/project/pydantic-ai-slim/2.9.0/)、
[LangGraph 1.2.9](https://pypi.org/project/langgraph/1.2.9/)、
[OpenAI Agents SDK 0.18.2](https://pypi.org/project/openai-agents/0.18.2/)、
[smolagents 1.26.0](https://pypi.org/project/smolagents/1.26.0/)、
[DBOS 2.26.0](https://pypi.org/project/dbos/2.26.0/)。

对应 tag commit 分别为：Pydantic AI
[`3adb9b0`](https://github.com/pydantic/pydantic-ai/commit/3adb9b0260383d0f9f2b2a9433f07e1ecfc768c1)、
LangGraph [`95af6a0`](https://github.com/langchain-ai/langgraph/commit/95af6a00718588e7b7ce17310e8006d267896a77)、
OpenAI Agents SDK [`41e79f1`](https://github.com/openai/openai-agents-python/commit/41e79f15940899349f8e13a1effd7bc00071f2e8)、
smolagents [`12c1bc8`](https://github.com/huggingface/smolagents/commit/12c1bc820eca50ace6f80a21d90426d41d74f845)、
DBOS [`2f1f2d4`](https://github.com/dbos-inc/dbos-transact-py/commit/2f1f2d49a6326855d662281626ac4494029d151b)。

许可证来源：Pydantic AI [MIT](https://github.com/pydantic/pydantic-ai/blob/v2.9.0/LICENSE)、
LangGraph [MIT](https://github.com/langchain-ai/langgraph/blob/1.2.9/LICENSE)、
OpenAI Agents SDK [MIT](https://github.com/openai/openai-agents-python/blob/v0.18.2/LICENSE)、
smolagents [Apache-2.0](https://github.com/huggingface/smolagents/blob/v1.26.0/LICENSE)、
DBOS [MIT](https://github.com/dbos-inc/dbos-transact-py/blob/2.26.0/LICENSE)。
许可本身不替代传递依赖清单和制品归档核验。

## 3. 统一适配矩阵

| 能力 | Pydantic Slim | LangGraph | OpenAI SDK | smolagents | DBOS | 最小自研 |
|---|---|---|---|---|---|---|
| 轻量 Agent 循环 | 高 | 中 | 高 | 高 | 无 | 按需 |
| 类型化输入/输出 | 高 | 高 | 高 | 中 | 无 | 高 |
| 事件/流式观测 | 高 | 高 | 高 | 中 | 工作流事件 | 按需 |
| 外部长任务接力 | 高，deferred tools | 中，interrupt/node | 中，RunState/HITL | 低 | 高，workflow/notification | 按需 |
| 内建耐久恢复 | 无完整工作流保证 | 高，需 checkpointer | HITL state；长运行依赖集成 | 低 | 高 | 需自建 |
| 状态模型侵入 | 低 | 中高 | 中 | 低 | 中高 | 最低 |
| 对产品 API/DB 重叠 | 低 | 中 | 中 | 低 | 高，若过早引入 | 无 |
| 当前首版排序 | 1 | 3 | 4 | 5 | 第二阶段 | 必须保留 |

`高` 表示候选本身有直接能力，不表示允许它成为产品真相源。

## 4. Pydantic AI Slim 2.9.0

### 4.1 为什么排第一

[`pydantic-ai-slim`](https://github.com/pydantic/pydantic-ai/tree/v2.9.0/pydantic_ai_slim)
是 Agent 核心包；基础安装不强制拉取全部模型供应商 SDK，模型与 MCP 等通过 extras 选择。
它保持 Python >=3.10，与当前 Blue-Whale 基线兼容，并复用团队已采用的 Pydantic 类型体系。

对本项目最关键的不是通用 ReAct，而是 deferred tools：

- `ApprovalRequired` 表示工具调用需要外部批准；
- `CallDeferred` 表示结果要在当前进程和当前 run 之外产生；
- run 结束时返回 `DeferredToolRequests`，包含已验证参数和 tool-call id；
- 外部完成后以 `DeferredToolResults` 和原 message history 开启后续 run；
- pending calls 可由 handler 部分解决，其余继续向调用者冒泡。

这些语义由 [Deferred Tools 官方文档](https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/)
定义，正好提供 AgentRun 与 GenerationJob 之间的控制流接缝，而没有宣称拥有 Job 本体。

### 4.2 必须纠正的提交顺序

官方示例在工具体内创建后台 task 后抛 `CallDeferred`，适合单进程演示；Blue-Whale
不能照搬。若提交 GenerationJob 后、框架输出 `DeferredToolRequests` 前进程崩溃，
产品会出现无法与 AgentRun checkpoint 对齐的孤儿 Job。

Spike 必须采用以下顺序：

1. external tool 只验证参数并抛 `CallDeferred`，不产生外部副作用；
2. 适配器完整消费 `DeferredToolRequests`；
3. 以 `agent_run_id + tool_call_id` 形成幂等键；
4. 在产品应用服务中创建 GenerationJob，并持久化 AgentRun 断点；
5. Job 完成后按 tool-call id 构造 `DeferredToolResults`；
6. 用版本化 message history 恢复，再把框架事件翻译为产品事件。

如果当前数据库不能让第 4 步原子完成，Spike 必须用 transactional outbox 或等价恢复扫描，
不能把一致性责任塞回 Pydantic AI。

### 4.3 限制

Pydantic AI message history 是 Agent 对话执行记录，不是 AgentRun 状态机；deferred result
接续是新 run，不自动提供跨进程执行所有权、Job 幂等、事件游标或长期 checkpoint 迁移。
Pydantic AI [版本政策](https://pydantic.dev/docs/ai/project/version-policy/)记录稳定 V2.0
于 2026-06-23 才发布；minor release 原则上不主动破坏兼容性，但允许增加 message part、
stream event 和可选字段。2.9.0 又于 2026-07-11 发布，见
[发布页](https://github.com/pydantic/pydantic-ai/releases/tag/v2.9.0)。因此必须固定精确版本、
防御式处理事件，并包装 checkpoint schema。

## 5. LangGraph 1.2.9

LangGraph 的优势是明确 graph、state、node、edge 与 checkpointer。需要复杂条件分支、并行节点、
长期可视化执行路径或成熟 checkpoint 时，它比薄 Agent loop 更有表达力。
官方 [持久化说明](https://docs.langchain.com/oss/python/langgraph/persistence)
把 thread 与 checkpoint 作为 durable execution 基础。

但这也是当前的侵入来源：graph state 很容易演变成第二套 AgentRun 状态，thread id 很容易
泄漏成产品 id，checkpointer 也容易与产品数据库争夺恢复权威。首版行为状态机已经明确，
尚无证据需要把它再编码成图。

更关键的是 [interrupt 规则](https://docs.langchain.com/oss/python/langgraph/interrupts)：
恢复时从发生 interrupt 的 node 开头重跑，不是从 Python 源码行继续；interrupt 前的代码会
再次执行。凡是创建 GenerationJob、扣费、写 Asset 或发布产品事件的副作用，都必须：

- 放在 interrupt 之后；或
- 拆成独立、结果可 checkpoint 的 task/node；或
- 使用稳定幂等键与 upsert，允许重复调用而不重复生效。

因此 LangGraph 只在 Spike 先证明“显式 graph/checkpointer 的收益超过第二状态模型成本”时备选。
固定制品见 [1.2.9](https://pypi.org/project/langgraph/1.2.9/)。

## 6. OpenAI Agents SDK 0.18.2

OpenAI Agents SDK 提供轻量 Agent、tool、handoff、guardrail、streaming 和 tracing。
当前官方 [Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/)
说明 `RunState` 可序列化 pending approval，并建议为长期 pending work 同时保存 SDK/Agent
定义版本；[Sessions](https://openai.github.io/openai-agents-python/sessions/)则主要保存对话历史。

它不是“完全没有恢复能力”。不优先的准确理由是：

- 基础包固定依赖 `openai`、MCP 和 websockets，供应链不如 Pydantic Slim 可裁剪；
- `RunState` 的核心成熟场景是 HITL interruption，不等于 GenerationJob 耐久执行；
- 官方把跨失败长运行交给 Dapr、Temporal、Restate 或 DBOS 等
  [durable execution integrations](https://openai.github.io/openai-agents-python/running_agents/)，
  引入后仍需另一层运行时；
- `conversation_id` / `previous_response_id` 是 OpenAI 服务端状态，不能成为多供应商产品真相源。

所以它可作为实现参考或未来 OpenAI 专用适配器，不进入当前首选 Spike。
固定版本与许可见 [v0.18.2](https://github.com/openai/openai-agents-python/releases/tag/v0.18.2)
和 [MIT License](https://github.com/openai/openai-agents-python/blob/v0.18.2/LICENSE)。

## 7. smolagents 1.26.0

smolagents 的价值是简单：`MultiStepAgent`、`CodeAgent` / `ToolCallingAgent`、工具、模型适配
和 step memory，官方也把它描述为 barebones agent library，见
[仓库说明](https://github.com/huggingface/smolagents/tree/v1.26.0)和
[Agent API](https://huggingface.co/docs/smolagents/reference/agents)。

固定版本的 [`AgentMemory`](https://github.com/huggingface/smolagents/blob/v1.26.0/src/smolagents/memory.py)
保存运行中的 step 列表；这不等于带外部结果关联、跨进程接管和幂等恢复的 durable checkpoint。
官方 1.26.0 能力面未提供与 Pydantic deferred tools、LangGraph checkpointer 或 DBOS workflow
等价的耐久接力协议。

因此它适合参考最小循环、工具接口和代码 Agent，不适合承担 AgentRun 暂停恢复。
若为了补足耐久性再自建大量协议，优势会退化为“最小自研外包给依赖”。
版本见 [v1.26.0 Release](https://github.com/huggingface/smolagents/releases/tag/v1.26.0)。

## 8. DBOS 2.26.0：第二阶段耐久底座

DBOS 不是 Agent 框架，而是 Postgres/SQLite 支撑的 Python durable execution 底座。
官方 [Workflow guarantees](https://docs.dbos.dev/python/tutorials/workflow-tutorial)
区分：已完成 step 不再执行、未完成 step 至少执行一次、transaction 恰好提交一次；
[transactional outbox 示例](https://docs.dbos.dev/python/examples/outbox)也明确外部消息仍需幂等。

它很适合第二阶段验证：

- GenerationJob 创建与断点落盘的事务边界；
- Worker 崩溃后的 step 恢复；
- durable queue、notification、sleep 和幂等 workflow id；
- Pydantic AI 或最小自研之下的耐久执行。

但首版直接引入会同时新增 DBOS system tables、workflow identity、step 边界和运维模型，
容易在产品 AgentRun/GenerationJob 之外形成另一套生命周期。先用产品表 + Worker 验证真实负载；
只有恢复、outbox 或队列复杂度被实证后再引入 DBOS。

固定制品与运行时见 [DBOS 2.26.0 PyPI](https://pypi.org/project/dbos/2.26.0/)，
架构能力见 [官方文档](https://docs.dbos.dev/)，许可为
[MIT](https://github.com/dbos-inc/dbos-transact-py/blob/2.26.0/LICENSE)。

## 9. 最小自研：必须保留的退出路径

最小自研不是预先造完整框架，只实现已经确定且无法下放的薄循环：

```text
load product snapshot
→ call model with approved tools
→ validate tool request
→ create/await GenerationJob or request user input
→ append product milestone
→ continue or finish
```

它复用产品 DB、Worker、outbox 与 SSE，没有第三方 checkpoint 迁移；代价是自行维护模型消息、
工具循环、重试和事件归一化。只要抗腐端口设计正确，它既是假实现，也是所有候选的退出演练。

最小自研不得扩张为通用 graph DSL、多 Agent 平台、插件市场或另一套 session 服务。
Spike 若证明 Pydantic AI 的 deferred/history 映射比这条循环更复杂，就应直接退出依赖。

## 10. 侵入与退出排序

从低到高按“进入产品 schema/API/event 的风险”排序：

1. 最小自研薄循环；
2. Pydantic AI Slim 单适配器；
3. AgentScope Python Core 单适配器；
4. LangGraph + durable checkpointer；
5. OpenAI SDK + 外部 durable integration；
6. DBOS 全面包裹产品流程；
7. 任一框架的 App/Service/Gateway 整套接管。

smolagents 的初始侵入很低，但补齐耐久恢复后的真实成本不可控，因此不进入耐久候选排序。

## 11. 统一抗腐层

内部端口只暴露 Blue-Whale 中性类型：

```text
start_or_continue(run_context, input, checkpoint?) -> internal event stream
resume_external(run_context, checkpoint, job_result) -> internal event stream
request_pause(execution_handle) -> pause outcome
snapshot() -> versioned opaque checkpoint
```

checkpoint 统一封装：

```text
engine + engine_version + adapter_schema_version + opaque_payload
```

禁止框架类型进入公开 DTO、领域实体、数据库列语义和 SSE。禁止用 framework run/thread id
替代 AgentRun id；禁止从 tool call 推导 GenerationJob 终态；禁止把 message history 当 Asset 存储。

事件适配器必须过滤 thinking、原始 prompt、工具内部名、文件路径和供应商错误，再由产品事件表
分配 `event_id`、sequence、`occurred_at` 和重连游标。

## 12. 受限 Spike 验收门槛

既有 [验证 AgentRun 暂停恢复与生成任务解耦](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H47)
应先用 Pydantic AI Slim 做 tracer bullet，并全部证明：

1. 固定 `pydantic-ai-slim==2.9.0` 和所需最小 extra，记录锁文件与许可证。
2. 除单一适配器和测试外，无 `pydantic_ai` import 或类型泄漏。
3. external tool 在 `CallDeferred` 前零副作用，不能直接提交 GenerationJob。
4. 完整 `DeferredToolRequests` 产生后，Job、AgentRun 断点与 checkpoint 可恢复地落盘。
5. 进程 A 停在 deferred request；进程 B 仅凭产品 DB 恢复并提交 result 继续。
6. 同一 `tool_call_id` 的 Job 完成消息重复投递不会重复继续或重复建 Asset。
7. 多输出部分成功保留成功 Asset，只为缺失输出创建关联新 Job。
8. manual_pause 不再启动新 Job；已提交 Job 可完成，恢复同一 AgentRun 后先吸收结果。
9. 未通过 GenerationAuthorizationGate 的请求不能进入生成工具。
10. checkpoint 删除或损坏不改写 Project、AgentRun、GenerationJob、Asset 等产品事实。
11. 公开 SSE 只含产品事件，断线后按产品 cursor 续传并可去重。
12. API 与 Worker 分进程；Worker 崩溃后另一 Worker 可取得同一 Run 的互斥执行权。
13. checkpoint 带版本；模拟升级不兼容时 fail closed，不静默错读 history。
14. 用 FakeOrchestrator/最小自研替换后，API、领域表、Worker 与前端契约零修改。
15. 以同一用例对照 AgentScope Core；只有可测能力明显缺失才升级备选。
16. 只有明确出现复杂 graph/checkpointer 需求，才追加 LangGraph 对照；不因“可能需要”引入。

任一状态权威、幂等、跨进程恢复或退出门槛失败，都应降级为最小自研，不进入正式架构。

## 13. 地图影响

本研究不新增票据，也不改变地图 Destination：

- [验证 AgentRun 暂停恢复与生成任务解耦](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H47)
  已完整承接 Pydantic AI Slim 首选、AgentScope Core 对照和最小自研退出演练；
- [形成开源脚手架采用结论与替换边界](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4E)
  应把候选顺序更新为 Pydantic Slim → AgentScope Core → 条件化 LangGraph；
- DBOS 不单独开票，只有既有 Spike 实证暴露耐久底座缺口时，才从地图 fog 毕业为后续问题。

最终决策指针：**Pydantic AI Slim 进入首选受限 Spike；AgentScope Core 降备选；
LangGraph 按 graph/checkpointer 证据触发；OpenAI SDK 与 smolagents 不优先；
DBOS 后置；最小自研始终作为可执行退出路径。**
