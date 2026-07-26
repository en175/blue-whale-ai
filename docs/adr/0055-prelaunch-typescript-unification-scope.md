# 上线前 TypeScript 技术栈统一的范围边界

本次重构只负责在上线前将目标运行时统一为 TypeScript，并迁移当前核心产品语义与确有保留价值的数据；优先形成可运行、可验证、可一次性切换的最小系统。公开 API major 退役治理、长期证据生命周期、验收系统自证、双人签署、生产级灾备演练、完整容量与告警治理等上线准备工作不作为本次重构前置条件，除非当前核心流程的正确性直接需要；不得为尚未出现的扩展、兼容或治理场景预建机制。

当前环境没有必须保留的真实用户、订单、quota、支付或作品数据；现有研发与测试数据可重建，不作为迁移对象。Node 系统使用新的基线 Schema、必要种子数据和核心语义测试完成接管，不执行旧库原地迁移、历史数据全量对账、RPO=0 配对恢复或旧运行时在途状态清理。

仓库中尚未落地的 `blue-whale-pay`、Node Payment Gateway、微信/支付宝渠道接入、Go `ConfirmTopUp` 改造及 `payment-control` 合同不属于本次重构；它们是未来支付功能，不是现有技术栈迁移。此次保持 Go 支付代码不动，待产品真正进入支付建设阶段后另行设计和实施。

目标架构采用模块化单体与多进程入口：保留 Next.js `web`，Node 后端提供 `product-api`、`agent-worker` 和 `generation-worker` 三个启动入口，但三者属于同一代码库并共享领域、应用与持久化实现。仅在长任务执行和故障隔离确有需要时分进程，不把进程边界扩张为独立服务治理；不建设 12 模块 Owner Registry、全局模块锁顺序、内部服务 HMAC、四套独立契约族或滚动版本兼容矩阵。

核心语义恢复只覆盖三类实际场景：页面刷新或服务重启后已接纳的消息与任务不丢失；重复请求或回调不产生重复结果；Worker 崩溃后任务可重新领取且旧 Worker 不能覆盖新结果。为此保留短数据库事务、稳定幂等键和简单 lease/fence；不建设 InvocationLedger、AttemptPermit、多层 Reconciler、多种期限、迟到证据收敛或 24 小时审核恢复。外部调用结果无法确认时，任务明确失败并允许用户人工重试，不自动扩张为完整核对系统。

## 历史决策处置

- **继续有效**：Project、Conversation、AgentRun、GenerationJob、Asset、Canvas 等核心产品对象，以及服务端消息顺序、持久任务、幂等和简单 lease/fence。
- **缩减后使用**：框架、队列、Agent/Generation Worker、共享 TypeScript DTO/Schema 与浏览器接口研究；只采用实现核心流程所需部分。
- **从活跃上下文剔除**：InvocationLedger、AttemptPermit、多层 WorkItem/Reconciler、多期限与迟到证据、精确 public-api v1 治理、验收证据平台、版本组合/退役治理、旧库迁移与全量对账。
- **未来独立工作**：支付渠道、Go ConfirmTopUp、生产容量/告警/灾备、长期证据生命周期和公开 API 生命周期治理；历史 ADR/研究保留用于追溯，但不得作为 IK3UUX 阻塞项。

## Wayfinder 工作流边界

IK3UWN 只负责形成实施级总体方案与依赖顺序，是本次 Wayfinder 的终点。用户确认后，再对 IK3UWN 使用 `to-spec` 创建独立实施主 Issue；只有该 Spec Issue 才能使用 `to-tickets` 拆分实施切片。IK3UUX 与 IK3UWN 不直接进入 `to-tickets`。

完成标准仅为：全新数据库可一键初始化并启动；Web、Agent 对话、图片/视频生成及 Asset/Canvas 核心流程可用；刷新或重启、重复请求、Worker 崩溃三类测试通过；严格 TypeScript 构建、类型检查与核心测试通过；核心流程不再依赖 Java/Python 运行时。对 IK3UUX 重构而言，本 ADR 与既有目标架构文档或票据冲突时以本 ADR 为准；旧设计可以保留为参考或未来上线准备输入，但不得自动成为本次实施的前置条件或验收门槛。
