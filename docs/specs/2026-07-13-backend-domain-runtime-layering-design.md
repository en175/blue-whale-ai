# 产品后端领域边界与运行时分层设计

- 状态：已由用户确认
- 日期：2026-07-13
- 代码事实基线：`27aea6e9817d9955386a59717b2442bb69b17ffa`
- Wayfinder 地图：[规划 Agent 创作后端架构与开源脚手架选型](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0G75)
- 当前决策票：[确定产品后端领域边界与运行时分层](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H49)

## 1. 目的与范围

本设计确定 Blue-Whale 首版产品后端的领域边界、运行时分层和依赖方向，使公开产品状态、Agent 编排状态与长耗时生成任务能够独立演进，同时保持唯一产品事实来源。

本票只产出决策，不实施后端功能，也不确定具体 HTTP/SSE 字段、数据库表、队列产品、对象存储产品或部署参数。

## 2. 现状与约束

Wayfinder 地图创建时假设保留 Python + FastAPI 产品 API 外壳。此后远端主线已经合入 Java Spring Cloud 后端，现有 Java 代码包含 Gateway、User、Agent 模块，以及 Project、Canvas、GenerationJob、Asset、图片/视频供应商调用和 MySQL 持久化骨架。

当前缺口集中在 Conversation、AgentRun、RuntimeCheckpoint 和可靠产品事件，而不是重新创建一套产品 API 外壳。因此，继续让 Python 承担公开产品 API 会形成两套产品后端和双重事实权威。

本设计遵循以下既有决策：

- Project 是所有产品对象的归属根，但不是包住所有对象的单一强一致事务聚合。
- AgentRun 可持久化暂停和恢复，并与长耗时 GenerationJob 解耦。
- Blue-Whale 自有 Run、Job、Asset 和产品事件保持权威；Agent 框架 checkpoint 只是不透明运行状态。
- AgentChatPanel 与 BottomDock 共享生成基础设施，但保持两条独立应用路径。
- 单区域、小规模生产起步，不提前拆分超大规模分布式系统。

## 3. 总体决策

采用一个产品控制面和两个执行 Worker：

1. **Java Product API**：唯一公开产品控制面和唯一产品事实来源。
2. **Python Agent Worker**：可替换的 Agent 编排执行器。
3. **Java Generation Worker**：图片/视频 GenerationJob 执行器。

Gateway 与 User 模块沿用当前 Java 工程。Project、Canvas、Conversation、AgentRun、GenerationJob 与 Asset 在 Java 代码内保持独立领域 Module 和一致性边界，但首版不拆成六个网络微服务。

浏览器只访问 Gateway/Java Product API；Python Agent Worker 和 Java Generation Worker 均无面向浏览器的公开产品 Interface。

“独立一致性边界”表示每个聚合拥有自己的生命周期、版本和不变量，不表示应用用例不能在同一产品数据库事务中接纳跨聚合命令。创建消息与 Run、RunCommit 创建 Job、Job 完成并创建 Asset 等入口可以由 Java 应用层原子接纳，但不得把它们收缩为一个共享状态机或建立级联生命周期。

## 4. 领域模型

### 4.1 Project

Project 是产品归属、授权与生命周期范围。Canvas、Conversation、AgentRun、GenerationJob 和 Asset 都必须归属 Project，但高频消息、Run 推进、Job 进度和 Canvas 保存不能共同锁住一个 Project 大聚合。

Project Module 负责：

- Project 身份、所有者和生命周期。
- Project 归属及访问校验。
- 提供其他聚合引用所需的稳定 Project ID。

Project Module 不负责：

- 存放 Canvas 文档内容。
- 直接承载消息、Run 状态、Job 状态或 Asset 内容。
- 级联驱动其他聚合的运行时状态。

### 4.2 Canvas

首版一个 Project 对应一个 Canvas。Canvas 是独立的版本化文档聚合，保存节点、位置、尺寸、层级和视口等画布事实。NodeItem 通过 Asset ID 引用媒体，不保存供应商临时 URL。

### 4.3 Conversation

首版一个 Project 对应一个显式 Conversation。Conversation 是 AgentChatPanel 的持久化有序消息流，一个 Conversation 可先后关联多个 AgentRun。

- 澄清、修改和自然语言授权可以发生在同一个活动 AgentRun 内。
- AgentRun 进入终态后不可重开。
- 后续修订或无关新目标在同一 Conversation 中创建关联的新 AgentRun。
- Conversation 不拥有 GenerationJob、Asset 或 RuntimeCheckpoint。

### 4.4 AgentRun

