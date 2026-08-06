# IK3UWN 上线前 TypeScript 技术栈统一总体方案

- **工单**：[形成上线前 TypeScript 技术栈统一总体方案](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK3UWN)
- **范围权威**：[ADR-0055：上线前 TypeScript 技术栈统一的范围边界](../adr/0055-prelaunch-typescript-unification-scope.md)
- **状态**：已于 2026-07-27 经用户确认；作为后续 `to-spec` 的输入

## 目标与边界

上线前把核心产品运行路径统一到 Node.js/TypeScript，同时保留现有 Next.js Web 和已经成立的产品语义。目标不是复刻 Java/Python 的类与框架，而是得到一个可从 fresh database 启动、可验证、可一次性切换的最小系统。

本文只冻结总体边界、依赖顺序和完成信号。内部 DTO、精确表结构、状态枚举与测试夹具随对应实施切片落地，不建立独立的合同先行阻塞链。

## 1. 当前边界与目标边界

| 能力 | 当前 | 目标 |
| --- | --- | --- |
| Web | `blue_whale_web` Next.js 调用 Java Product API | 保留现有 Next.js；只把后端基地址、DTO 与恢复接到 Node Product API |
| Product API | Java/Spring 承担公开命令、查询、持久化与产品事实接纳 | Node.js + 原生 Fastify；HTTP 只做边界校验与适配，领域规则在纯 TypeScript 应用层 |
| Agent | Python Worker 承担模型、skills、tools 与编排 | 纯 TypeScript Agent Worker；薄运行时封装模型/provider，产品事实只能经共享应用用例接纳 |
| Generation | Java Worker、调度器与 provider client 承担图片/视频生成 | 纯 TypeScript Generation Worker；MySQL 持久任务，provider adapter 只返回规范化结果与证据 |
| 持久化 | Java V1–V18 Schema 与迁移链 | fresh MySQL Schema + 必要种子；不迁移研发/测试数据，不兼容旧 checkpoint 或在途任务 |
| 支付 | Go 订单/quota 与尚未落地的支付扩展 | 本次不改；Go/支付不进入核心迁移依赖，也不计入 Java/Python 退役范围 |

目标后端是**一个模块化单体、三个进程入口**：`product-api`、`agent-worker`、`generation-worker` 位于同一代码库，共享领域、应用和持久化实现。进程拆分只用于长任务执行和故障隔离，不升级为三个独立服务治理体系。

## 2. 最小 Monorepo、入口与依赖方向

首版保持 Web 原目录，避免为目录美观增加机械迁移：

```text
pnpm-workspace.yaml
blue_whale_web/                  # 现有 Next.js，保留
apps/
  product-api/                   # Fastify composition root
  agent-worker/                  # Agent 领取循环 composition root
  generation-worker/             # Generation 领取循环 composition root
packages/
  core/                          # Project/Conversation/Run/Job/Asset/Canvas 领域与应用用例
  persistence/                   # MySQL repository、事务、baseline schema 与 init
  contracts/                     # Web HTTP/SSE DTO 与运行时 schema
  agent-runtime/                 # 模型、tool、stream adapter
  generation-runtime/            # 图片/视频 provider 与对象存储 adapter
```

基线选择：pnpm workspace、严格 TypeScript、原生 ESM、`tsc -b`；Web 继续 `next build`。Node 与包管理器版本在实施时固定到仍受支持的精确版本。Nx、服务 bundling 和独立制品治理不是前置条件，只有真实构建瓶颈出现后再引入。

依赖只沿以下方向：

```text
blue_whale_web -> contracts
product-api -> contracts + core + persistence
agent-worker -> core + persistence + agent-runtime
generation-worker -> core + persistence + generation-runtime
runtime adapters -> core ports
core -> no framework / database / provider dependency
```

禁止 app 互相导入、循环依赖、万能 `shared` 包，以及在 route/worker loop 中复制领域状态转换。Worker 可以共享 repository 和应用用例，但不得绕过应用用例直接拼 SQL 修改产品状态。

fresh Schema 使用一个新的 baseline migration 建库，至少覆盖 Project、Conversation/Message、AgentRun、GenerationJob/Output、Asset、CanvasNode、ProjectEvent 和 IdempotencyReceipt；lease、fence、aggregate version 与唯一约束放在拥有对应事实的表中。种子只保留启动核心流程所需的 generation capability/provider 配置。字段级设计由纵向切片测试驱动，不继承 V1–V18 历史包袱。

## 3. 核心语义的必要保留项

| 对象 | 首版必须保留的事实 |
| --- | --- |
| Project | 用户与资源的授权边界；所有 Web 可见变化都是已接纳事实；snapshot 与事件 cursor 足以在刷新后重建页面 |
| Conversation | 用户消息先持久化再触发 Run；服务端分配稳定顺序；同一请求重放不产生第二条消息 |
| AgentRun | 持久状态和输入位置；Worker 以 lease/fence 领取；旧 fence 不能提交；assistant message、等待用户输入与终态只经应用用例接纳 |
| GenerationJob | 持久 Job 与输出槽；图片同步结果和视频异步任务共享同一产品表面；重复请求/回调只接纳一次；终态封口 |
| Asset | 数据库 `assetId` 是稳定身份；对象先进入私有 staging，校验并接纳后才发布；Canvas 不依赖临时 URL 或 provider task id |
| Canvas | 节点与 Asset 引用持久化；刷新后从 snapshot 恢复；生成结果只在 Asset 接纳后进入 Canvas |

共同规则只有四条：短数据库事务；稳定幂等键；持久任务；简单 lease/fence。外部调用不得放进数据库事务。外部调用结果无法确认时，将任务明确标记为失败并允许用户人工重试，不建立自动核对系统，也不盲目重发可能已经发生的付费调用。

