# AgentRun 暂停恢复与 GenerationJob 解耦 Spike 设计

## 背景

Wayfinder 地图“规划 Agent 创作后端架构与开源脚手架选型”需要用一个最小、可丢弃的 Spike 回答：候选编排器能否在不接管 Blue-Whale 产品模型的前提下，让 `AgentRun` 持久化暂停和跨进程恢复，并将长耗时 `GenerationJob` 留在独立后台 Worker 中。

前置调查已经确定：

- `AgentRun` 是一个创作意图的持久化运行单元；
- `GenerationJob` 是具体生图或生视频动作的持久化后台任务；
- Project、AgentRun、GenerationJob、Asset、产品事件与恢复游标必须由 Blue-Whale 数据库权威保存；
- 首选候选是 `pydantic-ai-slim==2.9.0`，`agentscope==2.0.4` 作为同场景对照，FakeOrchestrator 作为退出路径；
- LLM、图片和视频供应商使用确定性假实现，不发起付费或外部生成调用。

## 要回答的问题

真实 Pydantic AI Slim 和 AgentScope Core 是否都能藏在同一个产品中性端口之后，完成下列同一场景：

1. 运行到生成步骤后持久化暂停；
2. GenerationJob 在独立 Worker 中继续；
3. 主进程退出后恢复同一个 AgentRun；
4. 吸收暂停期间产生的 Job 结果并继续；
5. 对重复完成通知、部分成功和只补缺失输出保持幂等；
6. 用产品事件游标完成断线重连；
7. 替换为 FakeOrchestrator 时不修改产品状态、Worker 或事件契约。

Spike 只回答这一问题，不选择最终生产框架。

## 范围

### 包含

- 固定版本的 Pydantic AI Slim、AgentScope Python Core 和 FakeOrchestrator；
- 一个纯领域状态机；
- 一个明确标记为可删除的 SQLite Spike 数据库；
- 独立 OS 进程中的确定性 GenerationJob Worker；
- 可交互终端驱动器和一个自动演示模式；
- 事务中断、重复通知、部分成功、进程退出与事件断线的故障注入；
- 最终验证结论和候选差异记录。

### 不包含

- 正式 FastAPI 路由、SSE HTTP 服务或前端接入；
- 正式数据库迁移、生产队列、对象存储或部署配置；
- 真实模型、图片或视频供应商调用；
- 性能、容量、媒体质量或供应商计费验证；
- 活动 checkpoint 的跨框架迁移；
- 正式后端实现或最终框架采用决策。

## 方案选择

考虑过三种方案：

1. 纯状态机模拟：成本最低，但不能证明真实框架的 deferred/external execution 接力。
2. 受限 tracer bullet：产品状态机和 SQLite 为权威，真实接入两个候选框架，并用 FakeOrchestrator 验证退出边界。
3. FastAPI、Worker 和 SSE 的小型服务：运行形态更接近生产，但会越过 Wayfinder 的规划边界。

采用方案 2。它能产生框架级证据，同时仍是一次性原型。

## 目录与运行方式

原型放在：

```text
blue_whale_server/prototypes/agent_run_recovery/
├── README.md
├── __main__.py
├── domain.py
├── store.py
├── service.py
├── job_results.py
├── worker.py
├── tui.py
├── adapters/
│   ├── base.py
│   ├── fake.py
│   ├── pydantic_ai.py
│   └── agentscope.py
└── NOTES.md
```

依赖安装在原型专用虚拟环境，不修改正式后端依赖基线。README 提供一个启动命令；同一入口支持交互模式和 `--demo` 自动演示模式。SQLite 文件和虚拟环境均使用明显的 prototype 名称并被 Git 忽略。

## 架构边界

### 纯领域状态机

领域层只认识：

- `AgentRun`；
- `GenerationJob`；
- `Asset`；
- 产品事件；
- 产品事件游标；
- 编排器给出的产品中性命令。

领域层不导入 Pydantic AI 或 AgentScope，也不进行终端、数据库或进程 I/O。

### OrchestratorPort

三个适配器实现同一个异步窄接口：

