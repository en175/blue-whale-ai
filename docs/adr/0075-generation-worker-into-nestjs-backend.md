# generation-worker 迁入 NestJS 后端——队列传输抽象为可替换端口

- **状态**：Accepted
- **日期**：2026-08-17
- **决策者**：李小强（经 `grill-with-docs` 会话确认）
- **关联工单**：IK952T
- **上游决策**：ADR-0074（前后端分离 NestJS Product API）

## 背景

ADR-0074 将业务/数据/管理 API 迁入独立 NestJS `backend/`，但 generation-worker（视频生成消费者进程）仍留在 `blue_whale_web`，以 esbuild 打包的独立 Node 进程运行，消费 BullMQ `generation-video` 队列。视频生成流水线因此被进程切成两段：producer（web Route Handler 建 job + 投队列）与 consumer（worker 出片），共用一份 `video-queue.ts`。

## 决策

把 generation-worker 迁入 `backend/`，并连同 producer 端一并迁入，形成完整视频生成流水线：

- **进程形态**：新建独立 NestJS app `backend/apps/generation-worker/`，与 `apps/blue-whale`（HTTP API）平级，保持 ADR-0068「进程隔离」。
- **producer 端**：`generation-jobs`(create/cancel/retry) 与 `scene-cards/generate` 端点迁入 `apps/blue-whale`。
- **队列抽象**：`@nestjs/bullmq` 消费；producer 侧定义 `VideoQueueProducer` 端口（`enqueue(jobId, delayMs?)`），BullMQ 为当前适配器。后续同事换 RocketMQ 时替换适配器，consumer 侧消费注册在 worker app 内局部重写。
- **核心逻辑**：`runVideoJobStep`、`createNewApiVideoTaskProvider`、`createTosVideoMediaRelay` 等保留在 `@blue-whale/generation-runtime` 共享包，worker 只作进程外壳。
- **健康/恢复**：`@nestjs/terminus`（`/ready`）+ `@nestjs/schedule`（`@Interval` 恢复扫描）。
- **构建**：与主 app 同构的 `tsc -b` + `tsc-alias`，`Dockerfile.worker` 相应调整。

## 被否方案

- **worker 作为 `apps/blue-whale` 内的 module**：HTTP 请求面与出片长任务同进程，违背进程隔离与独立扩缩容。
- **producer/consumer 统一队列端口**：BullMQ 与 RocketMQ 消费模型差异大（push vs tag/group 拉取），强统一会造别扭接口、过早抽象。
- **被否方案：核心逻辑搬进 backend**：generation-runtime 已是共享包，重复搬入破坏单一事实源。

> **2026-09-04 更新（生成运行时迁移 backend）**：本条被否方案已被**部分推翻**。2026-09-04 起 `packages/generation-runtime` 整包退役（18 文件 `git mv`），核心逻辑（`runVideoJobStep` / `createNewApiVideoTaskProvider` / `createTosVideoMediaRelay` / media-extract-runner 等）连同测试内联进 `backend/libs/shared/generation-runtime/`（平铺，无 src/ 嵌套），8 个消费者 import 改为 `@lib/shared/generation-runtime/index.js`。generation-runtime 不再作为共享 workspace 包存在；「单一事实源」原则保留给仍在 `packages/` 的 contracts/core/persistence（见 ADR-0074 共享包边界）。

## 后果

- 新增第二个 NestJS app（`apps/generation-worker`），构建/部署复用主 app 的 tsc 流程。
- producer 端从 `blue_whale_web` 迁走后，web 的对应 Route Handler 需删除。
- 队列传输（BullMQ→RocketMQ）的演进被端口抽象约束：producer 侧零改动、consumer 侧局部重写。