## 4. 调用方式与数据边界

| 调用 | 方式 | 数据边界 |
| --- | --- | --- |
| Web → Product API | HTTP 命令/查询 + Project SSE；边界 DTO 做运行时校验 | Web 不访问数据库，不把 provider 状态当产品事实；只投影 API 已接纳的数据 |
| Product API → MySQL | 共享应用用例 + repository，短事务 | 原子持久化命令结果、幂等回执、状态与 ProjectEvent；HTTP 响应只返回已持久化事实 |
| Agent Worker → 模型 | `agent-runtime` adapter | 模型输出是候选文本/tool proposal；Worker 通过共享应用用例提交，不能自行形成消息、Job 或终态 |
| Generation Worker → provider/object storage | `generation-runtime` adapter | provider task、临时 URL 与原始状态只作内部证据；对象先 staging，Asset 接纳后才公开 |
| 两类 Worker → MySQL | 共享 claim/commit/accept 应用用例 | 使用数据库时间、lease owner 与单调 fence；Worker 不手写跨领域更新，也不互相调用 |

MySQL 是恢复权威。首版不要求 Redis；若以后加入，只能作可丢失唤醒，清空后仍必须能靠 MySQL 扫描恢复。对象存储只保存字节，Asset 与可见性事实仍以数据库记录为准。

## 5. 按纵向能力实施

| 顺序 | 纵向切片 | 完成信号 |
| --- | --- | --- |
| 0 | Workspace 与 fresh DB | 一条命令初始化空库；三个 Node 入口可启动并通过 readiness；严格类型检查与最小测试通过 |
| 1 | Project / Conversation / Canvas 基线 | Web 可创建/打开 Project、发送一条用户消息、保存 Canvas；刷新或重启后 snapshot 恢复相同内容与顺序 |
| 2 | Agent 对话闭环 | 持久 AgentRun 被 Worker 领取，生成 assistant message，并完成或等待输入；Worker 中断后可重新领取且旧 fence 提交被拒绝 |
| 3 | 图片生成闭环 | Web 或 Agent 创建 GenerationJob；图片结果经 staging、接纳成为唯一 Asset 并进入 Canvas；重复命令不重复生成结果 |
| 4 | 视频生成闭环 | 异步 provider task 的提交、查询/回调、结果接纳可跨进程重启继续；重复回调只产生一次 Asset/Canvas 变化 |
| 5 | 恢复门与旧运行时退役 | 三类恢复测试和五项最终标准全部通过；核心 E2E、启动配置与部署配置中不再启动或调用 Java/Python |

每个切片都必须从 fresh DB 独立建起，并保持前面切片的 E2E 绿色。不要先横向建完整框架、合同平台或治理系统，再等待最后集成。

## 6. 必要恢复测试与最终完成标准

三类恢复测试：

1. **刷新/重启不丢失**：在消息或 Job 已接纳后刷新浏览器并重启 API/Worker；snapshot 与持久任务恢复到同一事实，最终继续完成或保持明确失败。
2. **重复不产生重复结果**：并发重放同一命令幂等键、provider 回调和 Worker commit；只存在一条业务事实链、一个 Job 输出和一个 Asset。
3. **Worker 崩溃可接管**：在领取后、provider 调用前后和接纳前终止 Worker；lease 到期后新 Worker 获得更高 fence，旧 Worker 的迟到提交被拒绝。

最终完成标准固定为：

1. 全新数据库可一键初始化并启动。
2. Web、Agent 对话、图片/视频生成及 Asset/Canvas 核心流程可用。
3. 上述刷新/重启、重复请求、Worker 崩溃三类测试通过。
4. 严格 TypeScript 构建、类型检查与核心测试通过。
5. 核心流程不再依赖 Java/Python 运行时。

## 7. 最小退役清单与未来工作

达到第 5 个纵向切片后，至少完成以下退役动作：

- Web 的核心 API/SSE 基地址只指向 Node Product API，不再保留 Java/Python 静默回退。
- 从核心启动、镜像、部署、健康检查和 CI 路径移除 Java Product API、Java Generation Worker 与 Python Agent Worker。
- 删除或停用旧 Java scheduler/provider adapter、Python worker entry point、旧 migration runner 及其仅供核心路径使用的环境变量和凭据。
- 以仓库搜索和 E2E 证明核心入口没有对 `blue_whale_server` / `blue_whale_agent_worker` 的运行时调用；历史文档可保留，但不得继续充当实现权威。
- Go 支付代码保持不动；它既不是本次目标实现，也不是本次退役对象。

明确移出本次方案：支付渠道与 Go `ConfirmTopUp`；旧库迁移、历史数据对账和生产级灾备；容量/告警/长期证据生命周期；公开 API major 退役治理；独立内部合同族、HMAC、版本兼容矩阵；InvocationLedger、AttemptPermit、多层 Reconciler、迟到证据与验收证据平台。

## 交接方式

用户确认本文后关闭本工单，并仅对本工单使用 `to-spec` 创建新的独立实施主 Issue。随后只对新的 Spec Issue 使用 `to-tickets`，按第 5 节的纵向切片拆分实施票；本 Wayfinder 不直接创建或启动生产实施票。

## 参考

- [Node 重构现状基线与必须保留的领域不变量](../research/IK3UVU-node-rewrite-current-state-baseline.md)
- [Node.js 服务框架与 TypeScript Monorepo 方案评估](../research/IK3UVW-node-typescript-framework-monorepo-evaluation.md)
- [Agent Worker 的 Node.js 运行时替代方案评估](../research/IK3UVZ-node-agent-worker-runtime-evaluation.md)
- [Generation Worker 队列与供应商适配方案评估](../research/IK3UW2-node-generation-worker-queue-provider-evaluation.md)