```python
class OrchestratorPort(Protocol):
    engine: str
    engine_version: str

    async def start(self, request: RunRequest) -> StepOutcome: ...

    async def resume(
        self,
        checkpoint: OpaqueCheckpoint,
        results: list[ExternalResult],
    ) -> StepOutcome: ...
```

`StepOutcome` 只能包含：

- 版本化不透明 checkpoint；
- `CreateGenerationJob`；
- `AwaitUser`；
- 可展示消息或阶段变化；
- `CompleteRun`；
- 产品中性执行错误。

框架消息、事件类型、reply/tool-call 标识、原始提示词、thinking、内部工具名和堆栈不得越过适配器。

### 框架替换边界

替换保证的是“同一产品场景可以由另一适配器运行”，不是“活动 checkpoint 可以跨框架读取”。每个 AgentRun 固定记录：

- `engine`；
- `engine_version`；
- `checkpoint_schema_version`。

恢复时必须使用匹配的适配器和版本；不匹配时 fail closed。新 AgentRun 可以选择新编排器。正式替换若要迁移活动 Run，必须另行设计显式迁移或排空策略。

## Spike 数据模型

SQLite 只保存验证所需的最小字段：

- `agent_runs`：状态、暂停原因、显示阶段、引擎版本、checkpoint、乐观版本和执行租约；
- `generation_jobs`：所属 Run、不可变输入、预期输出数、状态、成功数、`retry_of_job_id` 和幂等键；
- `assets`：所属 Job、输出槽位和确定性假 URL；
- `run_events`：Run 内单调序号、产品事件类型、产品中性载荷和去重键；
- `idempotency_records`：外部通知和 Job 创建操作的处理结果。

原型不把框架 checkpoint 拆成业务列。即使 checkpoint 被删除或损坏，已提交的 Job、Asset、Run 状态和事件仍可查询，且不得被反向改写。

## 事务边界

### 创建 GenerationJob 断点

适配器先完整返回 deferred/external execution 请求，且框架工具在此前保持零副作用。产品服务随后在一个 SQLite 事务中：

1. 按 `agent_run_id + framework_call_id` 幂等创建 GenerationJob；
2. 保存版本化 checkpoint；
3. 将 AgentRun 置为 `awaiting_job`；
4. 追加产品事件。

事务中任一步故障都整体回滚，不能出现“Job 已存在但 Run 不知道”或反向悬挂。

### 接收 Job 结果

Worker 或重复回调使用稳定幂等键提交结果。产品服务在一个事务中：

1. 判断通知是否已处理；
2. 创建尚不存在的 Asset；
3. 写入 GenerationJob 不可变终态；
4. 追加产品事件；
5. 标记需要恢复的 AgentRun。

重复通知返回原处理结果，不创建第二份 Asset、第二条业务事件或第二次 Run 推进。

### 恢复 AgentRun

Worker 先取得带过期时间的 Run 执行租约，加载产品事实和匹配版本的 checkpoint，再把 Job 结果翻译为 `ExternalResult` 交给原适配器。另一个 Worker 只能在租约过期后接管，不能并发推进同一 Run。

## 固定 tracer bullet

同一场景分别运行 Pydantic AI、AgentScope 和 FakeOrchestrator：

1. 创建一个要求生成 4 个结果的 AgentRun；
2. 编排器请求一个 GenerationJob，Run 进入 `awaiting_job`；
3. 用户在安全检查点手动暂停，Run 进入 `awaiting_user / manual_pause`；
4. 独立 Worker 完成 2 个输出并使 Job 进入 `partially_succeeded`；
5. 重放相同完成通知，证明状态未变化；
6. 退出终端主进程，再从同一 SQLite 文件启动；
7. 恢复同一个 Run，先吸收两个成功 Asset；
8. 用户要求只补缺失部分，创建 `retry_of_job_id` 指向旧 Job 的新 Job；
9. 新 Job 完成另外两个输出，旧 Job 保持不可变终态；
10. Run 继续并完成；
11. 客户端从旧游标重连，只得到缺失且有序的产品事件；
12. 比较三种适配器的产品最终状态和事件形状。

## 真实框架接点

### Pydantic AI Slim

