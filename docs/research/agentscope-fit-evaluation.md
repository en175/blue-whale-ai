# AgentScope 对 Blue-Whale Agent 创作后端的适配性评估

> 调研问题：AgentScope Python 与 AgentScope Java 能否在不接管产品领域模型和公开 API 的前提下，作为 Blue-Whale 内部 Agent 编排组件。
> 本文只做架构与脚手架选型，不实施集成。
> 触发工单：[评估 AgentScope 对本项目的适配性](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7M)。

## 结论（TL;DR）

**拒绝 AgentScope 整套平台接管 Blue-Whale 后端；把 AgentScope Python 2.0 Core 保留为固定版本、抗腐层后的首选受限 Spike 候选；首版不采用 AgentScope Java 运行时。**

具体边界：

1. Blue-Whale 继续权威定义并持久化 Project、AgentRun、GenerationJob、Asset、GenerationAuthorizationGate、公开 API、产品事件与恢复游标。
2. 只允许 AgentScope Python Core 的 `Agent`、`AgentState`、Toolkit、Middleware、typed events、HITL/external-execution 机制进入一个内部编排适配器。
3. 不采用 Python `agentscope.app` 的 Agent Service、user/agent/session API、RedisStorage、MessageBus 或 Web UI；它们与产品 API、数据库和事件层重叠。
4. 不采用 AgentScope Java 2.0 作为首版运行时：其能力强，但会在既定 Python + FastAPI 架构旁新增 JDK/Reactor/JVM 服务边界，且 2.0.0 GA 刚发布。
5. AgentScope 的 interruption 不是产品 `AgentRun.awaiting_user / manual_pause`；GenerationJob 的多输出、部分成功、冻结输入和关联重试也不是通用 tool call 状态。
6. 若 Spike 不能证明跨进程恢复、事件翻译、产品数据库唯一权威、版本化快照与假编排器替换，则退回“仅借鉴设计”，不引入运行时。

与 DeerFlow 相比，AgentScope Python Core 更贴合本项目的语言、异步调用和 external-execution 断点，因此更值得优先进入同一张 Spike 票；这仍是**候选优先级**，不是正式采用结论。

## 1. 评估基线

### 1.1 固定版本

本评估不把浮动分支当成依赖：

