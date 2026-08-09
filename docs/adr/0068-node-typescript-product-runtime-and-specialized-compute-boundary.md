# 产品主技术栈统一为 Node.js / TypeScript，专用计算保留独立边界

- **状态**：Accepted
- **日期**：2026-08-09
- **决策者**：KimJohn（经 `grill-with-docs` 会话确认）
- **关联工单**：[IK7FI6 统一技术栈规则与 Python 存量处置决策](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK7FI6)
- **上游决策**：[ADR-0055 上线前 TypeScript 技术栈统一的范围边界](0055-prelaunch-typescript-unification-scope.md)、[ADR-0059 业务 API 折进 Next.js Route Handlers](0059-business-api-into-nextjs-route-handlers.md)

Blue-Whale 的 Web、Product API、领域应用层与编排 Worker 统一使用 Node.js / TypeScript：浏览器业务 API 由 Next.js Route Handlers 承载，长任务由独立 Node Worker 执行，领域规则、契约与持久化实现通过共享 packages 复用。这一选择匹配当前以数据库、队列、对象存储和模型供应商调用为主的 I/O 密集负载，也减少跨进程契约漂移与上线前部署复杂度。

主运行时采用**模块化单体 + 进程隔离**：Next.js、`agent-worker` 与 `generation-worker` 是可独立运行的进程入口，但共享同一套领域模块、契约与持久化实现。当前不把进程边界升级为独立 Product API 服务或按领域拆分的微服务边界；只有独立扩缩容、故障隔离或团队自治需求被实际指标证明后，才重新评估服务拆分。

本决策不要求所有未来计算都使用 Node.js。若出现本地模型推理、训练、重度数据处理、持续 CPU 密集媒体计算，或只有其他语言具备成熟关键能力的场景，可以通过边界清晰的独立组件采用其他运行时；它不得把第二套领域规则、Product API 或产品事实权威带回主运行时。

## 被否方案

- **现在恢复 Python / FastAPI 或引入 Go 作为并行业务后端**：当前负载与团队阶段没有证明多语言服务拓扑的额外成本合理。
- **重新建立独立 Fastify / NestJS Product API**：会恢复额外内部 HTTP 边界、本地进程与部署单元，当前没有对应收益。
- **按 Project、Conversation、Generation、Asset 拆分领域微服务**：会提前引入分布式事务、网络故障、契约版本与服务治理成本，尚无独立扩缩容或团队自治证据支持。
- **全仓所有计算永久只允许 Node.js / TypeScript**：会把产品主栈决策扩张为与实际能力无关的语言禁令，并阻碍未来专用计算采用更合适的运行时。
