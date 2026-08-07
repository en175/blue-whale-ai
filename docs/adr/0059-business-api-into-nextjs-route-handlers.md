# ADR-0059：业务 API 折进 Next.js Route Handlers，退役独立 product-api 进程与 Java/Python 核心链路

- **状态**：Accepted
- **日期**：2026-07-27
- **决策者**：朱建业（trueBurger）
- **关联工单**：[IK4AJJ 上线前统一核心运行时至 TypeScript 模块化单体](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK4AJJ)
- **上游决策**：[ADR-0055 上线前 TypeScript 统一范围](0055-prelaunch-typescript-unification-scope.md)、[ADR-0054 public-api v1 浏览器合同](0054-public-api-v1-browser-product-contract.md)（细节已 Superseded）
- **取代**：ADR-0055 中「Node 后端提供 product-api、agent-worker、generation-worker 三个独立启动入口」里**业务 API（product-api）作为独立进程**的部分。

## 背景

IK4AJJ 与 ADR-0055 原定目标架构为三个独立 Node 入口：Fastify `product-api` + `agent-worker` + `generation-worker`，三者共享 `packages/core` + `packages/persistence`。切片 0（IK4AK6）已按此起骨架：`apps/product-api` 是一个仅挂 `/ready` 的 Fastify 桩。

上线前为简化运行拓扑、加快「优先跑通」，决定把浏览器可见的业务 API 折进 Next.js Route Handlers，退役独立 product-api 进程；同时落实 IK4AJJ 的 Java/Python 退役。

## 决策

1. **业务 API 由 Next.js Route Handlers 承载**。浏览器可见的 HTTP 查询、命令与（后续）SSE 路由落在 `blue_whale_web/app/api/**`，路由本身只是薄适配器，调用 `packages/core` 的应用用例与 `packages/persistence`（Prisma）。**产品事实的唯一权威性不因进程合并而丧失**——权威来自共享 `packages` 的领域规则，而非哪个进程持有它。
2. **退役 `apps/product-api`（Fastify 桩，删除）、Java `blue_whale_server`、Python `blue_whale_agent_worker`**。
3. **`agent-worker` 与 `generation-worker` 保持独立 Node 进程**。两者是 lease-based 长循环，不能塞进 Next.js 请求生命周期。
4. **接口走最小信封**（见 ADR-0060 与后续 OpenSpec）：沿用 Java `Result<T>` 的 `{ code, msg, data }` + `PageVo` 分页。不采纳 ADR-0054 的 `application/problem+json` / JCS 摘要 / `Idempotency-Key: cmd_...` / 强 ETag 机器等冻结细节——这部分已被 ADR-0055 Superseded，本次只定义够用的最小接口。

## 连锁影响

- `apps/product-api/` 删除；`apps/` 只保留 `agent-worker` 与 `generation-worker`。
- 隔离黑盒验收 seam 调整：业务 API 的 `/ready` 由 Next.js 提供，不再有独立 product-api 进程可重启（重启 Next.js 即重启业务 API，仍能证明「重启不丢事实」）。
- `blue_whale_web` 进入「既是 Web 又是 Product API」的角色，新增对 `packages/core` + `packages/persistence` 的依赖；`next.config.ts` 的 `/api/* → gateway` 反向代理规则退役。
- 前端 `lib/api-client.ts` 的 `apiRequest`（硬编码 `code !== 200 抛错`）继续可用：Node 路由原样吐 `{code,msg,data}`。

## 被否方案

- **保留 Fastify product-api 独立进程（ADR-0055 / IK4AJJ 原方案）**。拒绝理由：上线前多一个进程增加本地启动、调试与部署成本，Web↔API 之间多一层内部 HTTP/CORS；Web 与 API 的强耦合在 pre-launch 阶段可接受，换取更短「跑通」路径。
- **Next.js 重写一套领域 DTO / 业务逻辑（成为领域 BFF）**。拒绝理由：仍复用共享 `packages/core` + `packages/persistence`，不重造第二套领域规则；Next.js 路由只做 HTTP 适配。

## 取代说明

- ADR-0055「product-api 作为三个独立 Node 入口之一」→ 业务 API 改由 Next.js 承载（`agent-worker` / `generation-worker` 仍为独立 Node 入口，不受影响）。
- ADR-0054 §1「Next.js Route Handler 为同源透明代理，不承载领域认证/授权/幂等/状态机」→ 在本范围内不再适用。Next.js 直接承载业务权威，但权威与领域规则仍集中在共享 `packages`，而非 Next.js 自造第二套。产品事实「单一权威」原则保留。
