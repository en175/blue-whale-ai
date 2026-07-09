## Why

视频生成后端在 `volcengine-generation-mvp` 里已实现大半——火山 Ark SDK 调用（`VolcEngineService.createVideoTask`/`getVideoTask`）、异步编排（`GenerationJobService.createVideoJob`/`pollJob`）、定时轮询（`JobPoller` @Scheduled 5s）、状态机映射、视频转存（`AssetStorageService` 支持 `video/mp4`）、`generation_jobs`/`assets`/`generation_model_capability` 三表 type-aware、`POST /api/generation/video` + `GET /api/jobs/{id}` 入口——全部就绪。但 `schema.sql` 只有 4 条 `doubao-seedream-*` 图片种子数据、**零条 Seedance 视频模型行**，导致 `GET /api/generation/models?capability=video` 永远返空，视频链路无法端到端跑通。本次收尾这个缺口，把视频创建+查询接口真正跑通。

## What Changes

- **补 Seedance 视频模型种子数据**：`schema.sql` 在现有图片 INSERT 后追加 `capability_type='video'` 的 `doubao-seedance-2-0-260128`（及可选 1.5 Pro）行，`supported_sizes` 复用为视频 resolution（480p/720p/1080p）、`supported_aspect_ratios` 装视频 ratio，让 `GET /models?capability=video` 返回非空。
- **移除 `lastFrameUrl` 死字段**（**BREAKING**）：`VideoGenerateRequest.lastFrameUrl` + `GenerationJobService.buildVideoInput` 存入 input JSON，但 `VolcEngineService.createVideoTask` 签名只收单个首帧 `imageUrl`，尾帧从未传给火山——误导调用方以为支持首尾帧。MVP 删除该字段与存储逻辑，只保留首帧图生视频 + 文生视频，尾帧接通留后续。
- **端到端验证**：`curl POST /api/generation/video` 返 `jobId` → 轮询 `GET /api/jobs/{id}` 到 `succeeded` → mp4 转存落 `./data/assets/`。

## Capabilities

### New Capabilities
- `video-generation`: 火山引擎 Seedance 视频生成——Seedance 视频模型种子数据（`GET /models?capability=video` 非空）、文生/首帧图生视频异步提交、首帧角色约束（移除未接通的尾帧字段）、端到端跑通验收。建立在 `volcengine-generation-mvp` 已定义的异步轮询/状态机/转存基座之上，不重复其 `generation-service` 已覆盖的轮询簿记等通用行为。

### Modified Capabilities
<!-- main specs（openspec/specs/）当前为空，无已发布 capability 可 modify。视频需求作为新 capability video-generation 引入；volcengine-generation-mvp 的 generation-service delta 尚未 archive，两者互补不重叠。 -->

## Impact

- **代码**：`schema.sql` 加 1–2 条视频种子 INSERT；`VideoGenerateRequest` 删 `lastFrameUrl` 字段、`GenerationJobService.buildVideoInput` 不再存尾帧；相关单测（`GenerationJobServiceTest`、`VideoGenerateRequest` 相关）跟进断言。
- **对外接口**：`GET /api/generation/models?capability=video` 从空 → 返回 Seedance 模型；`POST /api/generation/video` 请求体移除 `last_frame_url`（**BREAKING**——当前仅前端 mock 调用，无线上消费方）。
- **依赖/运行环境**：无新增依赖；需 `ARK_API_KEY` + Seedance 账号余额（2.0 系列需余额 > 200 元或已购资源包）。
- **不碰**：取消任务 endpoint（火山 `running` 不可取消，价值低）、首尾帧/多模态参考（图/视频/音频 `role`）接通、视频能力校验（`createVideoJob` 透传 `modelId` 给火山即可跑）、`VideoGenerationProvider` 多厂商抽象、SSE/webhook 完整实现、`service_tier`/`priority`/`flex` 离线推理、前端 `VideoDockContent` 接通。