- 使用固定的 `pydantic-ai-slim==2.9.0`；
- 使用框架自带的确定性测试模型或等价本地模型，不调用外部 LLM；
- 外部生成工具在产生完整 `DeferredToolRequests` 前零副作用；
- 新进程用保存的消息/checkpoint 和 `DeferredToolResults` 继续同一个产品 Run。

### AgentScope Core

- 使用固定的 `agentscope==2.0.4` 和 Python 3.11 以上的原型环境；
- 使用确定性本地模型；
- 通过 external execution 事件形成相同的 GenerationJob 接力点；
- AgentState 仅作为版本化不透明 checkpoint，不成为产品状态源。

### FakeOrchestrator

- 不导入任何候选框架；
- 产生与两个真实适配器相同的产品中性命令；
- 证明领域服务、SQLite、Worker、事件和 TUI 不依赖候选框架。

## 终端交互

每次操作后清屏并展示完整相关状态：

- AgentRun 状态、暂停原因、显示阶段、引擎版本和 checkpoint 元数据；
- GenerationJob 状态、输出计数和重试关系；
- Asset 槽位；
- 当前客户端游标和最近产品事件；
- 最近动作是否产生状态变化。

快捷操作至少包括：创建 Run、推进编排、手动暂停、运行一次 Worker、注入部分成功、重放通知、退出、恢复、补缺失输出、模拟断线、从游标重连和切换新 Run 的适配器。

`--demo` 使用同一服务层自动执行固定 tracer bullet；`matrix` 分别运行三个引擎并自动比较产品最终状态、Job 关联和事件形状。它们不是正式测试套件，只用于重复产生可检查证据。

## 故障处理规则

- 非法状态转换被显式拒绝，且不修改数据库；
- 创建 Job 的事务中断时全部回滚；
- 重复或过期 Job 通知不产生新状态；
- checkpoint 引擎或版本不匹配时 fail closed；
- checkpoint 损坏不改写产品事实；
- GenerationJob 失败不自动等于 AgentRun 失败；
- AgentRun 手动暂停不取消已经提交的 Job；
- 恢复 Run 前先吸收已完成 Job 的结果；
- 产品事件使用单调序号和去重键，不使用框架事件 ID 作为公开游标；
- 只展示产品中性错误，不展示框架内部信息。

## 通过标准

三种适配器必须在同一固定场景中满足：

1. Run、Job、checkpoint 和事件的断点原子提交；
2. 主进程退出后恢复同一个 AgentRun；
3. 手动暂停后不启动新 Job，但已提交 Job 可后台完成；
4. 恢复时先吸收暂停期间完成的结果；
5. 重复完成通知不重复创建 Asset 或事件；
6. 部分成功保留已有 Asset；
7. 只补缺失输出时创建关联新 Job，旧 Job 终态不变；
8. 断线后按产品游标接续有序事件；
9. checkpoint 丢失不损坏产品事实；
10. Pydantic AI/AgentScope 类型和事件不泄露到领域模型或事件；
11. API 驱动进程与 Job Worker 可分进程运行；
12. 同一 AgentRun 不能被两个 Worker 同时推进；
13. FakeOrchestrator 替换时不修改领域、存储、Worker 和 TUI；
14. 三种适配器的最终产品状态、Asset 数量、Job 关联和事件形状一致。

若任一条无法证明，Spike 不通过，并把缺口记录为结论；不得用模拟结果冒充真实框架能力。

## 验证与人工评审

原型不新增正式自动化测试套件。验证分两层：

1. Agent 运行 `--demo` 三次，分别选择 Pydantic AI、AgentScope 和 FakeOrchestrator，保存逐项结果；
2. 用户运行交互模式，亲自触发暂停、部分成功、退出、恢复、重复通知和重连，并判断状态是否符合产品预期。

只有用户确认交互行为后，才可在 Wayfinder 子票中写 resolution comment、关闭子票并更新地图的 Decisions so far。

## 产物生命周期

- 设计规格和最终验证结论可以保留；
- TUI、适配器和 SQLite 原型在回答问题后删除，不进入正式实现；
- 若某个纯接口或状态规则值得进入正式代码，必须由后续实施票重新实现，不能直接把 Spike 当生产代码；
- 本票不需要 ADR：原型可逆，最终框架选型仍由后续 Wayfinder 决策票完成。
