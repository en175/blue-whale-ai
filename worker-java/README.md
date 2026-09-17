# worker-java

Blue-Whale 生成执行服务（Java 薄执行器）。决策：[ADR-0084](../docs/adr/0084-generation-worker-java-runtime.md)；
行为契约（冻结基准）：[docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md](../docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md)。

技术栈：**Spring Boot 3.3.x + JDK 21（LTS）**（ADR-0084 决策 1）。

## 硬边界（违反即评审拦截项）

- **本进程不实现任何 job 状态机**。claim / fencing / lease / complete / fail 一律走
  backend internal endpoints（契约 §4）。guard fail 静默语义必须保留（契约 §3.1）。
- `cost_reservations` 记账不在实现范围（契约 §0 修正一，退役由 IKEF1K 承接）。
- 环境变量名与 TS worker 完全同名（灰度期一套部署 env 喂两个栈）。

## 灰度开关

`WORKER_ENABLED_TAGS` 逗号列表（`step,image,audio,media_extract,image_enhance`），默认为空 = 不消费。`image_enhance`（契约 §14 / IKGM8U）常量已冻结，消费者与处理器由 IKGM9D 注册。
一刀切换 = TS 侧停该 tag + 此列表加该 tag；consumer group 后缀 `-java`（双组并存即回滚位）。

## 构建 / 运行

```bash
mvn -B test          # 契约测试（GenerationMessageContractTest 是契约 §1 的可执行切片）
mvn -B package       # 本机裸跑才需要；出镜像走 docker build（多阶段内置 mvn）
java -jar target/worker-java-0.0.1-SNAPSHOT.jar
curl localhost:4002/ready
```

## 刀①运行手册（media_extract）

### 环境变量清单

| 变量名 | 必需 | 说明 | 默认值 |
|---|---|---|---|
| `WORKER_ENABLED_TAGS` | 灰度控制 | 逗号分隔启用 tag（`media_extract`） | 空 = 不消费 |
| `WORKER_GROUP_SUFFIX` | consumer group | consumer group 后缀 | `-java` |
| `DATABASE_URL` | 是（media_extract 启用时） | `mysql://user:pass@host:port/db` | — |
| `ROCKETMQ_ENDPOINTS` | 是（media_extract 启用时） | gRPC proxy 端点 | — |
| `ROCKETMQ_ACCESS_KEY` | 否 | RocketMQ 认证 | — |
| `ROCKETMQ_SECRET_KEY` | 否 | RocketMQ 认证 | — |
| `ROCKETMQ_SSL_ENABLED` | 否 | 启用 SSL | `false` |
| `ROCKETMQ_TOPIC` | 否 | MQ topic | `generation-video` |
| `VOLC_ACCESS_KEY_ID` | 是（media_extract 启用时） | TOS 认证 | — |
| `VOLC_SECRET_ACCESS_KEY` | 是（media_extract 启用时） | TOS 认证 | — |
| `VOLC_TOS_ENDPOINT` | 是（media_extract 启用时） | TOS 端点 | — |
| `VOLC_TOS_BUCKET` | 是（media_extract 启用时） | TOS 桶 | — |
| `VOLC_TOS_REGION` | 是（media_extract 启用时） | TOS 区域 | — |
| `FFMPEG_PATH` | 否 | ffmpeg 二进制路径（Dockerfile 须 ship 一个） | `ffmpeg`（PATH 查找） |
| `TOS_CONNECT_TIMEOUT_MS` | 否 | TOS SDK 建链超时（毫秒） | `30000` |
| `TOS_READ_TIMEOUT_MS` | 否 | TOS SDK 读超时（毫秒）——下载源视频中途超时会判 `video_download_failed` | `300000` |
| `TOS_WRITE_TIMEOUT_MS` | 否 | TOS SDK 写超时（毫秒） | `300000` |
| `MEDIA_EXTRACT_CONCURRENCY` | 否 | 提取并发度（1-16） | `2` |
| `GENERATION_WORKER_PORT` | 否 | HTTP 端口 | `4002` |
| `NEW_API_BASE_URL` | 是（audio 启用时） | new-api 网关地址 | — |
| `GENERATION_CREDENTIAL_SECRET` | 是（audio 启用时） | 凭证密封密钥（≥16 字符） | — |
| `NEW_API_AUDIO_TIMEOUT_MS` | 否 | 音频 TTS 超时（毫秒） | `30000` |
| `AUDIO_CONCURRENCY` | 否 | 音频并发度（1-64） | `5` |
| `IMAGE_CONCURRENCY` | 否 | 图片并发度（1-64） | `20` |
| `NEW_API_IMAGE_TIMEOUT_MS` | 否 | 图片生成超时（毫秒） | `60000` |

