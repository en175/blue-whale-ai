# 图片生成后续待办

> 按优先级排列，新需求追加到末尾。

## P1 - 流式响应优先，非流式降级轮询

- 目标：`GenerationController` 图片生成接口优先走流式（SSE），Provider 不支持流式时退化为异步 job + 前端轮询。
- 背景：火山 `doubao-seedream-5.0-lite/4.5/4.0` 支持 `stream=true` 即时逐张返图；当前 `VolcEngineService.generate()` 仅把字段透传到 request，实际仍调同步 `arkService.generateImages(request)`。
- 关键改动：
  1. Provider 层新增流式能力声明（`supportsStreaming`）。
  2. `VolcEngineService` 改用 Ark 流式 SDK，返回 `Flux<ImagesResponse>` 或 SSE。
  3. `GenerationJobService` 图片任务从同步事务改为异步状态机：`queued → processing → succeeded|failed`，逐张落 asset 并更新 `progress` / `output_asset_ids`。
  4. `GenerationController` 增加 SSE endpoint，兼容不支持流式的 Provider 时返回 `jobId` 供前端轮询。
  5. 前端 `generation.ts` 支持 `EventSource` / `ReadableStream` 解析，逐张渲染；降级路径保持现有 `getJobStatus` 轮询。

## P1 - 图片生成错误码接收层

- 目标：根据上游返回的 `error.code` 与 `error.message` 做差异化处理（重试、降级、提示、审核标记等）。
- 背景：火山文档第 703-709 行说明：
  - 单张图审核不通过：继续生成同请求其他图。
  - 单张图内部服务异常（500）：停止继续生成。
- 关键改动：
  1. 定义上游错误码映射表（配置化或枚举）：`content_moderation` / `upstream_500` / `rate_limit` / `invalid_param` 等。
  2. 在 Provider 返回层或 `GenerationJobService` 中统一收口解析，避免各 Provider 自行判断字符串。
  3. 按错误类型执行策略：
     - 审核类：标记单张失败，继续后续图片。
     - 限流类：指数退避重试。
     - 参数类：直接抛给前端，不重试。
     - 上游 500：终止当前请求并标记失败。
  4. 将处理结果写回 `GenerationJob.error` 字段，前端可展示结构化原因。

---

## 扩展区（新需求追加）

### [MVP] 新增「生成」页 `/generate` 与「资产」页 `/assets`（对标即梦）

> 对标即梦信息架构（灵感 / 生成 / 资产 / 画布）。当前首页点「生成」直跳 `/canvas`，画布背了「结果展示 + 节点编排」两口锅。本次拆出独立的生成流页与资产库页。MVP 只求两个页面 + 接口打通，不追求视觉精致。

**信息架构**（4 个一级）：

| 路由 | 页面 | 状态 |
|------|------|------|
| `/` | 首页（灵感）：模板 + 输入框 | 已有，保留 |
| `/generate` | 生成：输入 → 任务卡片流（生成中/完成）→ 底部常驻输入框 | 新增 |
| `/assets` | 资产：作品/素材库，列表 + 类型筛选 | 新增 |
| `/canvas` | 画布：进阶编排 | 已有，**本次不动** |

**后端：已落库，只缺列表查询接口**

已有接口（无需改）：

- `POST /api/generation/image` 文生图（同步）
- `POST /api/generation/video` 图文生视频（异步，返 jobId）
- `GET /api/jobs/{id}` 轮询任务状态
- `GET /api/generation/models?capability=image|video` 模型能力
- 实体 `GenerationJob`（带 `userId` / `projectId` / `type` / `status` / `input` / `outputAssetIds`）、`Asset`（带 `userId` / `type` / `url` / `source`）均已落库

需新增 2 个列表接口：

1. `GET /api/jobs?userId=&type=&status=&projectId=&page=&size=` —— 生成页拉任务流（按时间倒序，含 input 参数 + output assets）。`GenerationJobService` 加 `listJobs(userId, type, pageable)`；列表项复用或裁剪 `JobStatusResponse`。
2. `GET /api/assets?userId=&type=&page=&size=` —— 资产页拉产物库。`AssetMapper` 加按 user+type 的查询（QueryWrapper 即可）；新建 `AssetResponse` DTO，不暴露 `storageKey` 等内部字段。

**前端**：

- `app/generate/page.tsx` —— 生成流页。底部复用 `AgentComposer` 作输入框；主区拉 `GET /api/jobs` 渲染任务卡片流，生成中任务轮询 `GET /api/jobs/{id}`。
- `app/assets/page.tsx` —— 资产库。拉 `GET /api/assets`，网格列表，按类型（image/video）筛选。
- `components/AgentComposer.tsx` `handleGenerate`（当前 `:123` 直跳 `/canvas`）——改默认落点为 `/generate`（详见待决策）。
- api 层：`app/canvas/_canvas/api/generation.ts` 已有 job 调用逻辑，抽公共 client 或新建 `api/jobs.ts` / `api/assets.ts`，生成/资产页与 canvas 共用。

**会话/项目维度（仅预留思路，本次不实现）**：

- 物理字段 `GenerationJob.projectId`（`GenerationJob.java:42`）已存在，即梦式「默认创作 / 最近对话」靠它聚合任务的位子已留好。
- 本次列表查询先按 `userId` 维度；`projectId` 留空或固定默认值，不展开多会话 UI。
- 扩展位（后续）：列表接口预留 `projectId` 可选过滤；前端左侧导航「最近对话」先占位不实现。

**MVP 边界（不做）**：

- 不动 `/canvas` 任何内容（画布保持现状，结果展示职责不迁出，留待后续）。
- 不做多会话/项目 UI（只留 `projectId` 字段 + 接口可选参数）。
- 不追求视觉精致——接口打通 + 能展示即可。
- 不做 SSE（沿用现有轮询 `GET /api/jobs/{id}`）。

**待决策**：

- 首页「生成」按钮默认落点：统一改 `/generate`（推荐，对齐即梦），canvas 改为从生成页主动「进画布编排」进入；还是 agent tab 仍进 canvas、video/image 进 `/generate`？MVP 建议先统一 `/generate`。


