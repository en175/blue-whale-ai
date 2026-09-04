# 前后端分离——独立 NestJS Product API 取代模块化单体

- **状态**：Accepted（部分取代 ADR-0068）
- **日期**：2026-08-13
- **决策者**：李小强（经 `grill-with-docs` 会话确认）
- **取代**：ADR-0068 中「不重建独立 Product API、采用模块化单体」的结论；ADR-0068 关于 TypeScript 实现语言、Worker 进程隔离、专用计算边界的内容保持不变

## 背景

ADR-0068（2026-08-09）将产品实现定为「模块化单体 + 进程隔离」，并明确否决「重新建立独立 Fastify / NestJS Product API」。四天后团队决定前后端分离：业务/数据/管理 API 从 Next.js Route Handlers 抽出，落成独立 NestJS 服务；agent 编排能力由其他同事另行抽离，不在本次范围内。

## 决策

新建根目录 `backend/` 独立 NestJS 服务，作为 Product API，承载业务/数据/管理面：

- **迁移域**：auth、account、recharge、usage、admin、projects、canvases、scene-cards、assets、jobs、skills、templates（`blue_whale_web/app/api/**` 中除 agent 编排外的全部 Route Handler 及其 `lib/**` 服务层）。
- **结构参考**：soybean-admin-nestjs 的完整架构与设计模式（module/controller/service/repository 分层、依赖注入、decorator、guard/interceptor/pipe/filter），**不参考其业务域**。
- **数据层**：复用 `@blue-whale/persistence`（Prisma + MySQL），**不引入 TypeORM**——延续 ADR-0069 单一 DB 事实来源。
- **共享包**：复用 `@blue-whale/contracts` 做 DTO 校验、`@blue-whale/core` 共享领域；不依赖 `@blue-whale/agent-runtime`。`@blue-whale/generation-runtime` 已于 2026-09-04 退役并内联为 `backend/libs/shared/generation-runtime/`（见 [ADR-0075](0075-generation-worker-into-nestjs-backend.md)），属 backend 内部库。
- **不迁移**：agent 编排（`/agent/v1/**`、conversation、plan-messages、internal-model、generation 流水线、两个 worker 进程），归属同事的独立抽离任务，原地不动。
- **前端**：`blue_whale_web` 删除业务路由，直连 NestJS；agent 编排路由暂留至同事抽离完成。

## 被否方案

- **维持模块化单体（ADR-0068 原案）**：无法满足前后端独立部署/演进的诉求。
- **引入 TypeORM**：会建立第二套实体与 schema 权威，与 Prisma 双轨，违背 ADR-0069 单一事实来源。
- **把 agent 编排一并迁入 NestJS**：agent 编排与前端 SSE/canvas 强耦合，且已有独立抽离安排。

## 后果

- 新增一个独立部署单元与内部 HTTP 边界；前端经反代/网关访问 NestJS。
- 迁移期间存在过渡态：`blue_whale_web` 内业务路由按域分批删除，NestJS 按域分批接管（strangler）。
- `CLAUDE.md` 红线 #9 需同步修订以反映新架构；规则变更由落地工单经 task worktree 执行（延续 ADR-0070 的规则落位边界），本 ADR 只作权威依据。
