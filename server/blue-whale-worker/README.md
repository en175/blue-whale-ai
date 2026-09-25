# worker-java

Blue-Whale 生成执行服务（Java）。**Java 直连 DB 全自主执行**：claim / fencing / lease / 终态写入都在本进程内（ADR-0084 修正一撤回「薄执行器」原案，「Java 做任务、TS 只发任务」）。
决策：[ADR-0084](../docs/adr/0084-generation-worker-java-runtime.md)；
行为契约（冻结基准）：[docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md](../docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md)。

技术栈：**Spring Boot 3.3.x + JDK 21（LTS）**（ADR-0084 决策 1）。

## 硬边界（违反即评审拦截项）

- **本进程实现 job 状态机**（claim / fencing / lease / 终态写入，契约 §3 为移植规格）——TS 只发任务、
  Java 做任务，交互面 = 数据库 + MQ，无 HTTP（ADR-0084 修正二）。guard fail 静默语义必须保留（契约 §3.1）。
- `cost_reservations` 记账不在实现范围（契约 §0 修正一，退役由 IKEF1K 承接）。
- 环境变量名沿用 TS worker 命名（同名对齐，契约 §5）。

## 启动契约（修正六：按 tag 开关与 group 后缀均已退役）

**服务启动即消费全部 6 个 tag**：`video` / `image` / `audio` / `media_extract` / `image_enhance` / `image_erase`（契约 §1 / §16）。不存在按 tag 的启停开关，也不存在「空配置只探活」形态：

- `WORKER_ENABLED_TAGS` 与 `WORKER_GROUP_SUFFIX` **已整体删除**（6 个 `*EnabledCondition`、`TagsEnabledConditions`、`StubDataSourceConfig`、`ReadyController.enabledTags` 一并退役）。
- **缺配置即启动失败**：`ROCKETMQ_ENDPOINTS`（MQ）+ `DATABASE_URL`（DB）+ `NEW_API_BASE_URL` / `NEW_API_UPSTREAM_KEY`（上游网关地址与调用凭证）+ `VOLC_*`（TOS）**四套配置**必须齐备，缺任一项在 bean 装配期抛错终止启动——不再退化为「不连 MQ、不连 DB，只起 `/ready`」。上游网关单列的理由：5 个网关客户端（audio / image / image_enhance / image_erase / video）全部无条件装配，其构造器统一经 `NewApiHttpSupport.normalizeBaseUrl`，baseUrl 空白即抛 `IllegalStateException`（「NEW_API_BASE_URL 未配置」）；同组另一项是项目级统一 key `NEW_API_UPSTREAM_KEY`（ADR-0114），由 `NewApiUpstreamConfig` 在装配期守卫——job 之内的调用用冻结在 `job.input.provider_credential` 的凭证，只有素材状态定时跟进（无 job 可借）需要这把部署注入的 key。
- consumer group 全为**字面量**、无 `-java` 后缀：`generation-video-worker` / `generation-image-worker` / `generation-audio-worker` / `generation-extract-worker` / `generation-image-enhance-worker` / `generation-image-erase-worker`。
- **topic / tag 不再是配置项，两侧都没有 env 覆盖**：`ROCKETMQ_TOPIC` 与 `ROCKETMQ_TAG` 已删除，六条路由由 `GenerationMqRoute` 枚举单处定义（tag 分别为 `video` / `image` / `audio` / `media_extract` / `image_enhance` / `image_erase`，恒等于 `generation_jobs.type`）。生产侧（`backend/libs/shared/generation/generation-queue.ts`）同样是编译期常量——topic 读 `queue.constants.ts` 的 `GENERATION_TASK_QUEUE`，tag 由各入队函数直接传各自常量，`loadRocketMqConfig` 只绑连接参数。这两个键在**两侧都无绑定目标**，部署环境里的残留值在两侧都被静默忽略：不存在任何运行时途径把消息投到旧名。
- `GET /ready` 只返回 `{"status":"ready"}`。

决策依据：ADR-0084「修正六」/ 契约 §16。

## 上线前检查清单（原子改名，部署前逐条确认）

topic `generation-video` → `generation-task`、tag `step` → `video`、group 去掉 `-java` 后缀是**原子切换**。**名字错配**的表现是静默的：进程健康、`/ready` 绿、消息无人消费或被旧进程抢走，什么都不报（这也是本清单存在的理由）；但**前置条件不满足是响亮失败**——新 topic 不存在时 worker 根本起不来。部署前必须确认：