### 启动行为

- `WORKER_ENABLED_TAGS` 为空 → 不连 MQ、不连 DB，只起 `/ready` 端点。
- `WORKER_ENABLED_TAGS` 含 `media_extract` → 必须配齐 `DATABASE_URL` + `ROCKETMQ_ENDPOINTS` + `VOLC_*` 5 个 TOS env，缺一启动失败。
- ffmpeg 运行时依赖：`FFMPEG_PATH` 指向的二进制必须存在（Dockerfile 已 apt install）。

### Docker 部署

```bash
# 构建（多阶段 Dockerfile：镜像内完成 mvn package，无需外部预构建 jar）
docker build -t worker-java .
docker run -e WORKER_ENABLED_TAGS=media_extract \
           -e DATABASE_URL=mysql://... \
           -e ROCKETMQ_ENDPOINTS=... \
           -e VOLC_ACCESS_KEY_ID=... \
           -e VOLC_SECRET_ACCESS_KEY=... \
           -e VOLC_TOS_ENDPOINT=... \
           -e VOLC_TOS_BUCKET=... \
           -e VOLC_TOS_REGION=... \
           -p 4002:4002 worker-java
```

## 包结构（DDD 分层，包=统一后缀）

```
worker/
├─ application/{consumer(*Consumer), processor(*Processor), service(*Service)}
├─ domain/{entity(*Entity), dto(*Dto), error(*Error)}
├─ infrastructure/{mapper(*Mapper), mq, media(*Extractor), storage(*Storage)}
├─ config(*Config/*Properties/*Condition) + web(*Controller)
```

## 现状进度（IKENZZZ / IKEL4L / IKEL4N / IKEL69）

- [x] 工程骨架 / 配置绑定 / `/ready` / 消息契约测试（IKEL4L）
- [x] **Job 状态机 extract 子集**（IKENZZZ）：
  - [x] `DataSourceConfig`：DATABASE_URL 解析（mysql:// → jdbc:mysql://，含特殊字符）+ HikariCP 保守池（max 10）
  - [x] persistence 包：`GenerationJob` / `Asset` / `GenerationJobLog` / `ProjectEvent` + 对应 Mapper
    - SQL 逐字移植自 TS Prisma 调用，注释标注 TS 源码行号
    - CAS updates 返回 int，service 层映射 0→false
  - [x] service `JobStateMachineService`（@Service，单例权威）：
    - `claimMediaExtract(jobId, workerId)` → Optional<ClaimedMediaExtractJob>
    - `updateMediaExtractProgress` → boolean：钳制 0-99 + 续租（lease≈now+120s）
    - `publishMediaExtractResult` → boolean（@Transactional）
    - `failMediaExtractJob` → boolean（@Transactional）
  - [x] ~~service `CanvasNodeService`~~ 已删除（IKFS5W）：画布改由前端写，worker 不再回写 canvas
