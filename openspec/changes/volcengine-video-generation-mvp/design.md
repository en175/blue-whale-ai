## Context

视频生成后端在 `volcengine-generation-mvp` 里已搭好完整基座：

- **火山调用层** `VolcEngineService.createVideoTask(model,prompt,imageUrl,ratio,resolution,duration)` → 返火山 task id；`getVideoTask(taskId)` → `VideoTaskResult{status,videoUrl,errorCode,errorMsg}`。用 Ark SDK（`createContentGenerationTask`/`getContentGenerationTask`），`base-url=https://ark.cn-beijing.volces.com/api/v3` + `api-key` 图片视频共用，已就绪。
- **异步编排** `GenerationJobService.createVideoJob`（insert queued → 同步调 createVideoTask → update processing+providerTaskId+nextPollAt）+ `pollJob`（`mapStatus` 映射火山 `queued/running/succeeded/failed/expired` → 本地，succeeded 时 `downloadAndStore video/mp4`）。
- **定时轮询** `JobPoller` `@Scheduled fixedDelay=5000` 扫 `status='processing' AND next_poll_at<=NOW()`。
- **三表 type-aware**：`generation_jobs.type`（image/video）、`assets.type`、`generation_model_capability.capability_type`。无需迁移。
- **HTTP 入口** `POST /api/generation/video`（`GenerationController.java:57`）+ `GET /api/jobs/{id}`（`JobController.java:53`）。

**缺口**：`schema.sql` 只有 4 条 `doubao-seedream-*` 图片种子，零 Seedance 视频模型 → `GET /models?capability=video` 空；`VideoGenerateRequest.lastFrameUrl` 是死字段（DTO + `buildVideoInput` 有，但 `createVideoTask` 只收单首帧 `imageUrl`，尾帧从未传火山）。

**约束**：`ARK_API_KEY` 环境变量；Seedance 2.0 余额 > 200 元或已购资源包；密钥不进仓（hook 拦 `.env`）；本次后端 MVP，前端 `VideoDockContent` 接通留后续 change。

## Goals / Non-Goals

**Goals:**
- `GET /api/generation/models?capability=video` 返回 Seedance 视频模型（非空）。
- `POST /api/generation/video` 文生/首帧图生视频跑通：返 `jobId` → 轮询 `succeeded` → mp4 落 `./data/assets/`。
- 移除 `lastFrameUrl` 死字段，消除"支持尾帧"的误导。

**Non-Goals:**
- 取消任务 endpoint（火山 `running` 不可取消，价值低）。
- 首尾帧/多模态参考接通（`last_frame`/`reference_video`/`reference_audio` role）。
- 视频能力校验（`createVideoJob` 透传 `modelId` 给火山即可跑，火山自校验）。
- `VideoGenerationProvider` 多厂商抽象。
- SSE/webhook 完整实现（沿用既有预留）。
- 前端 `VideoDockContent` 接通（独立前端 change）。

## Decisions