- AgentScope Python `main` 固定到 [`1aeb03d004292799091d437aaaf9486b424ecfa6`](https://github.com/agentscope-ai/agentscope/commit/1aeb03d004292799091d437aaaf9486b424ecfa6)。
- Python 最新稳定版为 [`v2.0.4`](https://github.com/agentscope-ai/agentscope/releases/tag/v2.0.4)，tag commit 为 [`ded7ccd72505ee50586fd2e7270fadde02575898`](https://github.com/agentscope-ai/agentscope/commit/ded7ccd72505ee50586fd2e7270fadde02575898)，发布于 2026-07-07。
- AgentScope Java `main` 固定到 [`e3a412ed2cc944e401da861c8d5e464b967724e9`](https://github.com/agentscope-ai/agentscope-java/commit/e3a412ed2cc944e401da861c8d5e464b967724e9)。
- Java 最新稳定版为 [`v2.0.0`](https://github.com/agentscope-ai/agentscope-java/releases/tag/v2.0.0)，tag commit 为 [`44c304ec84d5fbd8588c1af8bc71b1edb9663380`](https://github.com/agentscope-ai/agentscope-java/commit/44c304ec84d5fbd8588c1af8bc71b1edb9663380)，发布于 2026-07-10。

Python [`v2.0.0`](https://github.com/agentscope-ai/agentscope/releases/tag/v2.0.0)在 2026-05-25 才发布；[`v2.0.4` 发布说明](https://github.com/agentscope-ai/agentscope/releases/tag/v2.0.4)显示 agent interruption 与未完成工具调用收口是该补丁版本新增的能力，PyPI 分类仍为 `Development Status :: 4 - Beta`。Java 2.0.0 是 2.0 线首个 GA，发布三天后 `main` 已进入 `2.0.1-SNAPSHOT`，见固定提交的 [`pom.xml`](https://github.com/agentscope-ai/agentscope-java/blob/e3a412ed2cc944e401da861c8d5e464b967724e9/pom.xml)。两条 2.0 线都应锁定精确版本并把升级视为需要回归验证的迁移。

### 1.2 许可证与制品

- Python 仓库、[`v2.0.4` PyPI 元数据](https://pypi.org/project/agentscope/2.0.4/)与稳定提交均声明 Apache-2.0，稳定提交含完整 [`LICENSE`](https://github.com/agentscope-ai/agentscope/blob/ded7ccd72505ee50586fd2e7270fadde02575898/LICENSE)。许可本身不阻碍内部评估；再分发时应保留许可证和必要声明，若上游制品提供 NOTICE 则一并保留。
- Java [`README`](https://github.com/agentscope-ai/agentscope-java/blob/44c304ec84d5fbd8588c1af8bc71b1edb9663380/README.md)、[`pom.xml`](https://github.com/agentscope-ai/agentscope-java/blob/44c304ec84d5fbd8588c1af8bc71b1edb9663380/pom.xml)和所核对的源码文件头声明 Apache-2.0。
- 但 Java `v2.0.0` [根目录树](https://github.com/agentscope-ai/agentscope-java/tree/44c304ec84d5fbd8588c1af8bc71b1edb9663380)没有 README 所链接的 `LICENSE` 文件；直接检查 Maven Central 的 [`agentscope-harness-2.0.0.jar`](https://repo1.maven.org/maven2/io/agentscope/agentscope-harness/2.0.0/agentscope-harness-2.0.0.jar)也未见 `META-INF/LICENSE` 或 `META-INF/NOTICE`，尽管同目录的 [POM](https://repo1.maven.org/maven2/io/agentscope/agentscope-harness/2.0.0/agentscope-harness-2.0.0.pom)声明 Apache-2.0。这是**制品合规核验门**，不应仅凭缺文件直接定性为无授权或侵权；生产采用前须确认上游制品补齐方案，或取得法务认可的归档与再分发做法。

### 1.3 Blue-Whale 不可让渡的边界

本评估继承以下结论，不让框架反向重写产品模型：

- [盘点现有前端契约与后端骨架基线](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7J)已确认当前是前端内存 mock、目标 DTO/API 桩和 FastAPI 健康空壳。
- [明确首版 Agent 创作行为状态机](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7K)已冻结 AgentRun、GenerationJob、授权、暂停恢复、部分成功与不可变终态语义。
- 仓库 [`CONTEXT.md`](../../CONTEXT.md)定义 Project、Asset、GenerationJob、GenerationAuthorizationGate 及 Card/NodeItem 的关系。
- 技术约束是 Python + FastAPI 产品 API 外壳、模块化单体 + 独立 Worker、API 与 Worker 可独立扩展。

## 2. 三条产品线必须分开判断

“AgentScope”不是一个可以整体打分的单一运行时。本项目实际面对三种不同采用面。

### 2.1 AgentScope Python Core

稳定版核心 [`Agent`](https://github.com/agentscope-ai/agentscope/blob/ded7ccd72505ee50586fd2e7270fadde02575898/src/agentscope/agent/_agent.py)提供：

- 异步 `reply` 与 `reply_stream`；
- ReAct reasoning/acting 循环；
- Toolkit、MCP、技能与 Middleware 扩展；
- typed `AgentEvent` 流；
- tool permission allow/ask/deny；
- `RequireExternalExecutionEvent` / `ExternalExecutionResultEvent`；
- 可注入、可序列化的 `AgentState`。

这部分与现有 Python Worker 同进程，可通过一个适配器使用，不要求引入 AgentScope 自有 HTTP API。

### 2.2 AgentScope Python Agent Service

完整 `agentscope.app` 不只是 Core 的薄壳。固定版本包含：

- 自有 user、credential、agent、session、team、knowledge-base 资源；
- FastAPI 路由；
- `StorageBase` / RedisStorage；
- Redis/InMemory MessageBus、分布式 session lock、事件 replay；
- 中断分发、后台任务、唤醒与工作区管理。

其 [`ChatService`](https://github.com/agentscope-ai/agentscope/blob/ded7ccd72505ee50586fd2e7270fadde02575898/src/agentscope/app/_service/_chat.py)会持久化 AgentScope session state、管理分布式锁并发布自己的 session event；[`StorageBase`](https://github.com/agentscope-ai/agentscope/blob/ded7ccd72505ee50586fd2e7270fadde02575898/src/agentscope/app/storage/_base.py)又定义整套应用记录。

这些能力本身有价值，但与 Blue-Whale 产品 API、Project/AgentRun 数据库、事件和 Worker 协调层高度重叠。采用它会从“内部组件”变成“双应用平台”，因此拒绝。

### 2.3 AgentScope Java Core / Harness

Java 2.0 的 [`ReActAgent` / `HarnessAgent` 分层](https://github.com/agentscope-ai/agentscope-java/blob/44c304ec84d5fbd8588c1af8bc71b1edb9663380/README.md)设计成熟度较高：

- stateless agent + `RuntimeContext`；
- 28 类 typed event；
- HITL、external execution 和 cooperative interrupt；
- `AgentStateStore`；
- Redis、MySQL、PostgreSQL 等分布式 store；
- workspace、sandbox、subagent 与 cross-replica recovery。

固定版的 [`AgentStateStore`](https://github.com/agentscope-ai/agentscope-java/blob/44c304ec84d5fbd8588c1af8bc71b1edb9663380/agentscope-core/src/main/java/io/agentscope/core/state/AgentStateStore.java)和[生产部署说明](https://github.com/agentscope-ai/agentscope-java/blob/44c304ec84d5fbd8588c1af8bc71b1edb9663380/docs/v2/en/docs/others/going-to-production.md)可作为持久化与跨副本恢复的设计参考。

但 Blue-Whale 首版没有 Java 服务基线。采用 Java 意味着新增 JDK 17、Reactor、构建/镜像/监控链路和 Python↔Java RPC 契约；这比编排组件本身更重。即使技术能力更完整，也不符合当前最小架构，因此首版拒绝运行时采用。

## 3. Python Core 的适配点

| 能力 | 适配判断 | Blue-Whale 使用边界 |
|---|---|---|
| 异步 Agent 循环 | 高 | 只在 Worker 内驱动已获准的 AgentRun 步骤 |
| Typed event stream | 中高 | 适配器翻译为内部事件，不直接暴露给 SSE |
| External execution | 高 | 用于“提交 GenerationJob 后停住、结果回来再继续” |
| AgentState | 中高 | 仅作版本化不透明执行快照，不作产品事实源 |
| Toolkit / MCP / Skill | 高 | 注册经过产品策略批准的工具和技能 |
| Middleware | 中高 | 注入追踪、预算与过滤，不写产品状态机 |
| Permission engine | 中 | 只作执行安全兜底，不替代生成授权门 |
| Interruption | 中低 | 只作执行中止；产品暂停另行实现 |
| Python Agent Service | 低 | 不采用 |
| Java runtime | 低 | 首版不采用，只借鉴设计 |

### 3.1 External execution 与 GenerationJob

AgentScope 在外部工具被选中后发出 `RequireExternalExecutionEvent`，并把相应 tool call 以 `SUBMITTED` 状态留在 AgentState；后续调用把 [`ExternalExecutionResultEvent`](https://github.com/agentscope-ai/agentscope/blob/ded7ccd72505ee50586fd2e7270fadde02575898/src/agentscope/event/_event.py)作为输入交回，框架按 `reply_id` 和 tool-call id 校验等待项后继续 reasoning。这与长耗时生成动作的控制流非常接近：

1. Agent 选择已获准的生成工具；
2. 适配器创建并提交持久化 GenerationJob；
3. AgentState 快照与 AgentRun `awaiting_job` 状态一起落盘；
4. GenerationJob 在独立 Worker 中运行；
5. 完成事件幂等地转为 ExternalExecutionResultEvent；
6. 新进程恢复 AgentState，继续同一 AgentRun。

这只是执行接力。GenerationJob id、输出槽位、Asset、部分成功、重试关系和成本仍由 Blue-Whale 保存。

### 3.2 AgentState 可以存，但不能成为产品模型

固定版 [`AgentState`](https://github.com/agentscope-ai/agentscope/blob/ded7ccd72505ee50586fd2e7270fadde02575898/src/agentscope/state/_state.py)是 Pydantic 模型，包含 `session_id`、压缩摘要、对话 context、当前 `reply_id`、循环迭代数，以及 permission/tool/task/middleware context；其中等待确认或等待外部执行也编码在尾部消息的 tool-call state 中。可用 Pydantic 的 `model_dump` / `model_validate` 做 JSON 快照。

但它没有 Project、AgentRun 生命周期、GenerationJob、Asset、revision_of、冻结输入或产品事件游标；也没有显式 state schema version。正确保存方式是：

```text
orchestration_checkpoint = {
  engine: "agentscope-python",
  engine_version: "2.0.4",
  adapter_schema_version: 1,
  payload: <opaque AgentState JSON>
}
```

产品数据库只把它当作可迁移、可丢弃或可替换的执行快照；查询产品状态不得解析其内部 context。

### 3.3 Typed events 有价值，但不能直接成为公开 SSE

AgentScope events 覆盖 reply、model call、text/thinking delta、tool call/result、HITL、external execution 与 interrupt。它们适合作为适配器输入，但缺少 Blue-Whale 所需的稳定 `agent_run_id`、GenerationJob/Asset 关联、产品级单调序号、重连游标与领域版本。

因此必须重新投影：

- 丢弃内部 thinking、原始 prompt、worker/tool 名、文件路径和供应商错误；
- 把高频 delta 与对话里程碑分开；
- 为产品事件分配独立 event_id、sequence 与 occurred_at；
- 只发送公开协议允许的阶段、Job、Asset 和错误摘要。

## 4. 关键语义缺口

### 4.1 Interruption 不是 AgentRun 手动暂停

Python 2.0.4 的 [`UserInterruptEvent`](https://github.com/agentscope-ai/agentscope/blob/ded7ccd72505ee50586fd2e7270fadde02575898/src/agentscope/event/_event.py)只对正在等待用户确认或外部执行结果的 parked reply 有意义；active reply 要取消底层 asyncio task，并走 `CancelledError` 清理路径。parked reply 被中断时，框架会为未完成工具调用补 `interrupted` tool result、输出兜底消息，并以 `ReplyEndReason.INTERRUPTED` 结束**当前 reply**。

Blue-Whale 的 `manual_pause` 是在安全检查点停止启动新步骤或 Job，之后继续**同一个 AgentRun**；已提交 Job 还可后台完成并在恢复时被吸收。二者不能一一映射：

- 框架 interrupted 不等于产品 cancelled/failed；
- 产品 manual_pause 不能依赖取消当前 asyncio task 的偶然时机；
- 恢复必须验证是否能在同一 AgentRun 中继续，而不是新建框架 session 掩盖断点。

### 4.2 Permission 不等于 GenerationAuthorizationGate

AgentScope [`PermissionEngine`](https://github.com/agentscope-ai/agentscope/blob/ded7ccd72505ee50586fd2e7270fadde02575898/src/agentscope/permission/_engine.py)判断具体工具调用 allow/ask/deny，重点是命令、文件路径和工具输入安全。

GenerationAuthorizationGate 判断的是创作意图是否明确、成本是否在默认额度内、操作是否高成本或不可逆，并要求自然语言授权。正确顺序是产品 Gate 先决策，再把已经获准的生成能力交给 Toolkit；框架 permission 只能作为第二道执行安全兜底。

### 4.3 GenerationJob 不能压成 tool call

Blue-Whale 一次 GenerationJob 可产生多个 Asset，状态为 `queued → processing → succeeded | partially_succeeded | failed`，并允许只补缺失输出的新 Job。AgentScope pending tool call 没有这些产品语义。

若把 Job 状态塞进 AgentState context，会导致：

- Job 查询依赖框架 JSON；
- 部分成功和幂等重试难以审计；
- 框架升级变成产品数据迁移；
- BottomDock 无法与 AgentChatPanel 共享同一 Job 基础设施。

所以生成工具只能返回 `generation_job_id` 或规范化结果，Job 本体始终在产品层。

### 4.4 运行时与依赖下限

Python 稳定版 [`pyproject.toml`](https://github.com/agentscope-ai/agentscope/blob/ded7ccd72505ee50586fd2e7270fadde02575898/pyproject.toml)和 [`v2.0.4` PyPI 元数据](https://pypi.org/project/agentscope/2.0.4/)都要求 Python >= 3.11，而 Blue-Whale `blue_whale_server/README.md` 当前写 Python 3.10+。采用前必须明确提升运行时下限并验证部署镜像。

AgentScope 没有单独的 core wheel；基础 `agentscope` 依赖会同时带入 OpenAI、Anthropic、DashScope、MCP、OpenTelemetry 等。FastAPI/Redis/workspace/RAG 属于 optional extras，可以不装，但基础供应链和冷启动成本仍需实测。

## 5. 侵入成本与退出成本

| 方案 | 侵入成本 | 退出成本 | 主要原因 | 结论 |
|---|---:|---:|---|---|
| Python Agent Service 整套采用 | 极高 | 极高 | API、session、存储、事件、锁和 UI 全部重叠 | 拒绝 |
| Python Core 经适配器局部采用 | 中 | 中低 | 升级 Python；维护事件/状态映射；类型不外泄 | 受限 Spike 首选 |
| Java Core/Harness | 高 | 高 | 新增 JVM 服务、RPC、双运行时运维 | 首版拒绝 |
| 仅借鉴设计 | 低 | 低 | 自行实现执行循环和断点 | 保底方案 |
| 完全不采用或借鉴 | 最低 | 最低 | 放弃现成 typed events/external execution | 仅在轻量方案明显更优时 |

Python Core 的退出成本只有在以下约束同时成立时才是中低：

- 只有 `AgentOrchestratorPort` 依赖 AgentScope；
- AgentScope Msg/Event/State/ID 不进入领域实体、数据库列语义、公开 DTO 或 SSE；
- checkpoint 带 engine/version/adapter schema，并允许丢弃重建；
- 生成供应商、GenerationJob、Asset 与成本授权不在框架工具内部持久化；
- 自动化测试能用 FakeOrchestrator 替换 AgentScope。

## 6. 推荐的抗腐层

建议只暴露一个内部端口，概念上包含：

```text
start_or_continue(run_context, user_input, checkpoint?) -> event stream
resume_external(run_context, checkpoint, job_result) -> event stream
request_interrupt(execution_handle) -> interrupt outcome
snapshot() -> versioned opaque checkpoint
```

端口输入只使用 Blue-Whale 内部 DTO：已冻结 asset 引用、已通过 Gate 的授权结论、AgentRun id 和可调用工具清单。输出只使用内部中性事件：visible message、stage change、request generation、await user、completed、execution error。

适配器负责：

- Blue-Whale DTO ↔ AgentScope Msg/Event 的双向映射；
- tool schema 与产品应用服务的桥接；
- checkpoint 的版本封装与迁移；
- 中断任务句柄、超时、背压和事件过滤；
- 把 external execution 接力到 GenerationJob，而不是直接执行供应商 API。

## 7. 受限 Spike 验收门槛

既有 [验证 AgentRun 暂停恢复与生成任务解耦](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H47) 应把 AgentScope Python Core 作为优先候选，并至少证明：

1. **固定制品**：只装 `agentscope==2.0.4`，记录锁文件、Python 3.11 镜像、传递依赖和许可证清单。
2. **跨进程恢复**：进程 A 产生 RequireExternalExecutionEvent 并保存 checkpoint；进程 B 只凭产品数据库恢复 AgentState，并用 ExternalExecutionResultEvent 继续。
3. **唯一权威**：删除 AgentScope checkpoint 后仍能查询 Project、AgentRun、GenerationJob、Asset 和终态；checkpoint 损坏不会改写产品事实。
4. **原子断点**：GenerationJob 创建、AgentRun `awaiting_job` 和 checkpoint 更新不会出现“Job 已提交但 Run 不知道”或反向悬挂。
5. **幂等接力**：同一个 Job 完成消息重复投递不会让 Agent 重复继续、重复建 Asset 或重复发里程碑。
6. **部分成功**：四个输出中两个成功、两个失败时，产品层保留成功 Asset，并只为缺失数量创建关联新 Job；框架旧状态不被篡改。
7. **暂停语义**：用户 manual_pause 后不再启动新 Job；已经运行的 Job 可完成；恢复同一 AgentRun 时先吸收结果再继续。
8. **中断边界**：active cancellation 与 parked UserInterruptEvent 均不会被误映射为产品 failed/cancelled，且清理后的 checkpoint 可诊断。
9. **事件翻译**：公开 SSE 只出现产品阶段、Job/Asset 与可展示错误；无 thinking、原始 prompt、工具名、文件路径或 AgentScope event 类型泄漏。
10. **顺序与重连**：断开 SSE 后从产品 event cursor 接续，重复事件可去重；不依赖 AgentScope reply_id 充当公开游标。
11. **独立扩展**：API 和 Worker 分进程运行，同一 AgentRun 有互斥执行权，进程退出后另一 Worker 可接管。
12. **退出演练**：用 FakeOrchestrator 替换 AgentScope，公开 API、领域表、GenerationJob Worker 和前端契约零修改，只有适配器测试夹具变化。

任何一条涉及状态权威、恢复或替换的门槛失败，都应停止采用，不用“后续再补”把框架耦合带入正式架构。

## 8. 最终判断

### 采用

- 仅把 AgentScope Python Core 作为受限 Spike 的首选候选；
- 候选能力限于 Agent 循环、Toolkit/Middleware、typed events、external execution 和可序列化 AgentState；
- 版本固定为 2.0.4，先提升并验证 Python 3.11 基线。

### 拒绝

- AgentScope Python Agent Service/App 接管产品后端；
- AgentScope user/agent/session、RedisStorage、MessageBus 与 SSE 成为产品事实源；
- AgentScope permission 替代 GenerationAuthorizationGate；
- AgentScope interruption 直接映射 AgentRun manual_pause/cancelled/failed；
- AgentScope Java 2.0 成为首版运行时。

### 仅借鉴

- Java 的 stateless agent、RuntimeContext、AgentStateStore 与 distributed store 设计；
- Python App 对分布式 session lock、取消分发、finally 中 shielded persistence 和 event replay 的处理；
- 两条实现线的 typed event、external execution 与中间件分层。

## 9. 地图影响

本结论没有产生新的独立票据，也没有使既有票据越过地图 Destination：

- [验证 AgentRun 暂停恢复与生成任务解耦](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H47)已经完整承接上述 Spike；本票关闭后，其 AgentScope 阻塞边得到满足。
- [筛选更轻量的 Agent 编排替代方案](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7N)仍需判断是否存在依赖更轻、状态语义更容易隔离的候选。
- [形成开源脚手架采用结论与替换边界](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4E)仍应综合 DeerFlow、AgentScope、轻量方案、供应商契约与 Spike 实证后作最终采用决定。

因此当前决策是：**AgentScope Python Core 进入优先 Spike 候选；AgentScope App/Service 与 Java runtime 不进入首版；产品权威边界不变。**
