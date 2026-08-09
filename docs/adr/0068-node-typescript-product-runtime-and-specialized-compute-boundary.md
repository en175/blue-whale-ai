# 产品实现采用 TypeScript，Next.js Web 与 Node.js Workers 组成主运行时

- **状态**：Accepted
- **日期**：2026-08-09
- **决策者**：KimJohn（经 `grill-with-docs` 会话确认）
- **关联工单**：[IK7FI6 统一技术栈规则与 Python 存量处置决策](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK7FI6)
- **上游决策**：[ADR-0055 上线前 TypeScript 技术栈统一的范围边界](0055-prelaunch-typescript-unification-scope.md)、[ADR-0059 业务 API 折进 Next.js Route Handlers](0059-business-api-into-nextjs-route-handlers.md)

Blue-Whale 的产品实现语言统一为 TypeScript，但不把语言、框架和运行时混为同一层：Web UI 与浏览器业务 API 由 Next.js App Router / Route Handlers 承载，客户端 JavaScript 在浏览器运行；服务端 Next.js 与 `agent-worker`、`generation-worker` 使用仓库声明的受支持 Node.js LTS；领域规则、契约与持久化实现通过 TypeScript workspace packages 复用。TypeScript 在编译后擦除类型，实际运行的是 JavaScript，因此本 ADR 不使用“TypeScript 运行时”这一不准确表述。

这一组合匹配当前以数据库、队列、对象存储和模型供应商调用为主的 I/O 密集负载，也减少浏览器、业务 API、Worker 与共享模块之间的契约漂移。Next.js 是产品架构边界，不只是普通依赖：独立 `product-api` 已退役，浏览器业务 API 不在本仓重新拆成 Express、Fastify 或 NestJS 服务。

主运行时采用**模块化单体 + 进程隔离**：Next.js、`agent-worker` 与 `generation-worker` 是可独立运行的进程入口，但共享同一套领域模块、契约与持久化实现。当前不把进程边界升级为独立 Product API 服务或按领域拆分的微服务边界；只有独立扩缩容、故障隔离或团队自治需求被实际指标证明后，才重新评估服务拆分。

本决策只约束产品实现，不约束 Hook、Worktree、Git/PR/发布、Agent 授权与审计等工程协作控制面。产品测试、构建脚本、数据库维护工具可以优先沿用 TypeScript 生态，但不受全仓语言禁令。若出现本地模型推理、训练、重度数据处理、持续 CPU 密集媒体计算，或只有其他语言具备成熟关键能力的场景，可以通过边界清晰的独立组件采用其他运行时；它不得把第二套领域规则、Product API 或产品事实权威带回主运行时。

精确 Node.js、TypeScript、Next.js 与 React 版本由 `package.json` 和锁文件维护；本 ADR 冻结分层职责，不冻结补丁版本。

## 依据

- [TypeScript 官方：类型在编译后擦除，运行时行为仍是 JavaScript](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch.html)
- [Node.js 官方发布策略：生产应用使用 Active LTS 或 Maintenance LTS](https://nodejs.org/en/about/previous-releases)
- [Next.js App Router](https://nextjs.org/docs/app) 与 [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)

## 被否方案

- **现在恢复 Python / FastAPI 或引入 Go 作为并行业务后端**：当前负载与团队阶段没有证明多语言服务拓扑的额外成本合理。
- **重新建立独立 Fastify / NestJS Product API**：会恢复额外内部 HTTP 边界、本地进程与部署单元，当前没有对应收益。
- **按 Project、Conversation、Generation、Asset 拆分领域微服务**：会提前引入分布式事务、网络故障、契约版本与服务治理成本，尚无独立扩缩容或团队自治证据支持。
- **全仓所有计算永久只允许 Node.js / TypeScript**：会把产品主栈决策扩张为与实际能力无关的语言禁令，并阻碍未来专用计算采用更合适的运行时。
- **把 Hook、Worktree 与发布脚本纳入产品技术栈统一**：这些资产服务团队协作而不是最终用户，语言改写不改变产品架构，却会增加安全兜底失效风险。
