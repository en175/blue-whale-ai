# ADR-0019：Agent 编排脚手架采用与替换 seam

- **状态**：Accepted
- **IK3UUX 范围状态**：Superseded — Python/Pydantic AI/AgentScope 只作为迁移前研究基线；目标使用
  TypeScript 薄 Worker，且不预建框架替换治理，见 [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。
- **日期**：2026-07-14

## 背景

ADR-0015 已确定 Java Product API 是唯一公开产品控制面，Python Agent Worker 只负责 LLM、
Skill、Tool 与 Agent 编排；ADR-0017、ADR-0018 已进一步冻结产品状态持久化、恢复、工具授权、
成本与审计语义。Agent 框架因此只能位于产品控制面之外，不能拥有 Project、Conversation、
AgentRun、GenerationJob、Asset 或产品事件的权威状态。

前序调查分别评估了 DeerFlow、AgentScope 和轻量编排方案，并以同一确定性 Spike 验证 Pydantic AI、
AgentScope 与 Fake Adapter。三种 Adapter 均能在不改变产品 Run、Job、Asset、存储与事件形态的
前提下完成暂停、独立生成、跨进程恢复、部分成功吸收和缺失输出重试。首版需要据此选择一个足够
轻量的默认实现，同时保留可实际演练的退出路径。

该 Spike 固定使用 `pydantic-ai-slim==2.9.0`、`agentscope==2.0.4` 与 Fake Adapter，三种实现
分别通过同一场景的 `14/14` 判定，并得到一致的产品状态和事件形态。完整执行结论见
[验证 AgentRun 暂停恢复与生成任务解耦](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H47)。

## 决策

### 1. 采用自有产品骨架并受限嵌入 Pydantic AI Slim

首版固定使用 `pydantic-ai-slim==2.9.0` 作为 Python Agent Worker 内部的默认编排库。它不是
Blue-Whale 产品后端脚手架，也不构成公开产品控制面；Java Product API、产品领域 Module、
持久化、产品事件和 Worker 调度继续由 Blue-Whale 定义。

依赖必须固定到经过验证的版本和最小必要 extra。发布新版本本身不触发升级，运行中的 AgentRun
始终固定到创建时的引擎、引擎版本和 Adapter schema 版本。

### 2. 只复用最小编排能力面

Pydantic AI Adapter 只允许复用以下能力：

- 模型调用与工具调用循环；
- 类型化工具参数和结构化输出校验；
- `DeferredToolRequests` / `DeferredToolResults`；
- 消息历史的序列化与恢复，并将其封装为 RuntimeCheckpoint 的不透明 payload；
- Token 用量、工具请求、可见文本和框架错误的内部采集与产品中性转换。

Java 提供的工具目录只表示 Agent 可以提出哪些候选动作，不代表动作已获授权。模型输出必须转换为
产品中性结果；其中涉及动作执行或需要用户补充输入的输出，必须分别转换为 AgentActionProposal
或 UserInputRequest 提议，再由 Java 按 User、Project、AgentRun、工具 schema、资源归属、
幂等、成本与有效输入请求做确定性校验。

### 3. `OrchestratorPort` 是唯一替换 seam

`OrchestratorPort` 是一个深 Module 的 Interface。它只表达一种能力：接收当前产品上下文，推进
AgentRun，并返回产品中性结果。其 Interface 包含以下语义：

- 输入可以包含 Java 已接纳的 Conversation 上下文、ContentReview 通过证据、模型与版本策略、
  CostReservation 或等价的执行预算、当前 Run 版本、允许提议的 Skill/Tool 目录、已完成的
  外部结果、可选 RuntimeCheckpoint、取消信号与执行截止时间；
- 输出可以包含可见文本、AgentActionProposal、UserInputRequest 提议、等待或完成结果、
  RuntimeCheckpoint、用量证据与规范化错误；
- RuntimeCheckpoint 只跨 seam 传递
  `engine + engine_version + adapter_schema_version + opaque_payload`，Java 不解析 payload；
- Interface 不暴露框架消息、状态名、异常、事件、会话标识或供应商私有字段。

Pydantic AI、AgentScope 和 Fake Adapter 必须满足同一个 Interface 和契约矩阵。Pydantic AI 是
首版生产 Adapter；AgentScope 只保留为备选验证 Adapter；Fake Adapter 只用于测试。调用方和产品
测试不得依赖某个具体 Adapter 的类型或内部步骤。

Python Agent Worker 只能在 Java 接纳的内容审核、模型策略和成本预留范围内调用 LLM，不得自行
扩大模型、Token、工具或费用上限。模型产生的文字和结构化结果仍须由 Java 侧 ContentReview 明确
通过，才能持久化为用户可见产品事实。

### 4. 所有产品副作用由 Java 接纳

Adapter 不分配产品标识、不写产品数据库、不创建或更新 GenerationJob、不直接发布公开 SSE，
也不直接调用图片或视频供应商。Java 校验 Run 版本、租约、栅栏、权限、成本与幂等后，才能持久化
Conversation 消息、更新 AgentRun、创建 GenerationJob、接纳 RuntimeCheckpoint 并追加产品
事件。

Python Agent Worker 可以调用 LLM，但图片和视频生成只能形成产品中性动作提议；Java 接纳后创建
GenerationJob，再由 Java Generation Worker 经供应商 Adapter 执行。框架内临时流和事件不能
绕过 Java 成为浏览器可见事实。

### 5. 首版明确拒绝框架扩张

首版不采用：

- DeerFlow App、Gateway、Harness 或 AgentScope 平台；
- Pydantic AI Harness、Web UI、AG-UI、框架 SSE 或示例 FastAPI 产品接口；
- Pydantic Graph、LangGraph、DBOS、Temporal 等图编排或耐久执行 Module；
- 框架的 thread、session、run、memory、checkpoint、事件流或存储作为产品事实；
- 框架 HITL/approval 作为安全授权边界；
- Logfire 等框架配套平台作为强制依赖或产品可观测性权威；
- 任何框架类型、状态、异常、事件或供应商字段进入公开 DTO、领域实体、数据库列语义或产品 SSE。

这些拒绝项只定义首版默认范围，并非永久禁止；只有满足本 ADR 的升级触发条件才能重新评估。

### 6. 退出以新 AgentRun 为切换单位

正常退出某个 Adapter 时，先停止为新 AgentRun 分配该引擎版本，再由原 Adapter 将已有活动 Run
排空到终态。新 Run 改用已经通过统一契约矩阵的最小自研 Adapter 或其他合格生产 Adapter。

Adapter 只有在固定到该引擎版本的非终态 Run 数量为零时才算排空完成并允许卸载；处于
`awaiting_user` 或 `awaiting_job` 的 Run 仍计入该数量。正常退出不为这些 Run 伪造终态，因此长期
等待会延长旧版本保留。若发布或安全策略要求在硬期限前移除旧版本，必须走下述无法排空路径，显式
终止受影响 Run，而不能静默丢弃 checkpoint。

活动 RuntimeCheckpoint 不跨框架迁移，也不编写 checkpoint 转换器。Conversation、消息、
GenerationJob、Asset 和产品事件继续保留；只有框架私有 checkpoint 不能被新 Adapter 解释。
如果安全漏洞或依赖不可用导致旧 Run 无法排空，旧 Run 按既定规则进入安全终态，后续意图在同一
Conversation 中创建关联的新 Run，并从产品事实重建上下文。

已提交的 GenerationJob 不因 Agent Adapter 退出而取消，继续由 Java Generation Worker 独立
执行。切换先灰度到新 Run；失败时只回退新 Run 路由，不改写已有 Run 的引擎身份。

### 7. 升级与扩张必须由证据触发

- Pydantic AI 版本升级只由安全修复、当前版本缺陷、必要供应商兼容性或已批准功能触发；升级后
  作为新的 Adapter 版本，只分配给新 Run。
- 每次升级或替换都必须重新通过暂停恢复、幂等、并发租约、部分成功、事件一致性、错误归一化、
  框架类型不泄漏及退出演练。
- 只有出现明确的静态分支、并行汇合、可视化执行图或图级回放需求，且当前薄循环形成可证明的
  维护问题时，才评估 Pydantic Graph 或 LangGraph。
- 只有生产证据表明 Outbox、租约、Reconciler 和 RuntimeCheckpoint 无法可靠承载长流程，或其
  持续运维成本高于引入新底座时，才评估 DBOS、Temporal 等耐久执行 Module。
- 只有出现大量复杂 Agent 中间件、多 Agent 协作或外部执行需求，并且现有 Adapter 无法在
  `OrchestratorPort` 内合理承载时，才重新评估 AgentScope Core。
- 只有产品进入代码执行、文件系统、沙箱或通用研究 Agent 场景时，才重新评估 DeerFlow 或
  Pydantic AI Harness；普通图片、视频创作不构成触发条件。
- 任何新候选必须通过许可证与制品合规、安全、依赖体积、固定版本、故障隔离、契约矩阵和退出
  演练检查。

社区热度、演示效果、框架自带 UI、减少少量 Adapter 代码或“未来可能需要”均不构成升级理由。

## Considered Options

- 拒绝 DeerFlow 整栈或 Harness 作为首版依赖：它会引入第二套 thread、run、API、存储和恢复语义，
  且已调查版本的安装与 Interface 仍存在成熟度风险。
- 拒绝 AgentScope 平台或 Core 作为首版默认实现：平台会侵入产品事实，Core 的依赖与运行时成本
  高于已通过同一 Spike 的 Pydantic AI Slim；保留备选 Adapter 已足够覆盖退出验证。
- 拒绝首版完全自研 Agent 循环：Pydantic AI Slim 已提供经过 Spike 验证的类型化工具和 deferred
  tool 能力，自研不会带来相称收益；最小自研仍保留为退出路径。
- 拒绝提前采用图编排或耐久执行底座：当前产品状态、Outbox、租约、Reconciler 和 checkpoint
  语义已经独立，不需要第二套工作流权威。

## Consequences

- Python Agent Worker 需要维护产品中性 DTO、Pydantic AI Adapter 和统一契约矩阵；这层转换代码
  是控制框架锁定成本的有意投入。
- 部署必须能够同时保留活动 Run 所需的旧 Adapter 版本，直到排空或按安全策略终止。
- 正常排空可能被长期等待的 Run 延长；运维必须按引擎版本观测非终态 Run 数量，数量归零前不能
  宣称旧 Adapter 已退出。
- RuntimeCheckpoint 只能由匹配的引擎与版本解释；跨框架连续性依赖 Conversation 和产品事实，
  而不是 checkpoint 转换。
- Java Product API 的产品权威、GenerationJob 独立生命周期、持久化事件流、安全与成本边界不因
  Agent 框架升级而变化。
- 当前仓库尚未实施 `OrchestratorPort` 或生产 Adapter；本 ADR 定义后续实现与验收必须满足的 seam，
  不把 Spike 代码视为生产实现。

## 不包含

- `OrchestratorPort` 的传输协议、类、方法、DTO 或部署实现；
- LLM、图片、视频供应商的生产选型与凭据配置；
- 数据库、队列、对象存储或耐久执行产品选型；
- Python Agent Worker、Java Product API、Java Generation Worker 或前端功能开发；
- 活动 checkpoint 的跨引擎迁移。

## 参考资料

- [ADR-0015：Java 产品控制面与双 Worker 运行时分层](0015-java-product-control-plane-python-runtime.md)
- [ADR-0017：产品状态持久化、幂等与恢复模型](0017-product-persistence-idempotency-and-recovery.md)
- [ADR-0018：安全、成本、内容审核与可观测性基线](0018-security-cost-review-audit-observability-baseline.md)
- [DeerFlow 适配性评估](../research/deerflow-fit-evaluation.md)
- [AgentScope 适配性评估](../research/agentscope-fit-evaluation.md)
- [轻量 Agent 编排替代方案](../research/lightweight-agent-orchestration-alternatives.md)
- [图片与视频供应商 API 契约](../research/image-video-provider-api-contracts.md)
- [Pydantic AI Slim 安装说明](https://pydantic.dev/docs/ai/overview/install/)
- [Pydantic AI Deferred Tools](https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/)
- [Pydantic AI v2.9.0](https://github.com/pydantic/pydantic-ai/releases/tag/v2.9.0)
- [验证 AgentRun 暂停恢复与生成任务解耦](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H47)
- [形成开源脚手架采用结论与替换边界](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4E)