AgentRun 是围绕一个创作意图持续推进、可暂停恢复的产品运行聚合。Java 产品控制面拥有其生命周期、版本、租约、栅栏、产品阶段和关联关系。

AgentRun 可以：

- 关联多个输入消息和输出消息。
- 提交零个或多个 GenerationJob。
- 记录 Job 的用途或输出槽位，以判断已有结果与缺失结果。
- 在恢复时吸收已经持久化的 Job、Asset 和产品事件事实。

AgentRun 不可以：

- 把每条用户消息都视为新 Run。
- 拥有或级联改写 GenerationJob 的执行生命周期。
- 把 RuntimeCheckpoint 当作产品状态。
- 在终态后原地重开。

### 4.5 GenerationJob

GenerationJob 是一次独立、持久化、可恢复的图片或视频后台任务，必须归属 Project。

- AgentChatPanel 发起的 Job 关联 AgentRun。
- BottomDock 发起的 Job 不关联 AgentRun。
- AgentRun 暂停或进入终态，不级联改写已经提交的 Job。
- 只有单独、明确的取消 Job 命令才尝试取消供应商任务。
- Job 终态不可变；失败重试创建带重试关系的新 Job。
- Job 可以产出一个或多个 Asset。
- 供应商任务 ID、临时 URL、回调签名和供应商错误码不是公开产品语义。

### 4.6 Asset

Asset 是归属于 Project 的持久化媒体身份，可以来自用户上传或生成结果。Card 与 NodeItem 是同一 Asset 的不同视图。

- 产品控制的对象存储持有媒体内容。
- 供应商临时 URL 只用于转存，不成为 Asset 权威地址。
- 媒体内容身份不可变。
- 重生成、编辑、换源或生成衍生版本时创建带来源关系的新 Asset。
- Card 或 NodeItem 显式切换到新 Asset ID。
- 名称、标签、审核状态等业务元数据可变。
- 签名访问 URL 可重新签发，不改变 Asset 身份。

## 5. 运行单元

### 5.1 Java Product API

Java Product API 是唯一公开产品控制面，负责：

- 接受浏览器命令和查询。
- 执行 Project 归属与授权校验。
- 持久化 Conversation 消息、AgentRun、GenerationJob、Asset 和产品事件。
- 接纳 AgentRun 工作结果及 RuntimeCheckpoint。
- 创建持久化待执行工作。
- 从持久化产品事件提供对外状态流。
- 对 Python 和 Generation Worker 暴露窄的内部 Interface。

Java Product API 不负责：

- 执行 LLM、Skill、Tool 或 Agent 框架。
- 在请求线程中等待图片/视频供应商完成。
- 解析具体 Agent 框架的 checkpoint 内容。
- 向公开客户端泄漏供应商状态或 Worker 内部状态。

### 5.2 Python Agent Worker

Python Agent Worker 负责：

- 领取 AgentRun 租约和工作包。
- 执行 LLM、Skill、Tool 及 Agent 编排。
- 理解自身引擎版本对应的 RuntimeCheckpoint。
- 产出 checkpoint、产品命令和运行结果。
- 通过 RunCommit Interface 提交结果。

Python Agent Worker 不负责：

- 提供浏览器可访问的产品 API。
- 直接写产品领域表或维护独立产品事实库。
- 直接调用图片/视频供应商。
- 自行创建权威 GenerationJob 或 Asset。
- 解析其他引擎或其他版本的活动 checkpoint。

LLM、Agent 框架和工具调用 Adapter 属于 Python Agent Worker 内部。

### 5.3 Java Generation Worker

Java Generation Worker 负责：

- 领取持久化 GenerationJob。
- 调用图片/视频 GenerationProvider Adapter。
- 处理供应商轮询、回调、取消和错误映射。
- 把供应商临时媒体转存为产品 Asset。
- 幂等提交 Job 进度、终态、Asset 和产品事件。

Java Generation Worker 不承载浏览器公开业务接口。它可以与 Java Product API 复用同一套领域和应用 Module，但必须使用独立启动入口或运行配置，以便独立部署、扩展和故障隔离。

Generation Worker 必须通过与 Product API 相同的应用 Interface 提交 Job、Asset 和产品事件，不得绕过领域不变量直接改写产品表。

## 6. Interface 与 Seam

以下名称表达职责，不冻结未来方法名、传输协议或字段：

### 6.1 Public Product Interface

浏览器使用的唯一公开 Interface。它只暴露产品术语，不暴露 Python 框架、Worker、供应商任务或存储细节。具体 HTTP 与流式协议由[确定公开 API 与流式事件协议](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4B)决定。

### 6.2 Run Work Interface