- [ ] **broker 上已存在可路由的 topic `generation-task`**：这是本次改名新建的 topic，而 RocketMQ 的 `autoCreateTopicEnable` **只在生产者首次发送时**建 topic，消费者订阅不触发——worker 的第一次消费者 `startUp` 早于任何生产者发送，所以不预建就起不来。失败是**响亮**的：`No topic route info in name server for the topic: generation-task` → `Error starting ApplicationContext` → 进程退出。**创建途径取决于生产 broker**（控制台 / OpenAPI / `mqadmin updateTopic`）——本仓没有描述生产 RocketMQ 部署形态的文档，以实际为准。**建完后要确认路由可查**（例如 topic route 查询）再起 worker：本地实测 `mqadmin updateTopic` 之后存在约 30s 的 broker→namesrv 注册窗口，生产经 gRPC proxy 还可能另有缓存——所以以「能查到路由」为准，别照抄固定秒数。
- [ ] **新 worker 启动打出六条订阅日志**（唯一的正面证据，其余各项都只能证明「没有障碍」）：每个消费者启动时由 `AbstractGenerationConsumer.start()` 打一行 `MQ 消费者已启动: topic=generation-task tag=<tag> group=<group> concurrency=<n>`——确认六条，`tag` 分别是 `video` / `image` / `audio` / `media_extract` / `image_enhance` / `image_erase`（日志里数 `MQ 消费者已启动:` 即可）。
- [ ] **旧 TS worker 容器已停**：Java 与旧 TS worker 若落入同名 group，消息会被分流给旧进程。确认方式：部署机上 `docker ps` 无旧 generation-worker 容器（其历史形态是 `restart: unless-stopped` 的 compose 容器）。

错配的后果都是**静默的**：worker 看起来完全正常，`/ready` 返回 `{"status":"ready"}`，但消息可能无人消费、或被打进旧进程的 group——所以上面第二条（六条启动日志）才是正面的「订阅真的对了」证据。生产侧（`backend`）也不再读 `ROCKETMQ_TOPIC` / `ROCKETMQ_TAG`，残留这两个键不会再把生产者指回旧名。

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
| `DATABASE_URL` | 是 | `mysql://user:pass@host:port/db` | — |
| `ROCKETMQ_ENDPOINTS` | 是 | gRPC proxy 端点 | — |
| `ROCKETMQ_ACCESS_KEY` | 否 | RocketMQ 认证 | — |
| `ROCKETMQ_SECRET_KEY` | 否 | RocketMQ 认证 | — |
| `ROCKETMQ_SSL_ENABLED` | 否 | 启用 SSL | `false` |
| `VOLC_ACCESS_KEY_ID` | 是 | TOS 认证 | — |
| `VOLC_SECRET_ACCESS_KEY` | 是 | TOS 认证 | — |
| `VOLC_TOS_ENDPOINT` | 是 | TOS 端点 | — |
| `VOLC_TOS_BUCKET` | 是 | TOS 桶 | — |
| `VOLC_TOS_REGION` | 是 | TOS 区域 | — |
| `FFMPEG_PATH` | 否 | ffmpeg 二进制路径（Dockerfile 须 ship 一个） | `ffmpeg`（PATH 查找） |
| `TOS_CONNECT_TIMEOUT_MS` | 否 | TOS SDK 建链超时（毫秒） | `30000` |
| `TOS_READ_TIMEOUT_MS` | 否 | TOS SDK 读超时（毫秒）——下载源视频中途超时会判 `video_download_failed` | `300000` |
| `TOS_WRITE_TIMEOUT_MS` | 否 | TOS SDK 写超时（毫秒） | `300000` |
| `MEDIA_EXTRACT_CONCURRENCY` | 否 | 提取并发度（1-16） | `2` |
| `GENERATION_WORKER_PORT` | 否 | HTTP 端口 | `4002` |
| `NEW_API_BASE_URL` | 是 | new-api 网关地址 | — |
| `NEW_API_UPSTREAM_KEY` | 是 | 上游调用凭证：项目级统一 key（ADR-0114）。素材状态定时跟进没有 job 凭证可借，用它代打网关 | — |
| `NEW_API_AUDIO_TIMEOUT_MS` | 否 | 音频 TTS 超时（毫秒） | `30000` |
| `AUDIO_CONCURRENCY` | 否 | 音频并发度（1-64） | `5` |
| `IMAGE_CONCURRENCY` | 否 | 图片并发度（1-64） | `20` |
| `NEW_API_IMAGE_TIMEOUT_MS` | 否 | 图片生成超时（毫秒） | `60000` |
| `IMAGE_ENHANCE_CONCURRENCY` | 否 | 高清放大并发度（1-64，契约 §14 / IKGM9D） | `5` |
| `NEW_API_IMAGE_ENHANCE_TIMEOUT_MS` | 否 | MediaKit 高清放大同步调用超时（毫秒）；claim 租约 420s 须大于它+转存余量 | `300000` |
| `IMAGE_ERASE_CONCURRENCY` | 否 | 图片擦除并发度（1-64，契约 §15 / IKGOT6） | `5` |
| `NEW_API_IMAGE_ERASE_TIMEOUT_MS` | 否 | MediaKit 图片擦除同步调用超时（毫秒）；claim 租约 420s 须大于它+转存余量 | `300000` |