- [x] **media_extract 执行路径**（IKEL4N 刀①）：
  - [x] mq `AbstractGenerationConsumer`：TEMPLATE METHOD（start/stop lifecycle, receive loop, poison ack, Semaphore 并发）
  - [x] mq `MediaExtractConsumer`：tag=media_extract, digitGuard=false
  - [x] processor `JobProcessor` STRATEGY 接口 + `MediaExtractJobProcessor` 完整编排
  - [x] media `FfmpegExtractor`：ProcessBuilder 逐字参数、Duration regex、out_time_ms 进度、无超时
  - [x] storage `TosMediaService`：SDK getObject / putObject / putObjectAcl（DEVIATION 注释）
  - [x] config `MediaExtractEnabledCondition`：@Conditional 按 tag 启停
  - [x] config `StubDataSourceConfig`：未启用时的空 DataSource 回退
  - [x] Dockerfile：eclipse-temurin:21-jre + ffmpeg apt install
- [x] **audio 执行路径**（IKEL69 刀②）：
  - [x] dto `ClaimedJobDto`：snake_case 投影（types.ts:3-16，音频/图片共用）
  - [x] error `GenerationError`：错误码常量（error-codes.ts:20-70）
  - [x] error `AudioProviderError`：音频供应商错误（含 code）
  - [x] entity `GenerationOutputSlotEntity` + mapper：槽位聚合（settle-ops.ts:79-121）
  - [x] credential `GenerationCredentialService`：AES-256-GCM 解封（generation-credential.ts:52-70）
    - 格式：`v1.<nonce-b64url>.<tag-b64url>.<ciphertext-b64url>`
    - 密钥：SHA-256(secret) → 32 bytes
  - [x] audio `NewApiAudioClient`：OkHttp TTS 客户端（new-api-audio-provider.ts:55-190）
    - POST /v1/audio/speech + Bearer + X-Trace-Id + X-Client-System: bluewhale（ADR-0080）
    - 错误分类优先级：content > quota > provider_failed（§5 Chinese regexes）
  - [x] service `JobStateMachineService` 扩展：
    - `claimAudioJobById` → Optional<ClaimedJobDto>（不套 source 白名单，IKCR78）
    - `completeJob` → boolean：fence guard + 槽位聚合 + events（**修正一：无 cost_reservations**）
    - `failJob` → boolean：fence guard + pending slots→failed + log + events（**修正一：无 releaseReservation**）
    - `createAsset` → String|null：fence guard + asset insert + asset.created event
    - `appendLog` → job log helper
  - [x] service `AssetSourceService` 扩展：`resolveInputAssets`（IKDD4Z linked 分支 REQUIRED）
  - [x] processor `AudioJobProcessor`：完整音频编排（generation-worker.ts:367-446）
    - claim → 解封凭证 → 校验输入 → 解析参考素材 → TTS → 转存 → createAsset → completeJob
    - resolveAudioSeedReferences：asset_id → resolveInputAssets → audio/image 过滤 → URL 去重
    - data-direct 转存：mime 恒 audio/mpeg；TOS 未配置 → 硬失败
  - [x] consumer `AudioConsumer`：tag=audio, digitGuard=true, group=generation-audio-worker+suffix
  - [x] config `AudioEnabledCondition`：@Conditional 按 tag 启停
  - [x] config `RocketMqConfig` 扩展：audio consumer bean（Semaphore AUDIO_CONCURRENCY default 5）