1. **复用 `generation_model_capability` 表存视频模型（非新表）**：`capability_type='video'`，`supported_sizes` 复用为视频 resolution 选项（`[{id:"720p",label:"720P",api_value:"720p"}]`），`supported_aspect_ratios` 装 ratio，`features` 关图片专有开关。理由：表已 type-aware（`idx_capability_type_enabled` 索引），`ImageModelCapabilityResponse` 统一返，零 schema 迁移、零新 endpoint。替代：新建 `video_model` 表（被否——重复结构 + 前端要两个 endpoint + `GET /models` 要分叉）。**权衡**：`supported_sizes` 语义对视频 = resolution 而非像素，前端 `ImageModelSettingsPopover` 展示需适配（后续前端 change）。
2. **继续用 Ark SDK 不换 REST**：`createContentGenerationTask`/`getContentGenerationTask` 已就绪。用户给的 4 份 REST 文档（`docs/agent/视频生成api`）作**契约参考**（参数 `content[]`/`role`、状态机、取消语义、`video_url` 24h 过期），不手写 HTTP。理由：SDK 封装 Bearer 鉴权 + 连接池 + 重试；图片已验证同 SDK 路径。替代：直接 `RestClient` 调 REST（被否——签名/重试/连接池自写，与图片割裂；文档亦未明写 API Key header 名，SDK 内部处理免去猜测）。
3. **移除 `lastFrameUrl` 死字段而非接通尾帧**：DTO 删字段 + `buildVideoInput` 不再存尾帧。理由：尾帧未接通是误导，MVP 只要首帧 + 文生；接通尾帧需改 `createVideoTask` 签名 + 构造两个 `image_url`（`first_frame`/`last_frame`）配对校验，是独立增强。替代：接通尾帧（被否——超最小 MVP，Seedance 尾帧需首+尾两张图配对，校验复杂）。
4. **视频不做能力校验（透传 `modelId`）**：`createVideoJob` 不查 `capabilityMapper`，直接把请求 `modelId` 透传 `createVideoTask`。理由：火山自身校验 model 合法性，前端 `GET /models` 已限定可选模型；MVP 单厂商。替代：加 `selectEnabledByModelId`（被否——G2，与图片 `createImageJob` 对齐是质量加固，留后续）。
5. **种子模型选 `doubao-seedance-2-0-260128`**：文档示例 + 最强能力（多模态/有声）。resolution 默认 `720p`（2.0 系列默认），ratio 默认 `16:9`，duration 5s。可选追加 `doubao-seedance-1-5-Pro-251215` 作对比。
6. **resolution 枚举 MVP 取 480p/720p/1080p**：不含 4k（2.0 支持 4k 但 10bit/H.265 转存成本高，MVP 不需要）。

## Risks / Trade-offs

- **[Seedance 2.0 余额 > 200 元]** → dev 验证需账号余额；可先用文生视频（无参考图）降低单次成本，或临时切 1.5 Pro。
- **[`supported_sizes` 语义复用为 resolution]** → 前端把 size 当像素，视频展示需适配 → 标记后续前端 change；本次后端接口返非空即达标。
- **[`last_frame_url` 移除 BREAKING]** → 当前无线上消费方（前端视频 mock），影响可控；Spring Boot Jackson 默认忽略未知字段，历史请求体不报错。
- **[`createVideoTask` 仅首帧]** → 尾帧需求出现时需扩签名 → spec/design 已标注，后续 change 接通首尾帧。
- **[视频 URL 24h 过期]** → 已由 `pollJob` 的 `downloadAndStore` 兜底转存，非本次新增风险。

## Migration Plan

1. `schema.sql` 追加 Seedance `capability_type='video'` INSERT（resolution/ratio/features 按 decision 1/5/6）。
2. `VideoGenerateRequest` 删 `lastFrameUrl` 字段；`GenerationJobService.buildVideoInput` 去尾帧存储逻辑。
3. 测试跟进：`GenerationJobServiceTest` 视频路径断言、`VolcEngineServiceTest` 视频方法、`GenerationControllerTest`/`JobControllerTest` 视频 endpoint。
4. 起服务 + 配 `ARK_API_KEY` → `curl POST /api/generation/video` → 轮询 `GET /api/jobs/{id}` 到 `succeeded` + 确认 mp4 落 `./data/assets/`。
5. **Rollback**：单 change `git revert`；schema 仅新增 INSERT 不破坏现有；删字段 BREAKING 仅影响 mock 前端。

## Open Questions

- 视频种子 `supported_sizes` 的 resolution 枚举是否含 4k？（暂倾向 480p/720p/1080p，4k 转存成本高）
- `last_frame_url` 移除后是否同步前端 `VideoDockContent`（若有尾帧输入控件）？本次后端不管，前端 change 跟进。
- `duration` 是否暴露前端控件？MVP 后端透传默认 5s，前端控件后续。
- 是否追加 `doubao-seedance-1-5-Pro` 作第二视频模型对比？MVP 单模型足够，1.5 Pro 留可选。
