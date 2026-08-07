# ADR-0038：统一生图工具包、Agent Plan 专属端点与图片直连退役

- **状态**：Accepted
- **日期**：2026-07-20
- **关联工单**：[IK21OP](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK21OP)（父工单 [IK21O3](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK21O3)）

## 背景

接入火山方舟 Agent Plan 真实文生图前，生成能力存在三条互不统一的问题：

1. **直连链路绕过治理**：旧 `POST /api/generation/image` 直接调用 `VolcEngineService`，
   既不走成本预留（`CostReservation`），也不走内容审核（`ContentReview`）。这是治理缺口——
   付费调用无人记账、生成结果无人把关，与 [ADR-0018](0018-security-cost-review-audit-observability-baseline.md)
   立的安全/成本/审核基线冲突。
2. **模型能力无权威来源**：`generation_model_capability` 表整个仓库没有 DDL 也没有种子数据，
   直连链路依赖它却从未跑通；前端 `ImageModelSettingsPopover` 写死四个模型（其中一个 ID 与官方
   版本不符），模型/分辨率/数量选择不随 payload 提交，纯 UI 摆设。
3. **入口执行路径分裂**：BottomDock（参数式）、AgentChatPanel（对话式）与 `/generate`
   （GenerationInbox 对话式）三个入口若各自直连供应商，治理与重试逻辑要复制三份。

同时，火山方舟 Agent Plan 与标准 OpenAI 兼容端点不是同一套：Agent Plan 必须用专属
`/api/plan/v3` 端点与专属 API Key，混用标准 `/api/v3` 会失败或产生额外费用（官方接入视觉模型
契约，`docs/API/`）。这是一个容易踩错、且一旦走错会重复付费的配置决策，值得记录。

本 ADR 锁定统一生图工具包的边界，并退役绕过治理的图片直连。

## 决策

### 1. 统一 GenerationProvider 契约，按 mode 装配具体实现

图片执行层的产品中性请求/结果契约为 `GenerationProvider`（异步为 `AsyncGenerationProvider`）。
具体实现（Fake、OpenAI `gpt-image`、火山方舟 Agent Plan 等）按运行配置 `GENERATION_MODE`
装配。**不引入独立的运行时 Provider Registry 组件**——当前 mode 装配足以覆盖产品边界，
新增一层 Registry 属于无需求抽象（见备选 A）。若未来真出现动态发现/热插拔供应商的产品需求，
另开实现工单再评估。

### 2. generation_model_capability 为模型能力唯一权威

新增 `generation_model_capability` 表（V7 迁移，见 [ADR-0037](0037-schema-migration-framework.md)），
承载 Provider、模型与尺寸（2K/3K/4K）、格式（png/jpeg）、数量、参考图、tools（联网搜索）能力。
前端选项从后端 `/api/generation/models` 拉取，废弃写死的模型清单。当前启用火山
`doubao-seedream-5.0-lite` 图片模型及其能力行。

### 3. Agent Plan 使用专属 /api/plan/v3 端点与专属 Key

`ARK_BASE_URL` 默认指向 `https://ark.cn-beijing.volces.com/api/plan/v3`（含 `/plan`），
`ARK_API_KEY` 为 Agent Plan 专属 Key。两者只在本地 `deploy/local/.env`（gitignore）中提供真实值，
`deploy/local/.env.example` 保持默认 fake 占位并警示真 Key 绝不入库；缺失或无效时启动 fail-closed，
不回退到其他供应商。

### 4. 退役 /api/generation/image 直连

`POST /api/generation/image` 端点退役，返回 404；`GenerationDirectPathRetiredIT` 守住这条回归。
原直连里的火山调用逻辑搬进队列 Provider 复用，不重复实现。队列 Job API（`/api/generation/jobs` 系列）
与模型能力查询（`/api/generation/models`）继续可用。

### 5. 三入口统一走 GenerationJob 队列流水线

三个生图入口（BottomDock、AgentChatPanel、`/generate` GenerationInbox）产品职责独立，但执行层
**不各自维护独立生成路径**，统一创建 `GenerationJob` 进入后台队列流水线：成本预留 → 供应商调用 →
内容审核 → 结果落 Asset → 结算成本，含失败重试与多输出。入口职责边界（参数式 vs 对话式）与执行层
统一是正交的两件事。

## 考虑过的备选

- **A. 独立 Provider Registry 运行时组件**：把 Provider 装配抽成可动态注册的 Registry。
  拒绝——当前 mode 装配已满足需求，Registry 是无需求抽象，徒增阅读与维护成本。文档也不得把概念性
  装配写成尚不存在的具体 Registry。
- **B. 混用标准 /api/v3 端点**：复用通用方舟端点而非 Agent Plan 专属端点。拒绝——官方契约明确
  Agent Plan 必须走 `/api/plan/v3`，混用会调用失败或按非套餐计费产生额外费用。
- **C. 保留 /api/generation/image 直连作为快速路径**：让简单生图绕过队列。拒绝——绕过成本预留与
  内容审核是治理缺口，与 ADR-0018 冲突；任何入口的付费生图都必须进同一条可追溯流水线。
- **D. 三入口各自维护生成路径**：每个入口独立调用供应商。拒绝——治理、重试与审计逻辑会复制三份
  且彼此漂移；统一队列流水线是唯一可追溯的事实链。

## 后果

- 三个入口的真实付费生图都能从 `generation_jobs`、`generation_job_outputs`、`assets`、
  `content_reviews`、`audit_records`、`cost_reservations`、`project_events` 七个数据面追溯到同一
  事实链；重试、恢复与多入口操作不产生绕过治理的重复付费调用。
- 文档（`CONTEXT.md`）以实现事实描述生图工具包：`GenerationProvider` 统一契约 + 按 mode 装配 +
  `generation_model_capability` 能力表 + 公共治理流水线，不声称存在独立 Registry。
- Agent Plan 真实 Key 只存在于本地忽略文件；CI 默认维持 Fake，不持有真实凭据。
- 新增图片/视频供应商时，必须扩 `generation_model_capability` 能力行并接入 Provider 契约与队列
  流水线，而非另开直连端点。

## 关联

- [ADR-0015](0015-java-product-control-plane-python-runtime.md) — Java Product API 与 Python 运行时分层
- [ADR-0016](0016-project-api-and-replayable-event-stream.md) — Project API 与可重放事件流
- [ADR-0018](0018-security-cost-review-audit-observability-baseline.md) — 安全/成本/审核/可观测基线
- [ADR-0021](0021-volcengine-llm-shield-content-review.md) — 火山方舟内容审核
- [ADR-0022](0022-content-review-evidence-routing.md) — 审核证据路由
- [ADR-0037](0037-schema-migration-framework.md) — 版本化迁移（V7 能力表）