Python Agent Worker 通过该 Interface 领取：

- Run ID、Project ID、Conversation ID。
- 当前产品状态与相关消息。
- 已持久化的 Job、Asset 和产品事件事实。
- 租约 owner、栅栏和期望版本。
- 固定引擎及版本的 RuntimeCheckpoint。

### 6.3 RunCommit Interface

Python Agent Worker 通过该 Interface 提交：

- 期望 Run 版本、租约 owner 和栅栏。
- 新的不透明 RuntimeCheckpoint。
- 产品可验证的运行结果。
- 待追加的对话输出。
- 待创建的产品命令，例如创建 GenerationJob。
- 下一产品状态或等待原因。

Java 产品控制面必须先校验租约、栅栏、期望版本和引擎绑定，再按产品语义原子接纳 checkpoint、Run 变化、产品事件及待执行命令。过期 Worker 的提交必须 fail closed。

### 6.4 Generation Work Interface

Java Generation Worker 通过该 Interface 领取 Job 并幂等提交进度、终态和 Asset。具体队列或轮询实现不属于本票。

### 6.5 GenerationProvider Interface

图片/视频供应商 Adapter 实现该 Interface。它负责把供应商请求、任务、回调、状态、错误、取消和临时 URL 映射到产品中性的生成结果。

BottomDock 和 AgentRun 都只能创建 GenerationJob，不能绕过该 Interface 直接调用图片/视频供应商。

### 6.6 Product Event Interface

所有对外进度来自持久化产品事件。Python token、供应商回调或进程内消息只有被 Java 产品控制面接纳并映射为产品事件后，才可以成为客户端可恢复的状态流。

## 7. RuntimeCheckpoint 权威模型

RuntimeCheckpoint 是活动 AgentRun 的版本化不透明执行状态，不是产品事实。

- Java 产品控制面保存 checkpoint 信封、引擎、引擎版本、Run 版本和完整性信息。
- Python Agent Worker 理解 checkpoint payload，但不能让 checkpoint 独立于产品状态向前推进。
- checkpoint 与 RunCommit 的产品状态变化必须具有原子接纳语义。
- Python 在接纳前崩溃，最多丢失尚未接纳的一步。
- Java 接纳后 Python 崩溃，任意兼容 Worker 都能从已保存 checkpoint 恢复。
- 引擎或版本不匹配时拒绝恢复。
- 活动 checkpoint 不跨框架迁移；迁移只能从产品事实重建新的 AgentRun 或新 checkpoint。

checkpoint 最终存数据库还是产品控制的对象存储，由[确定持久化、幂等、重试与恢复模型](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4C)决定；无论选型如何，都不得产生 Python 独立权威库。

## 8. 关键流程

### 8.1 AgentChatPanel 发起创作

1. Browser 向 Java Product API 提交用户消息。
2. Java 接受命令，持久化消息、创建或推进 AgentRun，并建立持久化 Run 工作。
3. Java 立即返回产品标识，不等待 Python 执行完成。
4. Python Agent Worker 领取租约和工作包。
5. Python 推进编排，通过 RunCommit 提交 checkpoint、消息和产品命令。
6. Java 原子接纳结果并追加产品事件。

### 8.2 AgentRun 创建 GenerationJob

1. Python 在 RunCommit 中提出创建 GenerationJob 的产品命令。
2. Java 校验授权门、Run 版本和租约。
3. Java 接纳 Run 等待状态并创建 GenerationJob 及待执行工作。
4. Java Generation Worker 领取 Job 并调用供应商 Adapter。
5. Job 完成后，Worker 转存媒体并提交 Asset、Job 终态和产品事件。
6. AgentRun 下次推进时吸收已经持久化的结果事实。

### 8.3 Run 暂停期间 Job 完成

Job 独立完成并持久化 Asset，不重开或自动推进暂停中的 Run。恢复 Run 时，工作包必须包含新增 Job/Asset/产品事件，使 Python 基于最新产品事实继续。

### 8.4 BottomDock 发起生成

Java Product API 直接创建不关联 AgentRun 的 GenerationJob。后续 Generation Worker、Provider Adapter、Asset 和产品事件路径与 AgentChatPanel 相同。

### 8.5 Worker 崩溃或重复提交

- 未被接纳的 Python 步骤可以重算。
- 已被接纳的提交通过 Run 版本、租约和栅栏拒绝重复或过期写入。
- Generation Worker 通过 Job 版本和幂等键拒绝重复回调、重复 Asset 或终态改写。
- 客户端断线不影响 Worker，恢复连接后从持久化产品事件补读。

## 9. 依赖方向

