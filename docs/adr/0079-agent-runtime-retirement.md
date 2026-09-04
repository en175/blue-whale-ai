# ADR-0079：退役 packages/agent-runtime——唯二生产消费者函数迁入 backend 后删除整包

- **状态**：Accepted
- **日期**：2026-09-03
- **决策者**：李小强
- **关联工单**：IKD1T2
- **上游决策**：[mastra-agent-service-decision-log](../specs/2026-08-11-mastra-agent-service-decision-log.md)（第 1、2、4 条）、[ADR-0059](0059-business-api-into-nextjs-route-handlers.md)、[ADR-0051](0051-node-generation-worker-execution-and-recovery-boundary.md)、[ADR-0068](0068-node-typescript-product-runtime-and-specialized-compute-boundary.md)

## 背景

`docs/specs/2026-08-11-mastra-agent-service-decision-log.md:15` 已裁决 `packages/agent-runtime`「整体退役并删除，不继续作为新运行基础」：Agent 运行能力迁往独立 Mastra 服务（sibling 仓库 `blue-whale-agent`）。该决策落地前，全仓引用追踪（IKD1T2）确认现状：

- **backend 实际只消费 2 个函数**：`createControlledChatClient`（`backend/libs/shared/skills/skill-format.ts`，技能 AI 格式化链路）与 `resolveAgentAsset` + `agentAssetResolveRequestSchema`（`backend/apps/blue-whale/src/api/agent-assets/internal-agent-assets.controller.ts`，独立 agent 服务读素材的回调端点）。
- **包内其余导出无任何生产消费者**：`createFakeAgentAdapter` / `createNewApiAgentAdapter` / `skill-summarize` 全家 / `runtime-manifest` / `read-asset-tool` / `write-plan-cards-tool` 仅被包内自引用或测试引用，属死代码。
- **agent 运行时契约不在此包**：`AgentRun` / `AgentRunPin` / `RunCommit` / `RunPin` / `MentionInputSnapshot` / `agentRuntimeManifest` 等核心 schema 与类型已住在 `packages/contracts/src/agent-runtime.ts`（约 400 行），被 `packages/persistence` 生产消费（`agent-run-pin.ts`、`skill-repo-internals.ts:262`、`capability-digest.ts`、`scene-card-generation-repo.ts`）。删 `packages/agent-runtime` **不触碰**这些——它们不在删除范围，是另一实体。
- **方向与 ADR-0074 一致**：[ADR-0074](0074-frontend-backend-separation-nestjs-product-api.md):19 曾规定 backend「**不依赖** `@blue-whale/agent-runtime` / `@blue-whale/generation-runtime`」。generation-runtime 的既有违背已由 2026-09-04 迁移消除（整包内联为 `backend/libs/shared/generation-runtime/`，见 [ADR-0075](0075-generation-worker-into-nestjs-backend.md)）；剩余 agent-runtime 的既有违背（`skill-format.ts` 与 `internal-agent-assets.controller.ts`）由本次迁移把这两个消费者内联进 backend 一并消除，使 backend 回到 ADR-0074 定义的边界。

## 决策

1. **退役并删除 `packages/agent-runtime/` 整树**（19 个文件）。
2. **仅两个生产消费者函数迁入 backend**：
   - `controlled-chat-client.ts`（约 66 行，纯 `fetch` 封装，无 zod 依赖）→ `backend/libs/shared/skills/`
   - `agent-asset-resolver.ts`（约 130 行，用 zod）→ `backend/libs/shared/assets/`
   - 各自测试随迁；`backend/package.json` 增加 `zod@4.4.3`（与 contracts/core 对齐；backend 当前无 zod 依赖）。
3. **无消费者导出直接删除，不搬运**（`skill-summarize`、fake/real adapter、`runtime-manifest`、read/write-plan-cards-tool 及其测试随包删除）。
4. **保留 `packages/contracts/src/agent-runtime.ts` 与 `packages/persistence` 的 agent 运行时契约及表**，本次不动。

## Supersede 清单

