# DeerFlow 对 Blue-Whale Agent 创作后端的适配性评估

> 调研问题：DeerFlow 是否适合作为 Blue-Whale Agent 创作后端基础。
> 本文只做架构与脚手架选型，不实施集成。
> 触发工单：[评估 DeerFlow 对本项目的适配性](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7L)。

## 结论（TL;DR）

**拒绝 DeerFlow 整栈接管 Blue-Whale 后端。**
DeerFlow Harness 在技能、工具、沙箱、Guardrail、流式事件和执行恢复上有复用价值；
但它的 Gateway、thread、run 和 checkpointer 不等价于 Blue-Whale 已确定的
Project、AgentRun、GenerationJob、Asset 与 GenerationAuthorizationGate。

推荐路线：

1. Blue-Whale 的产品数据库、对外 API、AgentRun、GenerationJob 和授权语义继续权威；
2. DeerFlow Harness 仅作为**固定版本、置于抗腐层后的受限 Spike 候选**；
3. Spike 只验证执行内核，不接管 Gateway、前端、产品状态机或产品持久化；
4. Spike 未达到本文门槛时，退回“仅借鉴设计”，不继续适配。

这不是否定 DeerFlow 的工程价值，而是拒绝让通用 Agent Harness
反向定义 Blue-Whale 的产品语义。

## 1. 评估基线

### 1.1 DeerFlow 版本与许可