### 启动行为

- **无条件启动全部 6 个 tag 的消费者**（修正六：无按 tag 开关；`WORKER_ENABLED_TAGS` 已删除）。
- 必须配齐 `DATABASE_URL` + `ROCKETMQ_ENDPOINTS` + `NEW_API_BASE_URL` + `NEW_API_UPSTREAM_KEY` + `VOLC_*` 5 个 TOS env（共四套配置），缺一在 bean 装配期抛错终止启动（不再有「空 tags → 不连 MQ、不连 DB，只起 `/ready`」形态）。
- ffmpeg 运行时依赖：`FFMPEG_PATH` 指向的二进制必须存在（Dockerfile 已 apt install）。

### Docker 部署

```bash
# 构建（多阶段 Dockerfile：镜像内完成 mvn package，无需外部预构建 jar）
docker build -t worker-java .
docker run -e DATABASE_URL=mysql://... \
           -e ROCKETMQ_ENDPOINTS=... \
           -e NEW_API_BASE_URL=... \
           -e NEW_API_UPSTREAM_KEY=... \
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
├─ config(*Config/*Properties) + web(*Controller)
```

## 现状进度（IKENZZZ / IKEL4L / IKEL4N / IKEL69）

> 本节是各刀**落地当时**的历史记录。其中 `*EnabledCondition` / `StubDataSourceConfig` / `group=...+suffix` / `tag=step` / `GENERATION_CREDENTIAL_SECRET` 等命名与机制已随修正六 / 修正五退役，现行约定见上「启动契约」节。

- [x] 工程骨架 / 配置绑定 / `/ready` / 消息契约测试（IKEL4L）
- [x] **Job 状态机 extract 子集**（IKENZZZ）：
  - [x] `DataSourceConfig`：DATABASE_URL 解析（mysql:// → jdbc:mysql://，含特殊字符）+ HikariCP 保守池（max 20）
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
    - features JSON 解析（imageReferenceMax / image_reference_max）
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
    - delay 下限 1000ms（GENERATION_MIN_DELAY_MS）
  - [x] processor `VideoJobProcessor`：完整视频编排（video-job-runner.ts:195-376 runVideoJobStep）
    - 多步状态机：每步 = 一次 MQ 消费（submit 或 poll）
    - cancel-before-dispatch：cancelRequested + providerTaskId==null → cancelVideoBeforeDispatch
    - submit 阶段：buildSubmitRequest → submit → markProviderSubmitted → scheduleNext(5s)
    - IKEA26 parent-reuse 防双扣：retry job 先查父 task → SUCCESS → publish without submit
    - poll 阶段：transient → rescheduleProviderPoll(5s); ≥720 → provider_timeout
    - succeeded+URL → relay → publishVideoResult
    - 参考校验：video-reference-validation.ts 完整移植（Seedance 2.0 约束）
    - 修正一：cost_reservations / actual_amount_fen / release_note 整体省略
  - [x] consumer `VideoConsumer`：SEQUENTIAL 派发（无 Semaphore，for-await each）
    - tag=step, digitGuard=false（视频 TS 仅检查 typeof jobId === "string"）
    - group=generation-video-worker+suffix
  - [x] service `JobStateMachineService` 扩展：
    - `claimVideoJobById` → Optional<ClaimedVideoJobDto>（套 source 白名单 4 源 + parentProviderTaskId join）
    - `markProviderSubmitted` → boolean（provider_task_id + 释放租约 + next+5s）
    - `rescheduleProviderPoll` → boolean（poll_count+1 + 释放租约 + next+5s）
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
| `NEW_API_BASE_URL` | 是 | new-api 网关地址 | — |

- `VIDEO_POLL_INTERVAL_MS`（`5000`）与 `MAX_VIDEO_POLLS`（`720`）**不是环境变量**，是 `VideoJobProcessor` 内的 Java 常量（`public static final`），运行时不可覆盖。
- `WORKER_ENABLED_TAGS` / `WORKER_GROUP_SUFFIX` 已删除（修正六）；`ROCKETMQ_TOPIC` / `ROCKETMQ_TAG` 已删除（改为 `GenerationMqRoute` 枚举，见「启动契约」节）；`GENERATION_CREDENTIAL_SECRET` 已随凭证去密删除（契约 修正五）。
