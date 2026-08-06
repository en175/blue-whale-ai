# ADR-0063：New API 上游视频渠道采用原生端点 + token 计费

- **状态**：Accepted
- **日期**：2026-07-31
- **决策者**：lixq（AI 协同分析）
- **关联工单**：[IK5GPO](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/tasks/list?issue=IK5GPO)

## 背景

blue_whale_api（new-api 二开）需要把 new-api 系上游厂商（首个：neovixai `api.neovixai.com`）作为视频生成服务商渠道接入。

直连尝试把上游配成 **OpenAI 类型渠道**（channel type=1），视频异步任务路由到 Sora 任务适配器，暴露两层问题：

1. **状态获取失败**：Sora 适配器轮询上游 `GET /v1/videos/{id}`（OpenAI Sora 端点）。该端点对 doubao/seedance 任务坏——任务未完成时回 `status:"unknown"`；完成后因上游 doubao converter 把字符串型 `usage.completion_tokens` 反序列化成 int 字段失败，返回 500 `convert_to_openai_video_failed`。blueapi 收到 unknown/500 → Sora 适配器 `switch` 不认 → 状态留空 → `service/task_polling.go:506` 判 "upstream returned unrecognized message" → 任务 FAILURE（实测 `task_gtE58…`、`task_tDqW…` 均 FAILURE，`quota=46875000`）。
2. **计费无 token**：该端点不报可用 token。

上游任务本身成功（原生端点 `GET /v1/video/generations/{id}` 返回 SUCCESS + 有效 mp4）——失败纯在 blueapi 侧端点/协议错配。

## 约束

- **上游不可改**：blueapi 是客户，`/v1/videos`（Sora 端点）厂商侧不会修。
- **只有原生端点 `/v1/video/generations/{id}` 可用**，且现已返回 int token（实测 `task_rzOL`：`usage_reported:true, usage_completion_tokens:108900`；`108900 × modelRatio(37.5) = 4,083,750` 与上游 quota 自洽）。
- Sora 适配器与真实 OpenAI Sora 渠道共用，不能改其全局端点。
- 通过 Sora 端点提交的任务在上游侧残缺（model 解析为空），原生端点 fetch 会 403 `no access to model`——坐实 submit 也必须走原生端点。

## 决策

新增独立渠道类型 **"New API"**，只对这条渠道把视频任务的 submit/fetch 切到原生端点，同步链路不动：

1. **同步（chat/completions 等）**：`ChannelTypeNewAPI → APITypeOpenAI`，复用 `openai.Adaptor`，零改动。
2. **视频任务**：`relay/relay_adaptor.go` `GetTaskAdaptor` 把 `ChannelTypeNewAPI` 路由到新适配器 `tasknewapi`：
   - submit `POST {base}/v1/video/generations`，fetch `GET {base}/v1/video/generations/{id}`（**核心修复，不再打 `/v1/videos`**）。
   - 原生端点返回 new-api Task 信封（**token 字段扁平，非嵌套 `usage:{}`**）：`{code, data:{status, usage_total_tokens, usage_completion_tokens, result_url, ...}}`。状态由 `task_polling.go:471` 的 try-1 信封解析处理（复用，不重写）。
   - **token 提取在 `AdjustBillingOnComplete`（非 `ParseTaskResult`）**：try-1 把信封解析进 `model.Task` 时会丢弃 token（`model.Task` 无 `usage_*_tokens` 字段）且跳过 `ParseTaskResult`，故在 `AdjustBillingOnComplete` 从原始 `task.Data` 提取 `usage_total_tokens`（`usage_completion_tokens` 兜底）写入 `taskResult.TotalTokens` 并 `return 0`，落到结算路径 #2 `RecalculateTaskQuotaByTokens`（与 doubao 同函数同公式）。`flexInt` 兼容 int/字符串形态 token，缺省/非法兜底 0。
3. **计费回 doubao 式 token**：结算 `RecalculateTaskQuotaByTokens` → `quota = tokens × modelRatio × groupRatio`。`seedance-2.0` modelRatio=37.5 是 token 量纲，在此公式下天然正确，**无需改定价配置**，且与 doubao 直连渠道同公式同量纲、运营心智统一。
4. **Phase 2 预留**：`EstimateBilling` 加 doubao 式 `video_input`（分辨率档）倍率；同步多协议透传（Claude/Gemini 原样进上游）；默认模型列表。

## 否决的备选

- **沿用 OpenAI/Sora 渠道**：fetch 端点坏且上游不可改，不可行。
- **duration-based（sora 式 seconds×size）**：task 预扣公式是 `(modelRatio/2 × QuotaPerUnit) × seconds × size`，而 37.5 是 token 量纲，套秒乘会暴收（实测 5s/720p → 46,875,000 quota ≈ $93.75，即原失败任务的 quota）。除非重配 modelRatio 成"每秒价"量纲，否则量纲错配。
- **本地估算 token**：强依赖 doubao 官方分词公式（仓库现无任何前向 video→token 估算逻辑），且模型版本升级会漂移；上游现已报真实 int token，无需降级。
- **预扣即终值（ModelPrice 按次）**：上游报 token 后已无必要，且按次对长视频有利润风险。
- **复用 doubao 适配器**：doubao 适配器打火山原生端点，new-api 厂商不暴露那些端点；且其 `responseTaskUsage.CompletionTokens int` 对字符串 token 同样会炸。

## 连锁影响

- `constant/channel.go`：新增 `ChannelTypeNewAPI`（建议 `=59`，置于 `AdvancedCustom=58` 后、`ChannelTypeDummy` 前）+ `ChannelTypeNames` + `ChannelBaseURLs`。
- `common/api_type.go` `ChannelType2APIType`：`ChannelTypeNewAPI → APITypeOpenAI`。
- `relay/relay_adaptor.go` `GetTaskAdaptor`：新增 case → `tasknewapi.TaskAdaptor`。
- 新目录 `relay/channel/task/newapi/`。
- 前端 `web/default` + `web/classic`：渠道类型下拉 + i18n。
- 运营配置：后台加渠道（类型 New API、base_url、key、模型 `seedance-2.0`）；定价沿用现有 `seedance-2.0` modelRatio=37.5，无需新增。

## 错误与测试边界

- 信封三态（SUCCESS/IN_PROGRESS/FAILURE）+ token 提取单测（`ParseTaskResult` 兜底 + `AdjustBillingOnComplete` 生产主路径）；`flexInt` 兼容 int/字符串 token，缺省/非法兜底 0（不 panic、不触发误重算）。
- 计费单测：`tokens × modelRatio × groupRatio` 与 doubao 直连渠道同公式同量纲。
- e2e：dev 盒加 New API 渠道，跑 `seedance-2.0` 5s 720p → 期望 SUCCESS + 有效 mp4 + `tokens × 37.5` 量级扣费。
- 不依赖上游 `/v1/videos`（视作永久坏）。