- [x] **image 执行路径**（IKELJA 刀③）：
  - [x] error `ImageProviderError`：图片供应商错误（含 code，image-provider.ts:41-49）
  - [x] entity `GenerationModelCapabilityEntity` + mapper：模型能力行（asset-ops.ts:103-149）
  - [x] gateway `NewApiErrorClassifier`：共享错误分类（从 NewApiAudioClient 提取，content > quota > provider_failed）
  - [x] gateway `NewApiImageClient`：OkHttp 图片生成客户端（new-api-generation-ops.ts:22-175）
    - 端点选择：有参考图 → POST /v1/images/edits（multipart）；无 → POST /v1/images/generations（JSON）
    - 请求头：Bearer + X-Trace-Id + X-Client-System: bluewhale（ADR-0080）
    - 响应解析：{data:[{url}]}（parseImageList :333-344）
  - [x] processor `ImageChannelMapper`：渠道映射工具（image-channel-parser.ts + seedream-image-size.ts）
    - seedream 代码表（doubao-seedream-* 族模型尺寸查算）
    - gpt 矩阵查表（matrix[sizeId][ratioId]，大小写不敏感）
    - banana 双映射（quality × size）
    - supported_sizes 匹配（id / api_value / apiValue）
    - features JSON 解析（maxReferenceImages / max_reference_images）
  - [x] processor `ImageJobProcessor`：完整图片编排（generation-worker.ts:499-685）
    - claim → 校验输入 → 查能力 → 校验参考图 → 解封凭证 → 渠道映射 →
      调 provider（批量循环）→ 转存 → createAsset 循环 → completeJob
    - input_asset_ids（IKA72G）→ 参考图字段（与视频 reference_asset_ids 不同）
    - 瞬态重试：provider_failed + retry_count<3 → requeueImageJobForRetry
      退避 30/60/120s 封顶 300s（caller 计算），return WITHOUT ack-fail
    - persistProviderImage：url→fetch→ImageIO 宽高→TOS 上传
      契约 §8：ImageIO 解析失败静默 null，资产照常落库（webp 不支持但等价标准满足）
    - TOS 未配置 → 降级直存 URL（storageKey=null，generation-worker.ts:752-761）
    - **修正三**：ARK provider（ark-image-provider.ts）不移植——new-api 网关是唯一 provider
      - 不引入 GENERATION_PROVIDER env / VOLC_ARK_* 配置
      - 不实现 ark-image-provider.ts 的任何逻辑
  - [x] service `JobStateMachineService` 扩展：
    - `claimImageJobById` → Optional<ClaimedJobDto>（**套 source 白名单**：bottom_dock/plan_apply/storyboard_preview）
    - `requeueImageJobForRetry` → boolean（WHERE status='processing'，无 fence；.catch→false）
    - `syncRecordSummary`：completeJob/failJob 事务内回写 scene_card_generation_records.summary_status
      （internals.ts:21-62 逐字移植；resolveLogicalSlots + aggregateSlotStatus 纯函数）
    - `syncStoryboardPreviewSummary`：completeJob/failJob 事务内回写 storyboard_previews.summary_status
      （internals.ts:67-113 逐字移植；按 first_generation_job_id 反查）
  - [x] entity `SceneCardGenerationRecordEntity` + mapper（syncRecordSummary 用）
  - [x] entity `StoryboardPreviewEntity` + mapper（syncStoryboardPreviewSummary 用）
  - [x] consumer `ImageConsumer`：tag=image, digitGuard=true, group=generation-image-worker+suffix
  - [x] config `ImageEnabledCondition`：@Conditional 按 tag 启停
  - [x] config `RocketMqConfig` 扩展：image consumer bean（Semaphore IMAGE_CONCURRENCY default 20，1-64）
  - [x] storage `TosMediaStorage` 扩展：`uploadImageBytes`（uploads/{userId}/image/{uuid}.{ext}）
- [x] tests（**171 + 新增 47 = 218 全绿基线**）：
  - 刀①② 已有 109 全绿
  - 刀③ 新增 62 = 171 全绿
  - 刀④ 新增 47：video consumer template 6 + processor 22（G49-G70：cancel/submit/poll/
    parent-reuse/transient判定/参考校验边界/尺寸换算/Seedance2识别）
    + producer 4（delay 钳制 + message shape）
    + reference boundary 9 + dimensions 5 + seedance2 4 + validateReferences 2 = **47**