依赖方向固定为：

```text
Browser
  → Gateway / Java 入口 Adapter
    → Java 应用用例
      → 产品领域 Interface

Python Agent Worker ─┐
Generation Worker ───┼→ 实现或调用产品领域 Interface
数据库 / 队列 ───────┤
供应商 SDK ──────────┘
```

约束：

- 产品领域 Module 不依赖 Python、具体队列、数据库驱动或供应商 SDK。
- Controller 不直接编排供应商或 Worker。
- Python 不依赖 Java 数据库 schema。
- 供应商 Adapter 不向产品 Interface 泄漏供应商 DTO。
- 调用者和测试都通过同一个 Interface 验证行为。

## 10. 对当前 Java 代码的影响

当前代码是实施基线，不是最终领域边界：

- Project、Canvas、GenerationJob、Asset 和部分供应商 Adapter 已存在于 Java Agent 模块。
- Conversation、AgentRun、RuntimeCheckpoint 和持久化产品事件尚未形成完整产品模型。
- `GenerationJobService` 当前同时包含应用编排、供应商调用和持久化职责，后续应按本设计的 Interface 收敛。
- 当前 `@Async` 图片执行、同进程 `JobPoller` 和内存 `JobStreamBus` 无法满足 Worker 独立扩展和断线恢复要求。
- 首版实施应优先建立 Seam，再迁移现有实现；不需要立即把每个领域聚合拆成网络微服务。

本票不执行上述改造。

## 11. 已拒绝方案

### Python + FastAPI 继续作为公开产品 API

拒绝。会与已经合入的 Java 产品后端形成双公开入口和双重产品权威。

### 全部使用 Java，包括 Agent 编排

拒绝。会放弃已验证的 Python 编排框架候选和 checkpoint 适配边界。

### Python 持有独立 checkpoint 数据库

拒绝。Run 与 checkpoint 可能分别成功，形成难以恢复的双重事实来源。

### GenerationJob 作为 AgentRun 内部子状态

拒绝。无法自然支持 BottomDock，也会让 Run 暂停或终止错误地级联到 Job。

### 同一个 Asset ID 原地覆写媒体

拒绝。会破坏 Job 结果追溯、缓存一致性、审计和衍生关系。

### 每个领域聚合立即拆成微服务

拒绝。会提前引入分布式事务、跨服务查询和运维成本。

### Java API、Agent 执行和生成执行都保留在同一进程

拒绝。API 与长耗时任务不能独立扩展或故障隔离。

## 12. 未来验证基线

后续实施至少需要覆盖：

- 同一个 Conversation 中先后存在多个 AgentRun。
- Run 暂停或终止不取消已提交 Job。
- BottomDock Job 不创建 AgentRun。
- Job 部分成功后只为缺失输出创建关联重试 Job。
- 重复供应商通知不重复创建 Asset 或产品事件。
- 过期租约或错误 Run 版本不能提交。
- 错误引擎或版本不能恢复 RuntimeCheckpoint。
- Python 进程退出后可由兼容 Worker 恢复。
- 重生成创建新 Asset，旧 Asset 内容与追溯保持不变。
- 客户端断线后可按产品事件游标补读。

## 13. 明确后置的决策

- HTTP、SSE、事件名称、错误码和游标协议：由[确定公开 API 与流式事件协议](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4B)决定。
- 数据库表、outbox、幂等键、重试、租约和 checkpoint 存储：由[确定持久化、幂等、重试与恢复模型](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4C)决定。
- 安全、成本、审核和可观测性字段：由[确定安全成本审核与可观测性基线](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4D)决定。
- Pydantic AI Slim、AgentScope Core 或最小自研的最终采用与替换边界：由[形成开源脚手架采用结论与替换边界](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4E)决定。
- 整体决策包是否达到实施就绪：由[确认后端架构决策包达到实施就绪](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/requirements/list?issue=IK0H4F)决定。
- 队列、数据库和对象存储的具体产品选型继续保留在地图迷雾中，等待上述语义收敛。

## 14. 完成标准

本设计只有在以下条件同时满足时才算被后续实现遵守：

- Java 是唯一公开产品控制面和唯一产品事实来源。
- Python Agent Worker 不直写产品领域表。
- 图片/视频供应商只由 Java Generation Worker 的 Adapter 调用。
- Run、Job 和 Asset 的独立生命周期不被实现重新耦合。
- 对外状态流来自持久化产品事件，不来自进程内临时总线。
- API、Agent Worker 和 Generation Worker 可以独立部署与扩展。
- 具体基础设施可以替换，而调用者和领域测试不需要理解 Adapter 内部细节。