- 评估的 `main` 固定到
  [`2bd0f56a0f5a418d126cb4a18e23001f54ccf024`](https://github.com/bytedance/deer-flow/commit/2bd0f56a0f5a418d126cb4a18e23001f54ccf024)，
  不把浮动分支当成稳定依赖。
- [`v2.0.0`](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)
  对应 tag 提交 `7e7f041`，发布于 2026-06-25。
- 项目采用 [MIT License](https://github.com/bytedance/deer-flow/blob/2bd0f56a0f5a418d126cb4a18e23001f54ccf024/LICENSE)，
  许可本身不阻碍内部使用和修改，但不能替代成熟度、API 与部署风险评估。

### 1.2 Blue-Whale 产品基线

- [盘点现有前端契约与后端骨架基线](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7J)
  已界定前端契约与后端落点，本评估不重造产品 API。
- [明确首版 Agent 创作行为状态机](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7K)
  已确定 AgentRun、GenerationJob、授权、暂停恢复、部分成功与终态语义。
- 仓库 [CONTEXT.md](../../CONTEXT.md) 定义 Project、Asset、GenerationJob、
  GenerationAuthorizationGate 和 Card/NodeItem 映射。
- 候选框架必须适配这些决策，不能覆盖这些决策。

### 1.3 范围

本次不实现 DeerFlow，不选择正式部署拓扑，不替换前端，不迁移产品数据库，
也不把 DeerFlow 示例应用的体验自动视为 Blue-Whale 产品需求。

## 2. DeerFlow 能力画像

### 2.1 Harness / App 分层

DeerFlow 将执行 Harness 与 App/Gateway 分开；Harness 承载 Agent 执行能力，
App/Gateway 承载对外服务和应用集成。该分层可从固定版本的
[后端分层说明](https://github.com/bytedance/deer-flow/blob/2bd0f56a0f5a418d126cb4a18e23001f54ccf024/backend/CLAUDE.md)
与 [Harness / App 官方说明](https://deerflow.tech/en/docs/introduction/harness-vs-app)核对。

这意味着 Blue-Whale 理论上可以只评估 Harness，并保留自有 API、事件和数据库。
但源码分层不自动等于稳定公共接口；若内部入口或事件随 `main` 漂移，
仍需由固定版本和抗腐层吸收成本。

### 2.2 技能、工具、沙箱与 Guardrail

固定提交包含技能、工具、沙箱和 Guardrail 扩展点，见固定版本的
[Harness 源码](https://github.com/bytedance/deer-flow/tree/2bd0f56a0f5a418d126cb4a18e23001f54ccf024/backend/packages/harness/deerflow)
以及官方的[定制扩展说明](https://deerflow.tech/en/docs/harness/customization)。

这些能力与 Blue-Whale 的执行内核需求有交集：

- 按技能组织 Agent 能力；
- 通过工具封装确定性动作；
- 用沙箱约束文件、命令或代码执行；
- 在工具调用前后插入 Guardrail；
- 将长耗时执行转为事件流；
- 将执行上下文与产品对象解耦。

它们主要回答“怎么执行”，不回答“为何执行、何时获准、结果归谁”，
所以适合作为内核候选，不适合作为产品模型来源。

### 2.3 Gateway、运行恢复与 SSE replay

DeerFlow Gateway 提供 thread、run、checkpointer 与 SSE replay 等机制，见
[固定版本后端架构](https://github.com/bytedance/deer-flow/blob/2bd0f56a0f5a418d126cb4a18e23001f54ccf024/backend/docs/ARCHITECTURE.md)
与 [v2.0.0 发布说明](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)。
这说明它已处理长运行、断线恢复、执行持久化和事件重放等同域问题。

但同域不等义：Blue-Whale 的 AgentRun 表示持续创作意图，GenerationJob
表示可重试、可部分成功的生图/生视频后台任务。DeerFlow 的 thread/run/checkpoint
必须映射后才能使用，不能直接替代产品对象。

### 2.4 客户端与文档漂移

固定提交中的 `DeerFlowClient` 是同步的 `stream` / `chat` 使用面；
该 `main` 基线上没有可依赖的 `ainvoke` / `astream`。
应以[固定提交的客户端源码](https://github.com/bytedance/deer-flow/blob/2bd0f56a0f5a418d126cb4a18e23001f54ccf024/backend/packages/harness/deerflow/client.py)
为准，而不是推测异步 API。

官网 [Integration Guide](https://deerflow.tech/en/docs/harness/integration-guide)
却示例 `ainvoke` / `astream`，与固定提交的客户端表面存在漂移。
因此 Spike 必须锁定 SHA，并用真实导入、调用和事件契约测试验证，
不能因官网出现示例就宣布兼容。

### 2.5 包发布状态

官网 [Harness 安装页](https://deerflow.tech/en/docs/harness)说明 `deerflow`
包尚未发布。PyPI 上的 [`deerflow 0.0.1`](https://pypi.org/project/deerflow/)
与 [`deerflow-harness 0.0.1`](https://pypi.org/project/deerflow-harness/)
都自述为 empty placeholder，且项目详情未验证，不能当作字节跳动官方制品。

因此 Spike 应从官方仓库的固定 commit/tag 构建，记录 SHA、传递依赖与构建方式；
不得把上述占位包写入正式依赖。

## 3. 适配点

| 能力 | 适配判断 | 推荐边界 |
|---|---|---|
| 技能装载 | 较高 | 产品选择技能，Harness 只装载已批准技能 |
| 工具调用 | 较高 | 工具注册与授权策略由 Blue-Whale 注入 |
| 沙箱 | 较高 | 只承载执行隔离，不承载产品权限模型 |
| Guardrail | 中高 | 执行期补充，不替代 GenerationAuthorizationGate |
| 流式事件 | 中 | 经抗腐层归一化为内部事件 |
| Checkpoint | 中 | 只作执行快照，不作产品真相源 |
| SSE replay | 中 | 借鉴断线恢复，不暴露 DeerFlow 协议 |
| Gateway / App | 低 | 不进入 Blue-Whale 产品架构 |

可借鉴但不直接继承的设计包括：线程与运行分离、执行快照、事件 replay、
工具注册、沙箱抽象和 Guardrail 链。最终术语和状态仍以
[明确首版 Agent 创作行为状态机](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G7K)
为准。

## 4. 关键缺口

### 4.1 AgentRun

Blue-Whale 的 AgentRun 绑定一个持续创作意图，可跨澄清、修改、授权和恢复；
其稳定生命周期与用户可见阶段分层，并受同 Project 单前台 Run 等约束。
DeerFlow thread/run/checkpointer 没有直接表达这组规则，不能把 DeerFlow run
直接改名为 AgentRun。

### 4.2 GenerationJob 与 Asset

Blue-Whale GenerationJob 需要：

- `queued → processing → succeeded | partially_succeeded | failed`；
- 一次 Job 可产生一个或多个 Asset；
- 部分失败时保留成功 Asset；
- 只重试缺失输出时创建关联的新 Job；
- 冻结 Asset 引用、版本与步骤输入；
- 可恢复错误不直接令 AgentRun 失败。

DeerFlow 没有这套创作产物语义；用通用 run 或 tool call 硬模拟，
会使产品查询、重试、幂等和审计含混。

### 4.3 GenerationAuthorizationGate

Blue-Whale 在创建 GenerationJob 前区分直接执行、clarification、authorization
与 recovery，且用户通过自然语言确认。DeerFlow Guardrail 可拦截执行，
但不能替代产品层授权门。授权必须先在 Blue-Whale 完成，再交给 Harness。

### 4.4 单一持久化权威

若 DeerFlow Checkpointer 与 Blue-Whale 数据库都保存“当前产品状态”，
会形成双真相源：完成、重试、冻结输入、部分成功、事件游标和终态都可能冲突。

正确边界是：Blue-Whale 数据库保存产品事实；DeerFlow checkpoint
只保存可丢弃、可重建或可迁移的执行内部状态。

### 4.5 并发、取消和部署

Gateway 存在多 worker 取消所有权问题与单 worker 部署限制，风险应以
[v2.0.0 发布说明](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)
为准，不能从本地单进程演示推断生产可用。

Blue-Whale 不能依赖进程内任务所有权，也不能把单 worker 当成正式方案；
AgentRun 的协作式暂停与 GenerationJob 的 best-effort 取消必须分离，
后台 Job 即使未取消，也应允许恢复后的 Run 吸收结果。

## 5. 三种方案对比

| 方案 | 模型一致性 | 侵入性 | 退出成本 | 生产风险 | 结论 |
|---|---:|---:|---:|---:|---|
| A. 整栈接管 | 低 | 极高 | 极高 | 高 | 拒绝 |
| B. Harness 局部复用 | 中高 | 中 | 中低 | 可验证 | 条件推荐 |
| C. 仅借鉴设计 | 高 | 低 | 低 | 低 | 保底方案 |

### 5.1 A：整栈接管

直接采用 App、Gateway、thread、run、checkpointer、客户端和前端集成方式。
这会迫使产品状态机映射到通用运行状态，形成双真相源，
并把客户端漂移、多 worker 取消和部署限制带入关键路径。
退出时还需同时迁移 API、数据、事件和执行语义。**拒绝。**

### 5.2 B：Harness 局部复用

Blue-Whale 定义内部 `AgentHarnessPort`，适配器把已授权、已冻结的请求转换为
Harness 输入，再把事件转换为内部事件。

前提是固定版本、类型不出适配器、不采用 Gateway、不让 Checkpointer 成为产品数据库、
不让 DeerFlow 创建 AgentRun/GenerationJob/Asset，也不让 Guardrail 替代授权门。
**仅条件推荐为受限 Spike。**

### 5.3 C：仅借鉴设计

不引入 DeerFlow 运行时，仅借鉴技能、工具、沙箱、Guardrail、checkpoint 和 replay。
其供应链、升级和退出风险最低，代价是自行实现执行编排。
**若 Harness Spike 不通过，立即采用。**

## 6. 侵入与退出边界

允许的侵入面：

- 一个内部 Harness 端口和一个 DeerFlow 适配器；
- DeerFlow 事件到内部事件的显式映射；
- 固定版本构建层、Spike 配置和测试夹具；
- 可选 checkpoint 不透明引用。

禁止的侵入面：

- 对外 API 暴露 DeerFlow 类型；
- 产品表依赖 DeerFlow checkpoint schema；
- 前端直连 DeerFlow Gateway；
- AgentRun id 与 DeerFlow run id 共用身份；
- 从 tool call 状态推导 GenerationJob 生命周期；
- Asset 只存在于 DeerFlow 消息；
- 业务代码直接导入 DeerFlow 内部模块；
- 为适配框架删除授权或部分成功语义。

退出演练必须证明：替换为内存假 Harness 时，不修改产品 API、数据库 schema
和前端契约；AgentRun / GenerationJob 测试仍通过；删除 DeerFlow 依赖后，
除适配器测试外无导入错误。否则说明抗腐层失效。

## 7. 受限 Spike 验收门槛

Spike 只做一条 tracer bullet：
`已授权 AgentRun step → Harness 技能/工具 → 模拟 GenerationJob → 内部事件 → 恢复查询`。

全部满足才允许继续：

1. 固定 SHA 与依赖锁在干净环境中两次构建成功。
2. 除适配器及其测试外，没有 DeerFlow import 或类型泄漏。
3. 同步 `stream/chat` 不阻塞服务事件循环；隔离与背压有测试。
4. Harness 事件均映射为内部类型，未知事件 fail closed 且可观测。
5. 断线后通过“产品快照 + 增量”恢复，不伪造百分比或 ETA。
6. 未通过 GenerationAuthorizationGate 的请求不能进入 Harness。
7. 执行中 Canvas 更新不改变冻结输入。
8. 多输出部分成功保留成功 Asset，缺失输出由新 Job 重试。
9. AgentRun 暂停不误取消 provider Job，恢复后可吸收结果。
10. 产品状态只由 Blue-Whale 数据库决定。
11. 不依赖进程内取消所有权，不把单 worker 当生产方案。
12. 假 Harness 替换成功，产品测试无需修改。
13. 保留 MIT 许可证文本与上游版本归属。
14. 不使用未验证的 `deerflow 0.0.1` 或 `deerflow-harness 0.0.1` 占位包。

任一核心门槛失败，结论降级为“仅借鉴设计”。

## 8. 对下游票据的影响

### 8.1 API 与持久化

下游应继续以 Blue-Whale 对象为中心：Project、AgentRun、GenerationJob、Asset
使用自有 id；DeerFlow id 只作可空 provider metadata；SSE 发布内部事件；
重试、部分成功、终态不可变和授权门由产品服务实现。

### 8.2 暂停、恢复与任务解耦

后续验证应增加：Harness 暂停不等于 provider Job 取消；
恢复同一 AgentRun 时能吸收暂停期间完成的 Job 结果。
DeerFlow Gateway 的取消限制是反例输入，不是产品语义来源。

### 8.3 技能、工具与安全

可用 DeerFlow Harness 作 Spike 对照组，但工具权限和成本策略必须留在 Blue-Whale；
Guardrail 与授权门分开测试；未知工具、未知事件和沙箱逃逸 fail closed；
上游默认技能不自动视为可上线能力。

### 8.4 总选型地图

[规划 Agent 创作后端架构与开源脚手架选型](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G75)
应记录：DeerFlow 不进入整栈短名单；Harness 进入需 Spike 验证的局部组件候选；
仅借鉴设计是明确退路；最终脚手架必须兼容自有 AgentRun、GenerationJob 和授权门；
正式选型不得依赖尚未发布的官方 PyPI 包。

## 9. 最终判断

DeerFlow 对 Blue-Whale 的价值集中在执行内核，而不是产品后端骨架。
技能、工具、沙箱、Guardrail、checkpoint 与 replay 值得用受控 tracer bullet 验证；
Gateway、客户端、包发布和多 worker 约束不足以支撑整栈接管。

> **拒绝整栈接管；Harness 仅作为固定版本、抗腐层后的受限 Spike 候选；**
> **产品 DB/API/AgentRun/GenerationJob/GenerationAuthorizationGate 继续作为唯一权威。**

若 Spike 不能证明接口隔离、状态机独立、恢复可验证和低成本退出，
则不引入 DeerFlow 运行时，仅借鉴其设计。

## 官方证据索引

- [固定 main 提交 `2bd0f56`](https://github.com/bytedance/deer-flow/commit/2bd0f56a0f5a418d126cb4a18e23001f54ccf024)
- [v2.0.0 Release](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)
- [固定版本源码树](https://github.com/bytedance/deer-flow/tree/2bd0f56a0f5a418d126cb4a18e23001f54ccf024)
- [Harness / App 官方说明](https://deerflow.tech/en/docs/introduction/harness-vs-app)
- [Harness Integration Guide](https://deerflow.tech/en/docs/harness/integration-guide)
- [Harness 安装状态](https://deerflow.tech/en/docs/harness)
- [MIT License](https://github.com/bytedance/deer-flow/blob/2bd0f56a0f5a418d126cb4a18e23001f54ccf024/LICENSE)
- [PyPI `deerflow`](https://pypi.org/project/deerflow/)
- [PyPI `deerflow-harness`](https://pypi.org/project/deerflow-harness/)
