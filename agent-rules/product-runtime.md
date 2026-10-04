# 产品技术栈与工程工具边界

产品技术选型、运行时例外或 Python 工具处置前读取本文。本文件承接 CLAUDE.md 的技术栈细则，架构理由与各例外的约束见下列 ADR。

## 产品实现

直接交付用户能力的产品实现采用以下边界：

- Web UI 使用 Next.js App Router。
- 浏览器业务 API 由独立 NestJS `backend/` 承载，见 [ADR-0074](../docs/adr/0074-frontend-backend-separation-nestjs-product-api.md)。该决策取代 ADR-0068 中由 Next.js 承载业务 API、保持模块化单体的条款。
- 已批准的两个 Java 运行时例外是 generation 执行服务 `server/blue-whale-worker/` 和计费服务 `server/blue-whale-billing/`。分别遵循 [ADR-0084](../docs/adr/0084-generation-worker-java-runtime.md) 与 [ADR-0114](../docs/adr/0114-new-api-as-upstream-identity-and-billing-services.md)，两者均受防漂移约束。worker 是批准新建的服务，不是已退役 `blue_whale_server` 的恢复。
- 其余服务端与 Worker 使用 Node.js LTS；共享领域、契约与持久化位于跨语言 `contracts/` 与 TypeScript packages。

除上述两个 Java 例外外，禁止新增 Java/Python 产品运行时，禁止恢复已退役的 `blue_whale_server`、`blue_whale_agent_worker`。专用计算组件按 [ADR-0068](../docs/adr/0068-node-typescript-product-runtime-and-specialized-compute-boundary.md) 判断，不引入第二套领域规则、Product API 或产品事实权威。

已迁出独立仓库的 `blue_whale_api`、`blue_whale_pay_web`、`blue_whale_pay_server` 不在本仓维护。

## 工程工具

Hook、Worktree、Git/PR/发布、Agent 授权与审计等工程协作控制面，以及产品测试、构建、数据库维护等长期工具和一次性脚本，不因产品采用 TypeScript 而必须改写。

无关 Python 存量默认不阻塞普通功能工单，也不自动形成迁移任务。分类、修改触发条件与验收方式按 [ADR-0070](../docs/adr/0070-product-runtime-stack-does-not-govern-engineering-control-plane.md) 和 [Python 存量处置清单](../docs/specs/2026-08-09-ik7fi6-python-inventory-disposition.md) 执行。