- [x] **video 执行路径**（IKEL9A 刀④）：
  - [x] dto `ClaimedVideoJobDto`：视频专用投影（pollCount/progress/providerTaskId/parentProviderTaskId）
  - [x] error `VideoProviderError`：视频供应商错误（含 code，video-job-runner.ts:185-193）
  - [x] error `VideoInputError`：视频输入校验错误（含 code）
  - [x] gateway `NewApiVideoClient`：OkHttp 视频生成客户端
    - submit: POST /v1/video/generations（30s 超时，metadata.content 数组）
    - poll: GET /v1/video/generations/{taskId}（10s 超时）
    - 状态映射：success/succeeded/completed → succeeded; failed/failure/error/cancelled → failed
    - 错误分类复用 NewApiErrorClassifier（content > quota > provider_failed）
  - [x] storage `TosVideoMediaRelay`：视频转存（fetch → TOS PUT → public-read）
    - key: generated/{userId}/video/{uuid}.{ext}（webm/mov/mp4）
    - 上限 200MB
  - [x] mq `GenerationMessageProducer`：MQ 生产者端口（视频 scheduleNext 自投延迟消息）
  - [x] mq `RocketMqGenerationMessageProducer`：rocketmq-client-java Producer 实现
    - delay 下限 1000ms（VIDEO_MIN_DELAY_MS）
  - [x] processor `VideoJobProcessor`：完整视频编排（video-job-runner.ts:195-376 runVideoJobStep）
    - 多步状态机：每步 = 一次 MQ 消费（submit 或 poll）
    - cancel-before-dispatch：cancelRequested + providerTaskId==null → cancelVideoBeforeDispatch
    - submit 阶段：buildSubmitRequest → submit → markVideoSubmitted → scheduleNext(5s)
    - IKEA26 parent-reuse 防双扣：retry job 先查父 task → SUCCESS → publish without submit
    - poll 阶段：transient → rescheduleVideoPoll(5s); ≥720 → provider_timeout
    - succeeded+URL → relay → publishVideoResult
    - 参考校验：video-reference-validation.ts 完整移植（Seedance 2.0 约束）
    - 修正一：cost_reservations / actual_amount_fen / release_note 整体省略
  - [x] consumer `VideoConsumer`：SEQUENTIAL 派发（无 Semaphore，for-await each）
    - tag=step, digitGuard=false（视频 TS 仅检查 typeof jobId === "string"）
    - group=generation-video-worker+suffix
  - [x] service `JobStateMachineService` 扩展：
    - `claimVideoJobById` → Optional<ClaimedVideoJobDto>（套 source 白名单 4 源 + parentProviderTaskId join）
    - `markVideoSubmitted` → boolean（provider_task_id + 释放租约 + next+5s）
    - `rescheduleVideoPoll` → boolean（poll_count+1 + 释放租约 + next+5s）
    - `publishVideoResult` → boolean（@Transactional：guard + asset + slots + events）
    - `cancelVideoBeforeDispatch` → boolean（WHERE provider_task_id IS NULL + cancelled + log）
  - [x] config `VideoEnabledCondition`：@Conditional 按 tag "step" 启停
  - [x] config `RocketMqConfig` 扩展：video consumer + producer + client + relay beans
  - [x] mapper `GenerationJobMapper` 扩展：视频 claim/submit/reschedule/publish/cancel SQL
- [ ] backend internal endpoints 客户端（待 IKEL4J 交付端点契约 §4 定稿）

### 刀②③④ 上线前提

**IKEF1K（cost_reservations 整体下线）+ IKEPGW 必须已合入 master**。
修正一要求 Java 侧不实现任何 `cost_reservations` 逻辑；若 IKEF1K 未上线，TS 侧仍有结算路径，Java 写入会产生账不平。

刀④ 额外：无（视频路径不引入新的外部依赖）。

### 刀④ 环境变量清单

| 变量名 | 必需 | 说明 | 默认值 |
|---|---|---|---|
| `WORKER_ENABLED_TAGS` | 灰度控制 | 逗号分隔启用 tag（`step`） | 空 = 不消费 |
| `ROCKETMQ_TAG` | 否 | 视频 MQ tag | `step` |
| `NEW_API_BASE_URL` | 是（step 启用时） | new-api 网关地址 | — |
| `GENERATION_CREDENTIAL_SECRET` | 是（step 启用时） | 凭证密封密钥（≥16 字符） | — |
| `VIDEO_POLL_INTERVAL_MS` | 否 | 视频轮询间隔（ms） | `5000` |
| `MAX_VIDEO_POLLS` | 否 | 视频轮询上限 | `720` |
