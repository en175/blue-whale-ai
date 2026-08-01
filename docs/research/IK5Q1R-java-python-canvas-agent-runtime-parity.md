# IK5Q1R：Java / Python Canvas 与 Agent 运行时退役边界及 Node 能力缺口

> 研究基线：`master@607fadfa7561707f084b12c979d63c0766571539`，2026-08-01。
>
> 本文只盘点仓库现状并给出 keep / retire / gap 结论，不实施迁移，不要求旧库或在途状态兼容。代码发现先使用 Codebase Knowledge Graph 的 architecture / search / trace / snippet，再用仓库文件核对非代码配置、字符串与行号。

## 1. 执行结论

**Java / Python 运行时尚不能直接删除。** Node 已经接管了身份、Conversation 命令、基础 AgentRun lease/fence、整段 Assistant 消息提交、Canvas GET/PUT、Snapshot 与 Project SSE 的一部分核心闭环，但 Agent 仍是 fake-only，显式 Mention 输入被幂等哈希“看见”后丢弃，Canvas 保存不写事件，PlanMessage 尚无产品事实模型，且 TypeScript baseline 的 fresh-schema 验收已经与实际 SQL 静态漂移。

这不是要求把旧 Java / Python Agent 协议逐字段重写。当前权威范围只要求：刷新/重启不丢已接纳事实、重复请求不产生重复结果、Worker 崩溃后可重领且旧 Worker 不能覆盖新结果；复杂 checkpoint、Runtime Bundle 治理、双流尝试、全量读证据与多层恢复不应回流为迁移门槛。[ADR-0055 明确了这条收窄边界](../adr/0055-prelaunch-typescript-unification-scope.md#L1-L24)，[ADR-0059 则明确要求最终删除 Java 与 Python 运行时](../adr/0059-business-api-into-nextjs-route-handlers.md#L14-L28)。

因此，IK5Q1R 应按以下三类处理：

1. **Node 必须保留/补齐的产品语义**：Project 归属、正式消息顺序与幂等、显式 Asset/SceneCard Mention、显式 Creative Skill 选择（若当前入口继续保留）、PlanPhase → 原子 PlanMessage、Canvas 持久化及事件、Snapshot/SSE 恢复、数据库时间 lease/fence、旧 Worker 晚提交拒绝、成功/失败的确定性终态。
2. **应随旧运行时退役的实现**：Java Controller/Service/内部 Agent HTTP，Python CLI/Java gateway/Pydantic orchestrator，Runtime Bundle 的旧发布治理，自动 Creative Skill 选择，claim 时自动读取整个 Canvas，Agent 自动创建 SceneCard/GenerationJob/媒体，以及旧 Docker/Compose/脚本/端口/环境变量。
3. **删除前的阻塞缺口**：真实 Node Agent adapter、结构化显式输入与 PlanMessage 接纳、Canvas 状态+事件同事务、最小失败/取消收场、fresh schema 门禁修复、覆盖核心用户闭环和 crash takeover 的隔离黑盒验收、默认本地/验收拓扑彻底断开 Java/Python。

## 2. 旧运行时实际承担了什么

### 2.1 Java Canvas 是“归属 + 1:1 upsert + 事件”的事实边界

Java 的公开接口是 `GET /api/canvases?projectId=` 与 `PUT /api/canvases/{projectId}`，先用用户身份校验 Project 归属。[`CanvasController`](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/controller/CanvasController.java#L22-L50) 将身份和 Project 边界固定在 Product API；[`CanvasService`](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/CanvasService.java#L29-L63) 在事务中按 `projectId` 整体 upsert `viewport/nodes`，并写 `CANVAS_UPDATED` Project Event。

可退役的是 Spring Controller、MyBatis mapper、`X-User-Id` 内部头和 Java `Result` 实现；必须保留的是 Project 归属、Project 与 Canvas 1:1、刷新后可恢复的整体状态，以及状态和事件不可分裂。

### 2.2 Java + Python Agent 是一个候选结果接纳协议

旧 Java claim 会下发 Run 身份、version/fence、engine 版本、Bundle/ModelProfile/Creative Skill pin、消息、checkpoint、已接纳结果、tool grant、Conversation 摘要和 Canvas 节点。[`RunWorkResponse`](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/model/dto/RunWorkResponse.java#L6-L44) 展示了完整工作包；[`AgentRunWorkerService.claim`](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/AgentRunWorkerService.java#L118-L195) 使用 30 秒租约、递增 fence，并在 lease takeover 时原子收口遗留流。

Python 进程通过 [`__main__.py`](../../blue_whale_agent_worker/src/blue_whale_agent_worker/__main__.py#L9-L29) 选择 fake 或 Pydantic adapter、连接 Java gateway、推进一次 Run。其 Worker 负责 start/chunk/complete/abort、混流重试、使用量聚合和 commit；取消时先 abort，未送达时由 Java takeover 兜底。[`worker.py`](../../blue_whale_agent_worker/src/blue_whale_agent_worker/worker.py#L59-L114) [流尝试与 commit](../../blue_whale_agent_worker/src/blue_whale_agent_worker/worker.py#L114-L245)

Java commit 再次校验 Project/User、expected version、fence、owner、lease、engine/schema，并在同一事务接纳 checkpoint、正式 Assistant 消息、输入请求或动作候选。[`RunCommitRequest`](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/model/dto/RunCommitRequest.java#L11-L50) [`AgentRunWorkerService.commit`](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/AgentRunWorkerService.java#L198-L340)

这套协议里应保留的核心不是 Java/Python HTTP，也不是每一个旧表，而是“模型输出只是候选；只有 Node Product API/持久化层验收后才成为 Conversation/PlanMessage 产品事实”。

## 3. Node 当前已经具备的事实

### 3.1 身份和 API 边界已经断开 Java

Node 通过 new-api（Go）的 `GET /api/token/identity` 解析稳定用户身份。[`new-api-client.ts`](../../packages/core/src/new-api-client.ts#L325-L350) 明确执行该请求；[`next.config.ts`](../../blue_whale_web/next.config.ts#L3-L16) 明确浏览器 `/api/*` 由 Next Route Handler 同源处理，不再存在 Java rewrite 或 `GATEWAY_URL`。

结论：Java User/Gateway 是应清理的旧拓扑，不需要为 IK5Q1R 再建一张“身份迁移/网关迁移”新边界票；这里只需把残留 Compose、配置与验收入口删净。

### 3.2 Conversation 接纳已有最小持久闭环

Node 的 Conversation repo 已经在一个短事务中完成：Project owner 校验、命令幂等回放/冲突、Conversation 解析或创建、单活动 AgentRun、服务端 sequence、正式 User 消息、UserInput answer、Project Events 与 receipt。新 Run 固定为 `typescript-agent`。[`conversation-repo.ts`](../../packages/persistence/src/conversation-repo.ts#L74-L239) [事务内消息/事件/receipt](../../packages/persistence/src/conversation-repo.ts#L240-L340)

这已经覆盖 ADR-0055 所要求的消息持久化、顺序和重复请求不重复生产事实，应该保留并成为后续 PlanMessage/Mention 的接纳底座。

### 3.3 AgentRun 已有最小 lease/fence 与原子成功提交

Node repo 用数据库时间认领 queued 或过期 running Run，递增 fence/version，按新 User 消息构造 prompt；heartbeat 续租仍校验 owner、有效 lease、fence 与 version。[`agent-run-repo.ts`](../../packages/persistence/src/agent-run-repo.ts#L51-L153)

成功提交再次锁定同一组绑定，拒绝过期 owner/fence/version，在同一事务写完整 Assistant 消息、Run completed/requeued 与两个 Project Events。[成功提交](../../packages/persistence/src/agent-run-repo.ts#L155-L250) 这已经是“Worker 崩溃可重领、旧 Worker 不能覆盖新结果”的正确最小骨架，应保留而非用旧 Java commit 全量替换。

### 3.4 Canvas 的读写形状已迁入 Node

Node handler 已校验 Project 归属，repo 已按 `project_id` upsert `viewport_json/nodes_json`。[`handle-canvas.ts`](../../blue_whale_web/lib/canvas/handle-canvas.ts#L9-L28) [`canvas-repo.ts`](../../packages/persistence/src/canvas-repo.ts#L37-L57)

因此无需重写 Java Canvas DTO/Controller；剩余问题是事件原子性，而不是基本 CRUD。

## 4. Node 与目标产品边界的实际缺口

| 优先级 | 边界 | 当前证据 | 必须补齐的最小结果 |
|---|---|---|---|
| P0 | 真实 Agent runtime | `AgentAdapter` 只有 `ready()` 与 `invoke({prompt}) -> {provider,content}`；唯一实现是 SHA-256 fake。[端口](../../packages/core/src/runtime-ports.ts#L1-L14) [fake adapter](../../packages/agent-runtime/src/fake-agent-adapter.ts#L8-L24) worker 启动时拒绝任何非 fake 模式。[入口](../../apps/agent-worker/src/index.ts#L15-L31) | 增加真实 provider adapter，并把 provider 异常/超时/取消映射成确定性的 Run 失败或可重试状态；生产/验收不得把 fake readiness 当作 Agent 可用。无需先引入完整 Agent 框架。 |
| P0 | Worker 协议 | `runAgentWorkerOnce` 只有 claim → heartbeat → `invoke(prompt)` → `commitSuccess(content)`；没有流式、checkpoint、PlanPhase/PlanMessage、Bundle/Skill/ModelProfile、受限资源读取、错误 commit 或取消收场。[worker loop](../../apps/agent-worker/src/worker-loop.ts#L10-L47) | 保留 claim/heartbeat/fence；增加目标产品真正需要的结构化输入、Plan 候选校验和成功/失败终态。旧流式/Bundle/checkpoint 协议只有被目标流程直接需要的最小部分才进入 Node。 |
| P0 | 显式 Mention/选择 | `canonicalRequest` 把 `referenced_asset_ids` 与 `forced_creative_skill_id` 放进 request hash，但 `PreparedConversationMessage` 和 repo 输入不含这两个字段，因而没有归属过滤、持久化或 claim 下发。[prepare](../../packages/core/src/conversation/accept-conversation-message.ts#L37-L68) [返回值](../../packages/core/src/conversation/accept-conversation-message.ts#L89-L119) | 将显式 AssetMention/SceneCardMention（以及仍保留的显式 Skill 选择）作为 User 消息接纳事务内的结构化事实保存，做归属校验并传给本轮 Agent；不能只参与 hash 后静默丢弃。 |
| P0 | PlanPhase / PlanMessage | 当前 `AgentResult` 只有纯文本；Node schema 与消息提交没有 PlanMessage 类型、来源、应用意图或 mention snapshot。 | 以新规格为权威：PlanPhase 是内部阶段；只有完整候选校验成功后，才原子写不可变 `content_type="scene_card_plan"` 的 PlanMessage，并进入 Snapshot/SSE。失败/中断/临时片段不得成为正式消息。[产品规格](../specs/2026-07-28-scene-card-plan-flow-frontend-spec.md#L35-L70) [Snapshot/SSE 形状](../specs/2026-07-28-scene-card-plan-flow-frontend-spec.md#L338-L344) |
| P0 | Canvas 事件原子性 | Node Canvas save 直接 `prisma.canvas.upsert`，没有事务参数，也没有 `appendProjectEvent`；仓库中 `CANVAS_UPDATED` 只存在于旧 Java 实现。 | Canvas 状态变更与 `CANVAS_UPDATED` 在同一短事务提交；Snapshot high-watermark 与 SSE 能观察到保存结果。补重复保存/并发保存的行为测试。 |
| P0 | Schema 与事实模型 | Node schema 只有 `agent_runs.current_checkpoint_id` 字段，却没有 `runtime_checkpoints`；也没有 `run_commits`、`assistant_message_streams/chunks`、`runtime_bundle_*` 等旧事实表。[Prisma AgentRun](../../packages/persistence/prisma/schema.prisma#L217-L244) [baseline SQL](../../packages/persistence/schema/001_baseline.sql#L233-L262) | 不要为“字段同名”补齐整套旧表。若最小恢复采用从正式消息重跑，则删除无用的 `current_checkpoint_id`；若 Plan 流确实需要 checkpoint，再设计一个目标态最小事实。成功/失败与 PlanMessage 所需事实必须完整，旧 Bundle/stream 表不自动迁入。 |
| P0 | Fresh baseline 门禁 | 黑盒测试硬编码 13 张复数/旧命名表（如 `projects`、`canvas_layouts`、`generation_providers`），实际挂载的 `001_baseline.sql` 创建 23 张表，含 singular `project`、`canvas`、`generation_model_capability` 等。[验收期望](../../tests/typescript-baseline/fullstack.test.mjs#L68-L118) [Compose 实际挂载](../../deploy/typescript-baseline/docker-compose.acceptance.yml#L19-L31) | 统一 Prisma、SQL、seed 和验收清单；fresh DB 验收必须真实通过。当前是静态必然矛盾，不能把旧的 baseline 通过记录当作现状。 |
| P0 | 核心黑盒闭环 | baseline 测试只验证服务拓扑、种子、readiness 与 worker restart/stop/start；Agent readiness 还是 `fake-agent-runtime`。[现有验收](../../tests/typescript-baseline/fullstack.test.mjs#L42-L143) | 在隔离 Node-only 栈验证：发正式消息 → 真实 Agent → 原子 PlanMessage/Assistant 事实 → Snapshot/SSE 恢复；Canvas save/event；重复命令；worker claim 后崩溃并由新 fence 接管；旧 worker commit 被拒。 |
| P1 | 测试入口覆盖 | 根 `test:node` 只运行 `vitest run packages`，不会执行 `apps/agent-worker/src/worker-loop.test.ts`；`verify` 间接继承该缺口。[根脚本](../../package.json#L11-L19) | 把 Agent worker 和 Route Handler 的关键测试纳入标准 `test/verify`，避免“文件存在但门禁未运行”。 |
| P1 | 默认运行拓扑退役 | TypeScript baseline 已是 Web + 两个 Node worker；但默认 local Compose 仍启动 Java agent 与 Python worker，Python base URL 指向 `blue-whale-agent:8082`。[Node-only 拓扑](../../deploy/typescript-baseline/docker-compose.acceptance.yml#L56-L125) [旧 local 拓扑](../../deploy/local/docker-compose.yml#L196-L284) 旧 MVP 验收也显式启动 gateway/user/agent/agent-worker。[旧验收入口](../../scripts/run-mvp-acceptance.sh#L36-L42) | Node 黑盒门通过后，删除旧服务、Dockerfile/build 调用、循环脚本、端口、环境变量和验收依赖；默认启动与 CI 不得有 Java/Python fallback。 |

## 5. 明确保留与明确退役

### 5.1 保留，但按目标态重建

- **显式输入，而非隐式全局上下文**：User 主动添加的 AssetMention、SceneCardMention 和仍存在的显式 Skill 选择，要冻结为本轮输入；归属、顺序、版本或摘要必须可恢复。
- **PlanMessage，而非任意 Assistant 文本**：Agent 产出的 Plan 候选只有通过 Product API 校验并原子提交后才是不可变 PlanMessage；Snapshot/SSE 必须返回同一形状。
- **短事务、幂等、lease/fence**：保留 Node 已有实现并扩测试，不回退到进程锁或内存去重。
- **Canvas 事实及事件**：保持整体保存模型；补状态+事件同事务和恢复验证。
- **最小失败语义**：真实 adapter 超时、provider 拒绝、worker 取消必须留下可解释、可重试、不会被旧 worker 覆盖的 Run 状态。

### 5.2 随 Java/Python 删除，不做 1:1 parity

- Java `CanvasController`、Agent 内部 claim/commit/stream/Bundle HTTP controller，以及 Spring/MyBatis/Java DTO 层。
- Python `JavaRunGateway`、CLI 单次 worker、Pydantic AI 对象与 Python 自有 bundle/cache/gate 序列化。
- `RuntimeBundle` draft/validate/publish/audit 全生命周期、旧 ModelProfile/ToolRegistry pin、复杂 read evidence、最多两次 Assistant stream attempt、旧 checkpoint 字节兼容与历史迁移链。它们可留历史文档，但不阻塞 ADR-0055 的最小切换。
- **自动 Creative Skill 选择**以及 claim 后自动读取整张 Canvas 的媒体节点。目标态只把 User 显式 Mention 的资源带入本轮，不默认把整个 Project/Canvas 暴露给模型。
- **Agent 直接创建/覆盖 SceneCard、创建 GenerationJob 或媒体事实**。新规格明确所有 Plan 应用由 User 手动触发，Agent 不自动创建/覆盖/删除 SceneCard；SceneCard 的生成也由显式 GenerationJob 命令触发。[手动应用边界](../specs/2026-07-28-scene-card-plan-flow-frontend-spec.md#L38-L57) [PlanMessage 手动应用](../specs/2026-07-28-scene-card-plan-flow-frontend-spec.md#L80-L101)
- Java/Python 的 Docker/Compose 服务、Maven/Python 启动入口、旧数据库 migration 执行路径、8082 内部端口、`BLUE_WHALE_AGENT_BASE_URL`、`run-worker-loop.sh` 与旧 MVP 验收栈。

旧 Java/Python 测试不应先于 Node 等价门禁删除：先把“保留”语义变成 TypeScript 测试，再删除旧源码及其运行时专属测试；被明确退役的语义不需要搬测试。历史 ADR/研究文档可继续留作追溯，不应成为构建或部署依赖。

## 6. 建议的删除门（Definition of Done）

满足以下全部条件后，Java `blue_whale_server` 与 Python `blue_whale_agent_worker` 才能从运行路径删除：

1. fresh DB 从当前唯一 SQL/Prisma 基线一键初始化；schema 清单和 seed 验收真实通过。
2. 生产配置使用真实 Node Agent adapter；fake 只允许在显式测试模式。
3. 显式 Asset/SceneCard Mention（及保留的显式 Skill 选择）在消息接纳事务内校验、持久化，并进入本轮 Agent 输入；不再只有 hash。
4. Agent 可产出完整 Plan 候选；Product API 校验后原子写正式 PlanMessage、Run 终态与 Project Events；Snapshot/SSE 恢复同一事实。
5. Canvas save 原子写 `CANVAS_UPDATED`；刷新、断线重连和服务重启后仍一致。
6. 重复消息/Plan 应用/Canvas 命令不产生重复事实；claim 后 kill worker，新 worker 可接管，旧 fence 无法提交。
7. provider 超时/拒绝、进程取消和校验失败都有确定终态，不留下永久 `running` 或半成品 PlanMessage。
8. 标准 `pnpm verify` 覆盖 packages、Next Route Handler、agent-worker 和 Node-only 黑盒闭环。
9. 默认 local、CI、acceptance、Docker 与文档启动命令不再启动或探测 Java/Python，也没有静默 fallback。

完成这些门后可以一次性删除旧可执行运行时，而无需双写、旧库迁移或在途 Run 清理；这与 ADR-0055 的 pre-launch 前提一致。

## 7. 验证记录与证据强度

### 7.1 本研究在当前 checkout 重放的 Node 测试

以下命令在 `master@607fadf` 实测通过，覆盖当前最小 Conversation/AgentRun/Event/Canvas/worker seam：

```bash
pnpm exec vitest run \
  packages/core/src/conversation/accept-conversation-message.test.ts \
  packages/agent-runtime/src/fake-agent-adapter.test.ts \
  packages/persistence/src/conversation-repo.test.ts \
  packages/persistence/src/agent-run-repo.test.ts \
  packages/persistence/src/product-event-repo.test.ts \
  'blue_whale_web/app/api/projects/[id]/conversation/messages/route.test.ts' \
  blue_whale_web/lib/project-events/project-event-stream.test.ts \
  'blue_whale_web/app/api/canvases/[projectId]/route.test.ts' \
  apps/agent-worker/src/worker-loop.test.ts
```

结果：**9 files / 21 tests passed**。这证明当前最小实现的单元/边界测试是绿的，不证明真实 Agent、PlanMessage、Canvas event 或 Node-only 端到端已经可用。

### 7.2 旧运行时回归资产

主会话对旧 Python 关键 Agent 测试实测为 **182 passed，另有 28 subtests passed**；对 Java 的 Conversation/stream/Bundle/read-evidence/clarification/Snapshot-SSE/Canvas/Event 10 个测试类实测为 **95 tests passed / BUILD SUCCESS**。这些结果说明旧语义有可运行的回归样本，适合在迁移时判定哪些测试要移植、哪些能力明确退役；它们不是 Node parity 的通过证明。

主会话最初提供的部分 TypeScript/Python 测试路径与当前 checkout 文件名不一致，因此本文没有把那些路径伪装成可复现命令；Node 数字以本研究在当前 checkout 的重放结果为准。Docker `test:acceptance` 本研究未执行，因为其预期表清单与实际挂载 SQL 已可静态证明矛盾；修复后必须执行并保存真实结果。

## 8. 对后续地图/票据的约束

本研究建议把实施切片按依赖顺序组织为：

1. **目标事实冻结**：显式 Mention、PlanMessage/PlanPhase、Agent 不自动执行产品副作用。
2. **Schema + 接纳层**：补结构化消息输入、PlanMessage、Canvas event；删除或落实孤立 checkpoint 字段；修复 fresh baseline。
3. **真实 Node Agent**：provider adapter、结构化 Plan candidate、最小失败/取消终态，复用现有 lease/fence。
4. **恢复与故障黑盒**：Snapshot/SSE、重复命令、worker kill/takeover、旧 fence 拒绝。
5. **运行路径断链**：删除 Java/Python 可执行源码与所有 Compose/CI/脚本/config 入口；保留历史文档。

后续票据不得把“实现旧 Runtime Bundle/stream/checkpoint 全套协议”写成 Node 退役前置，也不得用“Agent 能返回一段 fake 文本”替代 PlanMessage、显式 Mention与恢复闭环的验收。