决策日志 :428 要求退役旧 Worker 实现必须显式 Supersede 对应条款；:15 的退役清单把 `apps/agent-worker`、`packages/agent-runtime`、`apps/generation-worker` 捆在一起。本 ADR 只处置其中仍存在的 `packages/agent-runtime`（`apps/agent-worker` 已不存在，`generation-worker` 已迁入 `backend/apps/generation-worker` 并由 ADR-0075 管辖），逐条对齐：

| 现有 ADR 条款 | 被取代范围 | 本次处置 |
| --- | --- | --- |
| ADR-0059「`agent-worker` 与 `generation-worker` 保持独立 Node 进程，共享 `packages/core` + `packages/persistence`」 | 仅 `packages/agent-runtime` 作为 Agent 运行模块的角色；进程保留决定**不**取代 | 该包退役删除；生产函数内联进 backend。`apps/agent-worker` 本仓已不存在 |
| ADR-0068「模块化单体 + 进程隔离：Next.js、`agent-worker`、`generation-worker` 共享同一套领域模块、契约与持久化实现」 | 仅把 `packages/agent-runtime` 列为共享领域模块的部分 | 其余领域模块、契约与持久化实现照旧 |
| ADR-0051「Node Generation Worker 单步执行…共享领域模块」 | 无（不取代） | generation-worker 执行边界仍由 ADR-0051 管辖，本次不触碰 |

未 supersede 的部分（ADR-0059 的 worker 进程保留决定、ADR-0051 的 generation worker 执行边界、ADR-0068 的进程隔离）继续有效。

## Agent 运行时概念去留（决策日志 :430 逐项说明）

决策日志要求明确：自研 Agent 执行退役后，哪些概念删除、哪些映射到 Mastra Workflow、哪些仅保留为历史数据。

| 概念 | 现状位置 | 去留 |
| --- | --- | --- |
| `AgentRun` / `AgentAdvance` / `RunCommit` / RunPin / Lease | `packages/contracts/src/agent-runtime.ts` + `packages/persistence`（`agent-run-pin.ts`、`skill-repo-internals.ts`） | **保留为契约与历史数据**。独立 Mastra 服务已接管新 Agent 执行（AgentSession/AgentRun 权威在独立仓库），本仓保留的 schema 供历史会话读回、向后兼容与账本对账。映射到 Mastra Workflow 的工作在独立仓库侧，不由本 ADR 管辖 |
| `RuntimeManifest` / 自研 Agent 编排（fake/real adapter、skill-summarize、plan-cards 工具） | `packages/agent-runtime` | **删除**。无生产消费者，Mastra 接管后不再需要自研编排实现 |
| `MentionInputSnapshot` / 素材读取授权 | `packages/contracts` + `internal-agent-assets` 端点 | **保留**。独立 agent 服务仍靠该端点读素材（`BLUE_WHALE_ASSET_SERVICE_BASE_URL`）；授权语义演进（决策日志 :437 待迁移的 SessionAssetGrant）后续单独 ADR 处理 |

## 后果

- `packages/agent-runtime` 从 workspace 消失：`backend/tsconfig.json` 的 project reference 与 `backend/package.json` 的 workspace 依赖同步删除，`pnpm-lock.yaml` 清理。
- 两个函数迁移后行为不变：`POST /api/internal/agent-assets/resolve`（agent 服务读素材）与 `POST /api/agent/skills/personal/format`（技能 AI 格式化）路由、入参、返回均不变。
- 风险点：`internal-agent-assets` 端点由独立 `blue-whale-agent` 项目调用，迁移需**两仓联调验证**（agent 仓的 `BLUE_WHALE_ASSET_SERVICE_BASE_URL` 指向本 backend 时该端点必须可用）。

## 被否方案

- **整个 `packages/agent-runtime` 连同契约一起删**：`packages/contracts` / `packages/persistence` 的 agent 运行时契约仍被生产消费，删了会同时破坏历史会话读回与素材授权端点。
- **把 contracts/persistence 的 agent 契约也迁入 backend**：契约与持久化是共享包，backend 是消费方；搬入 backend 反而破坏「单一事实源」（与 ADR-0075 被否方案同理）。
