## ADDED Requirements

### Requirement: Seedance 视频模型注册数据
系统 SHALL 在 `generation_model_capability` 表中维护 `capability_type='video'` 的 Seedance 视频模型行（至少 `doubao-seedance-2-0-260128`），使 `GET /api/generation/models?capability=video` 返回非空模型列表。视频模型 MUST 复用图片能力表结构：`supported_sizes` 列承载视频 resolution 选项（480p/720p/1080p）、`supported_aspect_ratios` 承载视频 ratio、`features` 关闭图片专有开关（`stream`/`sequential_image_generation`）。

#### Scenario: 查询视频模型列表非空
- **WHEN** 前端 `GET /api/generation/models?capability=video`
- **THEN** 返回 `Result{code:200, data:[{model_id:"doubao-seedance-2-0-260128", capability_type:"video", ...}]}`，列表非空

#### Scenario: 视频模型携带 resolution 选项
- **WHEN** 返回 Seedance 视频模型
- **THEN** `supported_sizes` 含 `720p`/`1080p` 等 resolution 项，`default_size` 为合法 resolution（如 `720p`），`supported_aspect_ratios` 含 `16:9`/`9:16`/`1:1`

### Requirement: 视频生成请求参数与首帧约束
系统 SHALL 通过 `POST /api/generation/video` 接收 `prompt`（必填）、`modelId`（必填）、`resolution`、`aspectRatio`、`duration`、`firstFrameUrl`，异步提交火山 Seedance。文生视频（无 `firstFrameUrl`）时请求火山 `content` SHALL 仅含文本元素；首帧图生视频（带 `firstFrameUrl`）时 SHALL 构造 `image_url` 元素且 `role="first_frame"` 配合文本元素。请求/响应 JSON 字段 MUST 为 snake_case。

#### Scenario: 文生视频异步提交
- **WHEN** 前端 `POST /api/generation/video` 带合法 `prompt` + `modelId`，无 `firstFrameUrl`
- **THEN** 后端 insert `generation_jobs(type=video, status=queued)`，调 Ark 创建任务拿 `provider_task_id`，立即返回 `Result{code:200, data:{job_id, status:"queued"}}`，不阻塞等待

#### Scenario: 首帧图生视频
- **WHEN** 请求带 `prompt` + `modelId` + `firstFrameUrl`
- **THEN** 调用 `VolcEngineService.createVideoTask` 时构造的火山请求 `content` 含 `image_url` 元素（`role="first_frame"`）与文本元素

### Requirement: 移除未接通的尾帧字段
系统 SHALL NOT 在 `VideoGenerateRequest` 中保留 `lastFrameUrl` 字段，且 `VolcEngineService.createVideoTask` MUST 只向火山提交首帧（单 `image_url`）。`last_frame_url` 不再是合法的视频生成请求字段，MUST NOT 影响视频生成（即便调用方传入也被忽略，不传给火山）。

#### Scenario: 请求体含历史 last_frame_url 字段
- **WHEN** 调用方 `POST /api/generation/video` 的请求体仍携带 `last_frame_url`
- **THEN** Jackson 忽略该未知字段（不报错），视频生成请求不包含尾帧，火山 `content` 最多含一个 `first_frame` 图片元素

#### Scenario: createVideoTask 仅构造首帧
- **WHEN** `createVideoTask` 被调用
- **THEN** 构造的火山请求 `content` 中图片元素数量 ≤ 1（首帧），不存在 `role="last_frame"` 元素

### Requirement: 视频结果转存与端到端跑通
系统 SHALL 在视频任务到达 `succeeded` 时由 `JobPoller` 下载火山 `video_url`（24h 过期）转存到本地（`./data/assets/`），`assets` 表记 `source='generated'`/`type='video'`，`generation_jobs.status=succeeded`、`output_asset_ids` 记转存 asset id。端到端 SHALL 可通过 `POST /api/generation/video` → 轮询 `GET /api/jobs/{id}` 验证全链路。

#### Scenario: 创建任务返回 jobId
- **WHEN** `curl POST /api/generation/video` 带合法参数（已配 `ARK_API_KEY` + Seedance 余额充足）
- **THEN** 返回 `Result{code:200, data:{job_id, status:"queued"}}`

#### Scenario: 轮询到 succeeded 并落盘 mp4
- **WHEN** 轮询 `GET /api/jobs/{job_id}` 直至任务终态
- **THEN** 返回 `Result{data:{job_id, status:"succeeded", asset:{type:"video", url:<本地转存 mp4 路径>}}}`，本地 `./data/assets/` 下存在对应 mp4 文件

#### Scenario: 火山余额不足
- **WHEN** Seedance 2.0 账号余额 < 200 元（或资源包不足）
- **THEN** `generation_jobs.status=failed`，`error` 记录上游错误，返回 `Result{code:500, msg:"upstream error"}`
