# worker-java 迁移契约（IKEL4A / ADR-0084）

- **状态**：**已冻结 + 修正一 + 修正二 + 修正三 + 修正四 + 修正五 + 修正六**（修正一：cost_reservations 记账移出范围；修正二：架构改为 Java 直连 DB——**TS 只发任务，Java 做任务，交互面 = 数据库 + MQ**；修正三：ARK 直连整体下线（2026-09-10）；修正四：2026-09-12 代码整备批次成文编码规范 §13 与扩展契约附录 C，不改写 §0–§9 功能语义；修正五：2026-09-12 凭证去密——Redis 会话 sk 与 job.input.provider_credential 均改明文，删除 AES-GCM 密封/解封链路与 `GENERATION_CREDENTIAL_SECRET` 依赖；修正六：2026-09-18 退役标签开关与命名对齐（详见 §16）——删除 `WORKER_ENABLED_TAGS` / `WORKER_GROUP_SUFFIX`，服务启动即消费全部 6 个 tag，topic `generation-video`→`generation-task`、tag `step`→`video`；冻结增量 §14：2026-09-17 新增第 5 个生成类型 image_enhance 高清放大的跨进程字段冻结，IKGM8U；冻结增量 §15：2026-09-18 新增第 6 个生成类型 image_erase 图片擦除的跨进程字段冻结，IKGOT3；冻结增量 §17：2026-09-19 新增第 8 个生成类型 video_subtitle_erase 视频智能去字幕的跨进程字段冻结，IKGZ7Z——第 7 个 image_outpaint 契约独立在 `backend/libs/contracts/image-outpaint.ts`，未单开本文章节）。本文件是 TS（NestJS backend）与 Java（worker-java）双端对账唯一基准；冻结后改动须双端同步评审。

## 0. 修正一（2026-09-10）：cost_reservations 记账移出迁移范围（工单 IKEF1K）
- 决策：`cost_reservations` 预扣/结算/release 记账**整体下线**（IKEF1K），**Java 侧一概不实现**。本修正覆盖 §3.3、§4、§5、§6、§8 中所有结算/退款语义：`.../complete`、`.../fail`、`.../requeue` 端点实现必须封装**删除后**的逻辑，禁止先行按旧语义封装。
- 实施顺序钉死：IKEF1K 删除（TS 产品路径 → release 批次）→ 本契约修正二（终态语义定稿）→ IKEL4J 端点 → 四刀。
- **不受删除影响的外部事实（保留）**：new-api 网关按 token 真实扣费；`ERROR_QUOTA_EXHAUSTED` 识别（HTTP 402 / 文案正则，§5 优先级不变）；失败分类中该码仍是终态。receipt/consume-log 查询随 settle 一并消失；展示额度口径（quota/50000）是另一契约，不在本单。
- 下列旧段落保留作**删除前基线取证**（对账历史数据、验证删除完整性用），标注处语义以本节为准：
  - §3.3 `completeJobAndSettle` 的 settle 段、`release_note`/refund 证据链 → 删
  - §4 `.../complete` `.../fail` 中的结算/释放职责 → 端点只做状态终写
  - §5 receipt→`actual_amount_fen`、`quotaToFen`、video 偏差 warn → 删
  - §6 audio/image/video 结算联动、§8 `publishVideoResult` settle 字段 → 删
  - §4 `claim` 投影中的 `reservedAmountFen`（video）→ 删

**修正三（2026-09-10 用户拍板）**：模型上游**只保留 new-api 网关一套**，火山 ARK 直连通道（`ark-image-provider.ts`、`GENERATION_PROVIDER=ark`、`VOLC_ARK_*`）**整体下线、不迁移**。刀③ image 移植范围剔除 ark 兜底与 `ark-image-provider.ts:141-157` 分类路径；TS 侧清理由新子单承接，刀③ 开工前提追加「ARK 下线单已合入」。TOS 对象存储不属模型直连，**不受本修正影响**。

**修正二（2026-09-10 用户二次拍板）**：薄执行器撤回，**Java 直连 DB 移植**。目标模型：TS 侧只发任务（建 job + 投 MQ + recovery 重投 + GC），Java 侧做任务（claim → 调上游 → 终态写），**双方只经数据库与 MQ 交互，无 HTTP**。§3 定位从「权威单源、不迁移」改为「**移植规格**」：Java 用 MyBatis-Plus 逐条实现并以金标测试套件对账；§4 endpoints **不采纳**，保留作移植职能清单（签名对照见附录 B）。刀① 不受影响；刀②③④ 开工前提 = IKEF1K 已合入 master。
- **原则**：领域规则权威在 NestJS backend 侧；§3/§4 描述的实现**不迁移、只暴露**——Java 侧经 internal endpoints 使用，禁止二次实现。
- 文件行号基线 = 本地 master `59ba3282`。

## 1. MQ 消息契约

| 项 | 值 | 出处 |
|---|---|---|
| topic | `generation-task`（**修正六：由 `generation-video` 更名**）。**两侧都没有 env 覆盖**：topic 是编译期常量——生产侧（`backend`）单处来自 `queue.constants.ts` 的 `GENERATION_TASK_QUEUE`（`loadRocketMqConfig` 只绑连接参数，`createRocketMqVideoProducer` 直接读该常量）；消费侧（`worker-java`）单处来自 `GenerationMqRoute` 枚举。`ROCKETMQ_TOPIC` 在两侧都无绑定目标，部署环境里残留 `ROCKETMQ_TOPIC=generation-video` 在两侧都被静默忽略 ⇒ **没有任何运行时途径把消息投到旧名** | `queue.constants.ts` / `video-queue.ts`（`loadRocketMqConfig` / `createRocketMqVideoProducer`）/ `GenerationMqRoute` |
| tags | `video`（**修正六：由 `step` 更名**，语义仍为视频多步任务）/ `image` / `audio` / `media_extract` / `image_enhance`（§14）/ `image_erase`（§15）——6 个 tag 由同一 topic 承载，**服务启动即全部消费，无按 tag 启停开关**（§16） | `queue.constants.ts` |
| TS 消费者组 | **已退役**：TS worker 应用在 `release/2026.09.15` 整目录删除（`1312c474`，PR !636），组名现由 Java 侧独占（§16） | 4 个 consumer `:28-85`（删除前基线） |
| Java 消费者组 | 全为**字面量**（修正六：`-java` 后缀与 `WORKER_GROUP_SUFFIX` 退役，无 env 覆盖）：`generation-extract-worker` / `generation-audio-worker` / `generation-image-worker` / `generation-image-enhance-worker` / `generation-image-erase-worker` / `generation-video-worker` | ADR-0084 修正六决策 3/4 |
| 消息体 | **恒为 `{"jobId":"<字符串>"}`**，无其他字段、无类型判别、无重试计数 | `video-queue.ts:57-59` |
| 投递类型 | **全部 DELAY 消息**，delay 下限 1000ms（0 也按 1000） | `video-queue.ts:60`、`VIDEO_MIN_DELAY_MS:17` |
| 拉取 | `receive(10, 30_000)`（batch=10，不可见 30s） | 4 consumer |
| ack 语义 | 成功才 ack；体解析失败/（image、audio）jobId 非纯数字 → ack 丢弃毒丸；**handler 抛错 → 不 ack 不 nack，broker 30s 后重投**。全仓无显式 nack、无 DLQ 代码 | video `:79-100`、image `:147-169`、audio `:144-167`、extract `:137-156` |
| 并发 | video 顺序 for-await；image/audio/extract = receive 后 Semaphore(20/5/2) fire-and-forget | consumer 各文件 |
| recovery 补发 | 60s 扫库（§7），用**同一 producer 原样重发**，body 不变 | `recovery.service.ts:35-105` |

## 2. 生成负载字段与状态枚举

- `generation_jobs.status` 合法值（VarChar(32)）：`queued` / `processing` / `succeeded` / `partially_succeeded` / `failed` / `cancelled`。**`partially_succeeded` 由 slot 聚合改写产生**（`settle-ops:104-121`），双端对账不可漏。
- `generation_jobs.type`：`image` / `video` / `audio` / `media_extract` / `image_enhance`（§14）/ `image_erase`（§15）。`processClaimedJob` 仅收 image/video/audio，其余 `ERROR_UNSUPPORTED_TYPE`（`generation-worker.ts:287`）。
- 领取 source 白名单：image/audio 共用 `CLAIMABLE_JOB_SOURCES = [bottom_dock, plan_apply, storyboard_preview]`（`-internals.ts:12-16`）；video 硬编码 `[bottom_dock, plan_apply, plan, scene_card]`（`claim-ops:139,261`）；**media_extract / audio claim-by-id 不过滤 source**；image_enhance 白名单仅 `[image_enhance]`（§14.1，唯一入口 = 画布图片卡工具条）；image_erase 白名单仅 `[image_erase]`（§15.1，唯一入口 = 画布图片卡工具条「擦除」）。
- **死列（不迁移、不参与对账）**：`evidence_reconcile_until`、`execution_deadline_at`（全仓无读写）；`next_poll_at`（写但领取用 `next_action_at`，疑似遗留）；`assets.content_sha256`（schema 有、代码从不写）。

## 3. claim / 租约 / 终态写入（**移植规格**——修正二：Java 逐条实现 + 金标套件对账；刀切换前写入权威仍是 TS）

### 3.1 claim（两段式）
1. 候选 findFirst：`status='queued' AND is_delete=false AND source IN 白名单 AND next_action_at<=now`（by-id 变体额外接受 `{status:'processing', lease_expires_at null 或 < now}` **孤儿接管**）。
2. CAS updateMany：`WHERE id AND status=候选值 AND fencing_token=候选值`（by-id 精确路径再加 `user_id`）`SET status='processing', lease_owner=workerId, lease_expires_at=now+120s, last_polled_at=now, fencing_token+1, version+1`。
3. 返回投影用**增后**token（`candidate.fencing_token + 1n`）；0 行 / DB 异常（`.catch→{count:0}`）一律返回 null、零副作用。
4. 后续一切写：`WHERE ... status='processing' AND lease_owner=workerId AND fencing_token=<持有值>`（`fenceWhere`，`settle-ops:13-19`）。**guard fail 一律静默返回 false，不上抛**——stale worker 效应被吞、留给租约过期 + recovery。此语义 Java 必须复刻（不许加异常日志之外的行为）。

### 3.2 租约与心跳
- TTL `IMAGE_JOB_LEASE_SECONDS` 默认 **120s**，全类型同值（**image 例外：300s，见 §11 政策修订**）。
- 真心跳仅 media_extract：`updateMediaExtractProgress` 写 progress(0–99) 同时续租（`media-extract-ops:26-43`）。
- video 无心跳：`markVideoSubmitted` / `rescheduleVideoPoll` 写完即**释放租约**（lease_owner/expires 置 null）并设 `next_action_at=now+5000ms`，下轮以孤儿接管方式再 claim。轮询上限 `MAX_VIDEO_POLLS=720`（≈60 分钟）→ `ERROR_PROVIDER_TIMEOUT`。

### 3.3 终态与结算（同事务原子）
- `completeJobAndSettle` = completeJobInTx + settleReservationInTx 单事务；settle 抛错整体回滚。终态清 `next_action_at`、租约、`progress=100`。
- `failJob` 族：`status='failed'`、`error={code,message,details?}`、slot `pending→failed`、`generation_job_logs`、`project_events`、`cost_reservations reserved→released`（`actual_amount_fen=0`）+ `release_note`。
- `release_note` 规则：`refund_confirmed` = 有证据（`attemptedRequestIds`）且 `readConsumeQuota` 全部查实无扣费；无证据/查询失败/查到扣费 → `refund_unverified`。video：`provider_task_id` 为空（从未提交上游）→ confirmed，否则 unverified（`video-job-runner.ts:545`）。
- 取消：仅 `cancel_requested_at` 在 **claim 后、派发前** 检查一次；DB 守卫 `provider_task_id IS NULL`；置 `cancelled`、`progress=0`、released + `refund_confirmed`。**已提交上游的单不可中断，必跑到终态**——用户可见行为，Java 必须一致。
- 幂等：终态不可再被翻转（guard 要求 `processing`）；`settleReservation` 独立变体 guard 是**终态 status + fencing**（非 processing）。
- `createAsset`（stays processing）与 `publishVideoResult` / `publishMediaExtractResult`（一步事务含 asset 创建 + settled + slot + 事件）三类写路径的字段清单见 §6/§8。

## 4. ~~internal endpoints~~（**修正二：不采纳**；下表保留为 §3 函数的移植职能清单，Java 以 MyBatis-Plus 对位实现）

| 端点 | 封装 | 备注 |
|---|---|---|
| `POST /internal/generation/jobs/claim` | 各 `claim*JobById`（按 tag 分型） | 返回含新 fencing_token、pollCount/progress/parentProviderTaskId/reservedAmountFen（video） |
| `.../heartbeat` | `updateMediaExtractProgress` | 仅 extract 刀用 |
| `.../submit` | `markVideoSubmitted` | 仅 video：记 taskId + 释放租约 + next+5s |
| `.../reschedule` | `rescheduleVideoPoll` | 仅 video 瞬态轮询错误 |
| `.../complete` | `completeJobAndSettle` / `publishVideoResult` / `publishMediaExtractResult`（按 type 路由） | 结算金额入参见 §5 |
| `.../fail` | `failJob` / `failVideoJob` / `failMediaExtractJob` | 含 refund 证据核查（TS 侧做，见 §3.3） |
| `.../requeue` | `requeueImageJobForRetry` | image 瞬态重试回 queued |
| `.../cancel-before-dispatch` | `cancelVideoBeforeDispatch` | claim 返回 `cancelRequested=true` 且无 taskId 时调 |

鉴权：内部机机身份（沿用网关/内部 token 体系，落定归 IKEL4J）；所有响应布尔 `applied:false` = guard fail（stale），Java 侧**不得视为错误重试写入**。

## 5. new-api 网关与计费契约

- 端点：`POST /v1/images/generations`、`POST /v1/images/edits`（multipart）、`POST /v1/video/generations`、`GET /v1/video/generations/{taskId}`、`POST /v1/audio/speech`、`GET /api/log/self?request_id=&type=2`、`GET /api/pricing`。
- 请求头：`Authorization: Bearer <明文 sk token>`（**修正五：凭证去密**——2026-09-12 用户拍板，Redis 会话 sealedSk 与 job.input.provider_credential 均改明文，删除 AES-GCM 密封/解封链路与 `GENERATION_CREDENTIAL_SECRET` 依赖）、`X-Trace-Id`、**`X-Client-System: bluewhale`**（ADR-0080 白名单头，缺了登录隔离会破）、`Content-Type`。
- **receipt**：响应头 `X-Oneapi-Request-Id` → `getConsumeLogByRequestId` 精确查本次扣费 quota → `quotaToFen` 得 `actual_amount_fen`（image/audio 结算路径）；查不到 → 落 0 + warn（非失败）。查询侧重试 500ms×3（`generation-worker.service.ts:23-43`）。video 不用 receipt，读 `TaskDto.quota`（终态时=实际扣费）；与预留偏差 >50% 出 warn（`video-job-runner.ts:321-334`）。
- 换算：`quotaToFen = round(quota/500000 × 7.3 × 100)`（env `QUOTA_PER_UNIT`/`USD_EXCHANGE_RATE` 可覆盖）；仅记账，**≠ 展示额度契约（quota/50000）**，两口径勿混。
- 预扣创建在主 API（`createJobWithinTx`，与 job 行同事务，`cost_reservations reserved`，provider 恒 `"volc"`，4 个版本字段缺省 `"dev"`）——worker/Java 均不建预扣。
- 错误信号识别（跨 provider 共用，优先级 content > quota > provider_failed，IKDAJN）：内容政策 `/(copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy)/i`；额度 HTTP 402 或 `/(预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required)/i`。

## 6. 错误码 ↔ 重试分类（`packages/contracts/src/error-codes.ts`，字符串码为权威值，`job.error.code` 写字符串）

- 生成域 1xxx 全表以代码文件为准（`ERROR_QUOTA_EXHAUSTED`…`ERROR_OUTPUT_COUNT_MISMATCH`，1001–1037；未知回退数值 1000）。Java 侧从本契约文档生成常量表，禁止手抄新增。
- **重试规则（决定 MQ ack/结算，双端必须一致）**：
  - image：仅 `provider_failed` 且 `retry_count<3` → `.../requeue`（退避 30/60/120s，300s 封顶）；其余终态 fail。**（2026-09-11 起读超时/可疑 post-send IO 归终态、瞬态只留连接层失败，见 §11 政策修订）**
  - video：submit 阶段错误全终态；poll 阶段瞬态（`NewApiNetworkError`/`NewApiTimeoutError`/HTTP 429,500,502,503,504，但 `invalid_json_response`/`invalid_video_response` 除外）→ `.../reschedule`；`poll_count≥720` → `provider_timeout` 终态。
  - audio / media_extract：无 worker 级重试，全部终态 fail。
  - 消费者级不 ack → broker 30s 重投属**传输层**，与上表叠加，Java 客户端需保持等价（不主动 nack）。
- 按 job 类型的错误码赋值点清单（凭据缺失/模型不可用/参考素材/无结果/catch-all）：见附录 A（本文件末，冻结自 agent 核对记录，IKEL4J 实现端点时逐条对照）。

## 7. recovery / asset-GC（**recovery 归 Java（IKF3AT）；asset-GC 留 TS**）

- recovery（60s）：**Java `RecoveryService` 实现**（TS `recovery.service.ts:38-106` 逐字移植；`@Scheduled` + 启动即扫一次）。`listDue*JobIds`（批 100）选 `next_action_at<=now` 且（`queued` ∨ `processing 且租约空/过期`）；source 白名单：video=4 源、image=CLAIMABLE_JOB_SOURCES、audio/media_extract 不套白名单；重发同 body 延迟 1s。**窗口：创建 2 小时内**（用户 2026-09-11 指示，TS 的 24h 改 2h；env `RECOVERY_MAX_AGE_MINUTES` 可覆盖，默认 120）。**开关**：无（修正六后 producer bean 无条件装配，6 个 tag 全部重投；原「只对 `WORKER_ENABLED_TAGS` 内 tag 重投、生产者 bean 带 @Conditional」机制已退役，见 §16）；TS 侧 recovery 同时在跑时重复投递无害（claim-by-id CAS + null-claim ack 幂等）。**不移植** `resetStalledImageJobs`——TS 侧无活调用方（死代码），孤儿由 claim-by-id 的「processing + 租约过期可接管」语义接走。→ **TS 进程退役不再阻塞**。
- asset-GC（1h）：`is_delete AND deleted_at<cutoff`（批 1000，延迟默认 7 天）→ live-ref 反查（`storage_key IN(...) AND is_delete=false`）→ 差集 `deleteMultiObjects`（404 视为幂等成功；partial Error 抛出）→ `deleteMany` → `operation_logs` 审计。

## 8. 资产 / TOS / 媒体处理等价标准

- TOS env（5 个全必需，缺一即功能降级）：`VOLC_ACCESS_KEY_ID`、`VOLC_SECRET_ACCESS_KEY`、`VOLC_TOS_ENDPOINT`、`VOLC_TOS_BUCKET`、`VOLC_TOS_REGION`。
- key 规则：带前缀 `{prefix}/{type}/{uuid去横线}.{ext}`（extract 用 `media-extract/`）；无前缀 `uploads/{userId}/{type}/...`；video relay `generated/{userId}/video/...`。扩展名按 MIME 映射，未知 image 回退 `jpg`、非图回退 `bin`。
- 公开 URL `https://{bucket}.{endpoint}/{key}`；presigned PUT TTL 默认 600s；PUT 成功后 `putObjectAcl public-read`。
- **降级模式（TOS 未配置）**：image/video `persistProviderMedia` 直存上游签名 URL（`storageKey=null`）；audio **硬失败**「音频转存存储未配置」；extract 硬失败。Java 行为必须逐条相同（不许"Java 侧干脆 fail-fast"——那会改变测试环境可见行为）。
- audio 生成走 data-direct：base64 `payload.audio` → PUT，mime **恒 `audio/mpeg`**；参考资产解析只收 audio/image（asset.url 直传、按 URL 去重）。
- **ffmpeg（media_extract）等价基线**：`-i <in> -vn -acodec libmp3lame -b:a 192k -y -progress pipe:1 -nostats <out>`；Duration regex `/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/`→ms；进度 `out_time_ms/durationMs×100` 封顶 100；**无超时控制**（原样继承）；无音轨判定 `/does not contain any stream/` → `video_has_no_audio_track`；非零退出附 stderr 尾 500 字符；临时文件 `me-<runId>-in` / `me-<runId>-out.mp3`（tmpdir，finally 删除）；返回 duration 为**秒**、落库 `duration_ms` 为毫秒。
- **图像元数据等价标准（image 刀）**：仅消费 width/height，`round(正有限数)` 否则 null；**解析失败静默、资产照常落库**（面板显示 unknown）。Java ImageIO 等价点 = 宽高数值一致即可，格式字段不消费。
- assets 落库（worker 视角）：`type`(16) / `url` / `storage_key`? / `mime`? / `size`(BigInt)? / `width`? / `height`? / `duration_ms`? / `source='generated'` / `generation_job_id` / `user_id` / `project_id`(默认 0)；extract 经 `publishMediaExtractResult`（无结算逻辑，免费工具）。

## 9. 冻结核对清单（IKEL4H 完成态）

- [x] 4 类消息体 schema（§1：恒 `{jobId}`，DELAY≥1s）
- [x] claim/heartbeat/complete/fail CAS 与幂等语义（§3）
- [x] 错误码枚举 + 重试/计费分类映射（§5/§6 + 附录 A）
- [x] video-step 步骤模型（单步重入 + provider_task_id 判相；§3.2）
- [x] asset 字段 / TOS key / 宽高等价标准（§8）
- [x] ffmpeg 参数与进度解析等价标准（§8）

## 附录 A：按 job 类型的错误码赋值点（行号基线 `59ba3282`）

- image（`generation-worker.ts`）：`unsupported_type:288`、`invalid_input:303`、`model_unavailable:338`、`invalid_reference:349/362`、`provider_credential_missing:502`、`invalid_reference_type:537/550`、`unsupported_input:558`、`no_result:600`、catch-all `:687-692`；~~provider 分类 `ark-image-provider.ts:141-157`~~（**修正三：ARK 直连整体下线，不移植**；new-api 通道自身分类路径保留）。
- audio：`provider_credential_missing:370`、`model_unavailable:381`、`reference_asset_unavailable:395`；provider `new-api-audio-provider.ts:119-163`（同上优先级）、timeout `:101`、no-json `:140`。
- video（`video-job-runner.ts`）：credential `:220`、`invalid_input:311/605`、`invalid_reference:652-670`、`invalid_reference_type:632/638`、`reference_asset_unavailable:679/769`、`unsupported_input:709/722`、poll 超时 `:273`、catch-all `:365`；提交超时 30s / 轮询 10s（`new-api-video-task-provider.ts:51-53`）。
- media_extract（`media-extract-runner.ts`）：`invalid_input:210`、`source_asset_unavailable:221`、MediaExtractError/回退 `media_extract_failed:305`。

## 附录 B：状态机移植对照表（WorkerRepo 逐字签名，`generation-worker-types.ts`；金标用例以此为准）

**领取投影**：
- `ClaimedJob`（types.ts:3-16）：`{ cancelRequested?, id, project_id, user_id, type, input, expected_output_count, retry_count, fencingToken }`（image/audio 用，snake_case 字段）
- `ClaimedMediaExtractJob`（types.ts:65-72）：`{ id, projectId, userId, input, workerId, fencingToken }`
- `ClaimedVideoJob`（types.ts:44-62）：追加 `pollCount, progress, providerTaskId, parentProviderTaskId`；`reservedAmountFen` 按修正一**不移植**

**领取方法**（位置参 `jobId, workerId`，返回投影 | null；两段式 CAS 见 §3.1）：
`claimVideoJobById` :84 / `claimImageJobById` :89 / `claimAudioJobById` :94 / `claimMediaExtractJobById` :163

**写入方法**（input 对象均含 `workerId + fencingToken`，返回 `Promise<boolean>`，**guard fail 静默 false**）：
| 方法 | 独有字段 | types.ts |
|---|---|---|
| `completeJob` | `assetIds: string[]` | :248 |
| `completeJobAndSettle` | `+actualAmountFen?: bigint` —— 修正一后废弃，Java 只实现 `completeJob` 语义 | :256 |
| `failJob` | `errorCode, errorMessage, details?, releaseNote?`（后两字段中 releaseNote 属账本面，不移植） | :267 |
| `failVideoJob` | `code, message, details?, releaseNote?`（同上） | :146 |
| `failMediaExtractJob` | `code, message, details?` | :188 |
| `updateMediaExtractProgress` | `progress`（0-99 钳制 + 续租，§3.2） | :168 |
| `markVideoSubmitted` | `providerTaskId`（+释放租约、next+5s） | :118 |
| `rescheduleVideoPoll` | `progress`（poll_count+1） | :124 |
| `cancelVideoBeforeDispatch` | （无独有字段；额外 DB 守卫 `provider_task_id IS NULL`） | :157 |
| `requeueImageJobForRetry` | 位置参 `(jobId, nextActionAt: Date)`；**无 fence 入参——Java 移植时以其 SQL 实况为准，金标用例单列** | :114 |

BIGINT 注意：投影内 `fencingToken: number`（JS 侧已 Number 化），DB 列 BigInt；Java 用 `long`；`id/project_id/user_id` 字符串承载。

## 10. 实施注记（本地全栈联调 2026-09-10 实锤，双端共同遵守）

- **DATETIME 时基 = UTC naive**：Prisma/TS 写入均为 UTC 挂钟值；Java 侧一切写库时刻必须 `LocalDateTime.now(ZoneOffset.UTC)`。教训：用本地钟写 `next_action_at`/`lease_expires_at` 会让 requeue 单在服务端 `NOW()`（UTC）视角躲进未来 8 小时、claim 永不可见（1808 实锤）。金标镜像断言的时间窗基准同 UTC。
- **invisible 窗与慢 handler**：`receive(10, 30s)` 下 handler 超 30s（如带参考图的 image 编辑）必然引发 broker 重投；重复投递由「lease 未过期 + fencing」在 claim 处静默拦截（1809 实锤：两次 handle、一次 CAS 生效、零重复副作用）。消费端 `ack 失败` WARN 属预期噪音，不作为故障告警。
- **edits 参考图必须传字节**（`new-api-generation-ops.ts` 语义），传 URL 字符串网关 400；key 前缀 `uploads/{userId}/image/...` 的 userId 取自 job.user_id，禁止 0 兜底。

## 11. 冻结增量（2026-09-10，IKESD6）：`features.i2i_model_name` 别名分流 + `features.max_prompt_length`

冻结文档的**追加契约**，双端同步评审通过前 Java 侧照此实现（见 [ADR-0085](../adr/0085-catalog-input-modality-model-alias-and-per-model-prompt-length.md)）：

- `generation_model_capability.features` 新增两键（通用机制，任何 image 行可配，无开关）：
  - `i2i_model_name`（string，可选）：**上游模型名**（非行 id）。**分流由 Java image 链（刀③）在出站请求处实现**（IKESD6 拍板：Node worker 退役中，新功能不落旧版）：该行配了别名 **且** 本 job 带参考图（`input_asset_ids` 解析出的参考素材非空）→ HTTP body 的 `model` 用别名，否则用 `model_id`。未配别名的行行为与 §5 现状完全一致。**灰度含义**：image tag 仍在 TS 侧消费期间，别名不参与分流；切 Java 消费后自动生效。
  - `max_prompt_length`（正整数，可选）：仅影响 **backend 创建时校验**（raw prompt 上限，缺省 image/video=4000、audio=3000；组合上限改为 `max(30000, 模型值)`）。**worker / Java 侧不消费**（worker 现状即不复校长度，见 §2 权威面），登记于此仅为表列语义完整。
- **canonical 语义（Java 必须逐字复刻）**：别名 swap 只发生在出站 HTTP body 的 `model` 字段；`generation_jobs.input.model_id` 恒为**目录主行 model_id**（白名单、重试沿用 frozen input、恢复重投、计费对账、日志全部不受影响）。禁止在创建时把别名写进 frozen input。
- **读取时效**：别名每次执行按 `model_id` 现查能力行（对齐刀③ claim 后查能力的既有模式）；**Java 侧禁止进程级缓存 features**，否则管理端改别名后灰度两侧行为分叉。
- **消费端目录投影**：`/api/generation/models` 对前端**剥除** `i2i_model_name`（出站调用值，与像素/api_value 同哲学），仅透出 `max_prompt_length`。
- 数据面变更（同一 migration）：`gpt-image-2-edit` / `nano-banana-2-i2i` 行软删（is_delete=1），其上游名改由主行 `features.i2i_model_name` 承载；uk_provider_model 含软删行，软删名永久不可复用（`create` 冲突语义不变）。

**政策修订（2026-09-11，IKF12J 讨论，用户拍板）——image 超时与重试语义**：

- **读超时与可疑 post-send IO 不重试**：请求已到达上游、可能已出图扣费，重试=双扣风险 → image HTTP 读超时、以及连接重置/流中断/SSL 中途失败等（无法证明 POST 未送达）一律归 `provider_timeout` **终态**（覆盖 §6「image 仅 provider_failed 瞬态」的入口来源：TS 旧链路把超时混进 provider_failed 一并重试，属其隐患，Node 退役中不回改）。**瞬态重试仅保留请求未达上游的连接层失败**（连接拒绝/连接超时/DNS → provider_failed）。
- **拉大窗口消化慢上游**：`NEW_API_IMAGE_TIMEOUT_MS` 缺省 60s（刀③写死）→ **300s**（用户 2026-09-11 二次上调：240s 实测仍不够，本地 job 1822 在 240s 整超时）；image claim 租约必须盖住「超时+转存」→ 缺省 120s → **420s**，改读 `IMAGE_JOB_LEASE_SECONDS` env（顺带修复刀③把本节登记的 env 写死成常量——§3.2 的 120s 缺省仅约束非 image tag）。recovery 侧按 `lease_expires_at` 列判定，自动跟随，无需改 TS 代码。
- ~~端点选择回归修正（同单）：恒 `/v1/images/generations` + JSON `image` 字段（单张=字符串、多张=数组）；jiekouAI 渠道设计上拒绝 edits（blue-whale-api `highwayapi/adaptor.go:44,113`），任何 edits 分支即回归（钉桩 `NewApiImageClientEndpointTest`）。~~ **本条已被 §12 收窄**（2026-09-11，IKF4LI）：上游换官方协议后，`image_protocol=openai-images` 的行的图生图**必须**走 edits multipart；本条仅对 `image_protocol=inline-image` 的行（缺省值）继续成立。

---

## 12. 冻结增量（2026-09-11，IKF4LI）：出站图片协议目录化（`features.image_protocol`）

上游 gpt-image-2 换官方 OpenAI Images 协议后，§11 定的「恒 generations + body.image」形态被上游**硬拒**，调用 100% 失败。**协议由能力行声明，不按模型名特判**；§11 的 `i2i_model_name` 对 gpt-image-2 作废（机制保留给 banana）。设计背景与取舍见 [ADR-0085](../adr/0085-catalog-input-modality-model-alias-and-per-model-prompt-length.md) 修订段。

### 12.1 实测契约（2026-09-11，经 `api.master.xfai.cloud`，真实调用产生费用）

| 探测 | 结果 |
| --- | --- |
| `POST /v1/images/generations` `{model,prompt}` | 200，`data[].b64_json`，耗时 **178s** |
| `POST /v1/images/edits` multipart（model+prompt+`image` 文件） | 200，`data[].b64_json`，耗时 17s |
| generations 带 `image` 字段 | 400 `Unknown parameter: 'image'` |
| 带 `response_format` | 400 `Unknown parameter: 'response_format'` |
| 带 `watermark` | 400 `Unknown parameter: 'watermark'` |
| `size` | 须 `WIDTHxHEIGHT`，**宽高均须被 16 整除** |
| `quality` | 仅 `low` / `medium` / `high` / `auto` |
| `stream` / `tools` / `sequential_image_generation` | 静默接受（非官方字段，官方协议一律不发） |

### 12.2 `features.image_protocol`（string，可选；缺省 `inline-image`）

- **`openai-images`**：无参考图 → `POST /v1/images/generations`（JSON）；有参考图 → `POST /v1/images/edits`（multipart，参考图**由 worker 按 URL 下载成字节**后以 `image` 字段逐个追加）。只发官方字段 `model` / `prompt` / `n` / `size` / `quality`；**模型名恒为 `model_id`**——文生图与图生图是同一档位、**不换名**，端点分流代替换名。
- **`inline-image`（缺省，未声明即此形态，现状零回归）**：恒 `POST /v1/images/generations`（JSON），参考图以 URL 字符串/数组进 body `image`；**仅此形态**下应用 §11 的 `i2i_model_name` 换名。
- 未知值一律回落 `inline-image`：协议切错的代价是全量调用失败，宁可不切。**「没配」与「配错」必须可区分**：键不存在 = 缺省（常态，静默）；键存在但取值认不出、或 features JSON 损坏 = 配置错误（回落的同时打 WARN）——静默咽掉会让排查从「该模型整个挂了」开始而根因埋在 DB 里。回落决策与告警在 `ImageChannelMapper.parseImageProtocol`，`ImageProtocol.fromWire` 对认不出的值返回 `null` 不做兜底。
- **⚠️ 交叉约束：`image_protocol=openai-images` 的行必须配 `channel_parser=gpt`。** `channel_parser=banana` 会把 `quality` 映射成 `"1k"` 一类的值，而官方协议只认 `low`/`medium`/`high`/`auto`，且该值会被**原样发出** → 必然 400，且错误来自上游、与真正原因（两个配置轴矛盾）隔了一层。**刻意不在 worker 侧过滤非法 `quality`**：过滤等于静默降级成默认质量，比让上游报错更糟——矛盾配置就该响。`features.image_protocol` 目前**无 backend 写入闸门**（`featuresFieldErr` 只校验 `i2i_model_name` / `max_prompt_length`），交叉校验待另开 backend 单。
- 读取时效沿用 §11：每次执行按 `model_id` 现查能力行，**禁止进程级缓存 features**。
- **消费端目录投影**：`image_protocol` 与 `i2i_model_name` 同类（出站调用值）。本次只改 worker-java，backend 的 `handle-list-models` 仍只剥 `i2i_model_name`，`image_protocol` 会随 `features` 透出前端——无害（非密钥），如需与 `i2i_model_name` 一致剥除需另开 backend 单。

### 12.3 响应形态（**无条件支持，与协议无关**）

`data[]` 元素两种形态都必须支持：`url`（网关托管，banana/seedream 现用）与 `b64_json`（官方 GPT Image 系唯一形态）。b64 由客户端 base64 解码为字节、**按魔数嗅探 mime**（响应无 Content-Type 头）；解码失败、或两者皆无的元素丢弃，不炸整批（与 TS `filter` 同款宽容）。

### 12.4 转存与降级

- `b64_json` 形态**没有托管 URL 可降级**：TOS 未配置即硬失败「图片转存存储未配置」（对齐音频 data-direct，见 §8）。
- `url` 形态维持 §8 现状：TOS 未配置 → 直存 URL（`storageKey=null`）。

### 12.5 数据面（同一 migration：`023_ikf4li_official_openai_images_protocol.sql`，`prisma/schema` 与 `prisma/migrations` 双轨字节一致）

- 主行 `gpt-image-2`（015 创建后停用未删，占着 uk_provider_model 干净名）**UPSERT 启回**并写入官方协议配置；`features` 去 `i2i_model_name`、加 `image_protocol=openai-images`；漂移名行 `gpt-image-2-text-to-image`（022 的合并主行）软删。
- `nano-banana-2-t2i` 行显式写 `image_protocol=inline-image`（保留 `i2i_model_name`），读代码不必靠记默认值。
- **改名不做引用迁移**：老画布节点/历史 job 里存的 `gpt-image-2-text-to-image` 不再被解析（用户 2026-09-11 拍板不加兼容别名），重跑需重选模型——与 ADR-0085 对软删行接受的同类代价。

### 12.6 错误分类补充

参考图下载失败发生在 **POST 上游之前**（零扣费风险）→ 归 `provider_failed` **瞬态可重试**，不违反 §11 的「post-send IO 不重试」政策（该政策约束的是无法证明 POST 未送达的 post-send 失败）。

### 12.7 尺寸映射一律走能力行（2026-09-12，IK629 补完）

承接 §12「协议由能力行声明，不按模型名特判」：**尺寸映射同理，一律读 `generation_model_capability.request_mapping`，禁止在 worker 代码内按模型名写尺寸表。**

- 迁移前盘点：`request_mapping` 三族中 gpt 的 `matrix`、banana 的 `size`/`quality` 均已落能力行；**唯独 seedream 的「分辨率 × 宽高比 → WxH」表硬编码在 `ImageChannelMapper.MODEL_SIZES`**（写死 4 个模型名）。后果：上游新增/调整模型尺寸必须改 Java 并重新发版。
- 由此掩盖的一处事实：seedream 行 `supported_sizes[].api_value` 只写档位名（`"1K"`），**上游并不接受**（实测 400 `Invalid size '1K'. Expected WIDTHxHEIGHT`）——真值实际由代码表展开，即「数据库里的值不可用、真值在代码里」。
- 迁移（2026-09-12，`024_ik629_seedream_size_to_catalog.sql`）：4 个启用中的 seedream 行写入 `request_mapping.matrix`（形状与 gpt 行一致，逐格取自原代码表），worker 改读能力行并删除代码表。
- **新增图片模型时**：只写能力行（`channel_parser` + `request_mapping`），**不得新增代码内模型名分支或尺寸表**；代码只保留形状解析与查表能力。

## 13. 修正四（2026-09-12）：worker-java 代码组织规范成文

背景：本契约此前只约定功能语义。代码整备批次把迁移中已成事实的编码约束成文如下，防止后续刀漂移（第 5 个生成类型产品已规划）。这些是可随演进调整**编码规范**，不是 ADR 级架构决策。

### 13.1 包分层与类名后缀

- 分层：`application`（processor / consumer / service）、`domain`（entity / dto / error）、`infrastructure`（mapper / gateway / storage / media / audio / credential / mq）、`config`（装配）、`web`（健康检查）。
- 后缀统一表：

  | 后缀 | 所在层 | 含义与禁令 |
  |---|---|---|
  | `*Entity` | domain/entity | 持久化表投影 |
  | `*Dto` | domain/dto | 跨层共享数据结构（含 MQ 契约投影） |
  | `*Error` | domain/error | 领域**异常类**专用；常量表禁用此后缀（应命名 `*ErrorCodes`） |
  | `*Mapper` | infrastructure/mapper | **仅 MyBatis mapper**。通道路由/参数解析类不得叫 `*Mapper`（用 `*Parser`/`*Router`） |
  | `*Service` | application/service | 应用服务。infrastructure 内类不得叫 `*Service`（按职责用 `*Provider`/`*Storage`/`*Relay`/`*Client`） |
  | `*Processor` / `*Consumer` | application | 作业处理 / MQ 消费 |

- `domain` = **共享内核**，非严格 DDD 领域：Entity（变化轴 = 持久化 schema）、契约投影 Dto（变化轴 = MQ 契约/附录 B）、领域 Error 并存；类头注释必须写明所属变化轴。
- 依赖方向：application / infrastructure 均可依赖 domain；**infrastructure 禁止 import application**（config 装配除外）。

### 13.2 注释与文档义务

- 注释以中文为主；Entity 全字段注释（以现状为达标线）。
- Javadoc 义务线 = `application/service` + `domain` 的 public 方法；processor/consumer 内部靠中文行内注释即可。
- 对 TS 源码的交叉引用（如 `claim-ops.ts:261`）保留，但收敛到类头注释或 `@see`，避免行级内联随 TS 侧演进批量过期。

### 13.3 语言与风格约束

- **不引入 Lombok**；手写访问器维持现状一致性。
- 状态 / 类型 / MIME / 参考角色字符串一律枚举或常量表收口（`JobStatus`、`JobType`、`MediaMime`、`ReferenceRole` 等），禁止跨层裸字符串（§2 合法值清单为权威枚举来源）。
- 禁裸 `RuntimeException`，抛领域 Error；消费者 catch-log-continue 统一收进基类模板方法。
- 时间读取一律经注入的 `java.time.Clock`（UTC），禁散落 `LocalDateTime.now()`——租约/重试测试可确定化。

### 13.4 重构期行为变更上界（整备批次纪律，后续整备刀同样适用）

- 顺手微调仅限**实现级**：错误分类收敛、异常类型、日志文案、重试时序毛刺。
- **不动**：状态机迁移语义（§3）、MQ 消息字段（§1）、DB 写入内容（§2/§8）。越界 → 另立契约修正工单单刀，不得夹带在重构 PR。
- 每条微调必须进 PR「行为 diff 清单」；金标 expected 的任何重录必须对应清单一行。

## 附录 C：新增媒体类型扩展契约（2026-09-12 刀④ 前置钉死）

背景：第 5 个生成类型产品已规划。Java 侧拆分后必须满足「**加一个媒体类型 = 注册一套**」，否则新类型刀不得开工。

- **ClaimedJob 是单概念**：领取投影 = 公共核心（身份 / input / 租约凭证 / 取消信号）+ 媒体 payload 扩展。现状 `ClaimedJobDto` / `ClaimedVideoJobDto` / `ClaimedMediaExtractJobDto` 三胞胎收敛为公共核心 + payload 形态（刀④落地）；新类型是加 payload，不是投影分叉。
- **生命周期一套**：claim / complete / fail / publish（含 progress 心跳变体）按类型注册参数化实现；禁止按类型复制方法三元组。
- 新类型的注册触点（**只许改这些位置**）：① MQ tag + 消费者组常量（§1 命名规则：group = `generation-<type>-worker` **字面量**，修正六后无后缀、无 env 覆盖）；② Consumer 配置子类（tag + 并发度，零 receive 逻辑）；③ Processor（实现 `JobProcessor`，只写媒体编排 + payload 组装）；④ `JobType` 枚举项 + payload Dto 字段；⑤ Finalizer 的 payload 组装策略注册；⑥ 附录 A 样式错误码赋值表 + 金标用例。**claim 两段式 CAS / fence / 终态事务核心代码禁止触碰。**
- 新类型的 TS 侧字段与终态语义（§1/§3/§8）仍是对账权威：跨进程字段先在本附录契约定死后，TS、Java 双端才实现（红线：契约先行）。

## 14. 冻结增量（2026-09-17，IKGM8U）：image_enhance（高清放大）跨进程字段冻结

第 5 个生成类型（附录 C 预告位）。需求规格 = `docs/specs/2026-09-17-image-upscale-mediakit.md`，术语 = 根 `CONTEXT.md`「画布高清放大」，取舍 = `docs/adr/0092-image-upscale-mediakit-integration.md`。本节是 image_enhance 跨进程字段的**唯一事实源**：后续创建入口票（IKGM99）、worker 执行票（IKGM9D）、前端票一律照抄本节与常量落点，**不得另行发明字段名**。常量落点（双端各一处，防漂移断言对账）：

- TS 侧：`backend/libs/contracts/image-enhance.ts`（含 zod schema）；MQ tag 复用 `queue.constants.ts` 的 `IMAGE_ENHANCE_TAG`
- Java 侧：`worker-java/src/main/java/com/bluewhale/worker/domain/entity/ImageEnhanceContract.java` + `JobType.IMAGE_ENHANCE` 枚举项
- 防漂移断言：`backend/libs/contracts/image-enhance.test.ts` 读 Java 源码文本与 TS 常量逐值对账（沿用 ikg4ur 同源断言模式），任一侧漂移即红

### 14.1 任务类型 / MQ / 来源

| 项 | 值 | 说明 |
|---|---|---|
| `generation_jobs.type` | `image_enhance` | VARCHAR(32) 自由字符串，无 DB 迁移 |
| RocketMQ tag | `image_enhance` | tag=type 口径同既有四类；复用 topic `generation-task`（修正六更名） |
| 任务来源 `source` | `image_enhance` | 唯一创建入口 = 画布图片卡工具条「高清放大」（media_extract 的 source=`dock` 同款专属来源值模式） |
| claim source 白名单 | `source IN ('image_enhance')` | 单源白名单（image 是多入口才多值）；IKGM9D 落领取 SQL |
| 消费者组 | `generation-image-enhance-worker`（字面量，修正六后无 groupSuffix） | 附录 C 触点①命名规则 |
| 免费口径 | 无成本预留 / 无 provider 行 / 无素材合规门 / 无余额拦截 | 同 media_extract（IKARDY 先例）；本期网关 model_price 配 0 |
| 错误码兜底 | `image_enhance_failed` → 数值 `1039` | `error-codes.ts` `ERROR_IMAGE_ENHANCE_FAILED`；无 worker 级自动重试 |

### 14.2 input 冻结键名（六键恒在、值恒为合法枚举，strict 无多余键）

| 键名 | 类型 / 取值 | 语义 |
|---|---|---|
| `source_asset_id` | string（Asset id，非 `0` 开头数字串） | 源素材身份：被放大的图片 Asset（命名沿用 media_extract） |
| `target_node_id` | string（非空） | 目标节点身份：画布高清卡 node id；前端回填结果定位用，worker 不消费画布拓扑 |
| `version_tier` | `"lite" \| "pro" \| "max"` | 版本档冻结值；前端展示名 Lite/Pro/Max 只在 UI，不落库不进任务 |
| `multiple` | `2 \| 4 \| 6` | 放大倍数（与火山 API 参数同名同值，出站原样透传） |
| `generative_enhance_mode` | `"fidelity_first" \| "generative_first"` | 增强策略（与火山 API 参数同名同值） |
| `enable_correct_color` | boolean | 色彩校正开关（与火山 API 参数同名同值） |

**六键恒冻结全量值**：版本不支持的字段不缺省、不剥键（置灰时仍冻结默认值）；worker 出站时按 §14.3 能力矩阵裁剪不支持的键。参数快照随 input 冻结，重试沿用首次提交参数。

### 14.3 版本档映射与能力矩阵（单处定义、双端同源）

- `version_tier → tool_version`（火山 AI MediaKit）：**lite→standard、pro→professional、max→max**。
- 能力矩阵（火山三版本差异，前端置灰 / 后端复核 / worker 出站裁剪三处同源）：增强策略仅 **pro/max** 可用；色彩校正仅 **max** 可用。
- TS：`IMAGE_ENHANCE_TOOL_VERSION` + `IMAGE_ENHANCE_TIER_CAPABILITY`；Java：`TIER_TO_TOOL_VERSION` + `TIERS_WITH_ENHANCE_MODE` / `TIERS_WITH_CORRECT_COLOR`。

### 14.4 默认值（面板初始态，与火山官方默认一致）

默认档 `pro`、倍数 `2`、策略 `generative_first`（生成度优先）、色彩校正 `true`（开）。

### 14.5 结果回填约定

- **成功**：worker 调网关同步路由 `POST {NEW_API_BASE_URL}/v1/mediakit/sync/enhance-image`（对客模型名 `mediakit-enhance-image`，鉴权与图片生成同构：任务冻结的用户 sk- + `X-Client-System: bluewhale`）→ 网关原样透传上游响应 → **立即下载结果图（URL 仅 24h 有效）** → 落对象存储公开读 → 建 Asset（`type='image'` / `source='generated'` / `generation_job_id`，宽高按 §8 图像元数据等价标准）→ 终态 `succeeded`（`output_asset_ids`，免费工具无结算联动，同 extract 的 `publishMediaExtractResult` 形态）→ 前端经 `GET /api/jobs/:id` 拿 Asset，按 `target_node_id` 回填目标高清卡（源卡不动；重新生成替换本卡素材不新建卡）。
- **失败**：调用失败 / 超时 / 供应商错误（网关对 success=false 返 400 且不扣费）统一终态 `failed` + `error={code,message}` 走既有错误码投影（兜底 `image_enhance_failed`；额度/内容政策信号识别沿用 §5）；**不提供自动重试**，用户在原卡手动重试，沿用冻结 input。

### 14.6 注册触点与工单分工（附录 C 清单的 image_enhance 实例化）

- **本票（IKGM8U）已落**：JobType 枚举项、ImageEnhanceContract 常量类、TS 契约常量与 zod schema、错误码 `image_enhance_failed`(1039)、queue.constants tag、README 灰度 tag 列表登记、本节冻结。
- **IKGM99（创建入口）**：backend 轻量创建路径（仿 media-extractions.service.ts：直接 insert，source=`image_enhance`，next_action_at 回拨 60s 口径）+ 参数复核（版本档枚举、倍数 ∈ 2/4/6、能力矩阵、源素材归属与媒体类型、源图尺寸门槛）+ producer 入队函数（tag=`IMAGE_ENHANCE_TAG`）。
- **IKGM9D（worker 执行）**：按附录 C 触点注册——① MQ tag + 消费者组常量；② Consumer 配置子类（`ImageEnhanceEnabledCondition`）；③ `ImageEnhanceJobProcessor`（MediaKit 客户端 + §14.5 编排）；④ claim 领取 SQL（type+source 白名单）与 payload Dto；⑤ Finalizer payload 组装；⑥ 错误码赋值 + 金标用例。`GenerationTagsCondition` / `MediaStorageTagsCondition` 需把 `image_enhance` 纳入启用判定（MediaKit 客户端与 TOS 转存均依赖）。**（修正六：全部 `*EnabledCondition` 与 `TagsEnabledConditions` 已随标签开关退役删除，本句的启用判定不再适用——consumer / processor / 客户端 bean 现无条件装配。）**

## 15. 冻结增量（2026-09-18，IKGOT3）：image_erase（图片擦除）跨进程字段冻结

第 6 个生成类型（附录 C 预告位）。需求规格 = `docs/specs/2026-09-18-image-erase-mediakit.md`，术语 = 根 `CONTEXT.md`「画布图片擦除」，取舍 = `docs/adr/0094-image-erase-mediakit.md`。本节是 image_erase 跨进程字段的**唯一事实源**：后续创建入口票（IKGOT4）、worker 执行票（IKGOT6）、前端票一律照抄本节与常量落点，**不得另行发明字段名**。常量落点（双端各一处，防漂移断言对账）：

- TS 侧：`backend/libs/contracts/image-erase.ts`（含 zod schema）；MQ tag 复用 `queue.constants.ts` 的 `IMAGE_ERASE_TAG`
- Java 侧：`worker-java/src/main/java/com/bluewhale/worker/domain/entity/ImageEraseContract.java` + `JobType.IMAGE_ERASE` 枚举项
- 防漂移断言：`backend/libs/contracts/image-erase.test.ts` 读 Java 源码文本与 TS 常量逐值对账（沿用 image-enhance.test.ts 同源断言模式），任一侧漂移即红
- 供应商接口 = 火山引擎 AI MediaKit「提交图像擦除修复任务 API」（同步，`POST /api/v1/tools-sync/erase-image`；本仓经 new-api 网关调用，对客模型名 `mediakit-erase-image`）。**参数名以官方 PDF 为准**（出处逐条标注在契约常量注释），禁止引用二手信息。

### 15.1 任务类型 / MQ / 来源

| 项 | 值 | 说明 |
|---|---|---|
| `generation_jobs.type` | `image_erase` | VARCHAR(32) 自由字符串，无 DB 迁移 |
| RocketMQ tag | `image_erase` | tag=type 口径同既有五类；复用 topic `generation-task`（修正六更名） |
| 任务来源 `source` | `image_erase` | 唯一创建入口 = 画布图片卡工具条「擦除」（同 §14.1 专属来源值模式） |
| claim source 白名单 | `source IN ('image_erase')` | 单源白名单；IKGOT6 落领取 SQL |
| 消费者组 | `generation-image-erase-worker`（字面量，修正六后无 groupSuffix） | 附录 C 触点①命名规则 |
| 免费口径 | 无成本预留 / 无 provider 行 / 无素材合规门 / 无余额拦截 | 同 media_extract / image_enhance 先例；本期网关 model_price 配 0 |
| 错误码兜底 | `image_erase_failed` → 数值 `1040` | `error-codes.ts` `ERROR_IMAGE_ERASE_FAILED`；无 worker 级自动重试 |

### 15.2 input 冻结键名（业务键按场景三/四键恒在、值恒为合法枚举，strict 无多余键）

| 键名 | 类型 / 取值 | 语义 |
|---|---|---|
| `source_asset_id` | string（Asset id，非 `0` 开头数字串） | 源素材身份：被擦除的图片 Asset（命名沿用 media_extract） |
| `target_node_id` | string（非空） | 目标节点身份：画布擦除结果卡 node id；**擦除是发送时才建卡**（区别于高清放大的草稿卡先行），node id 由前端生成传入；前端回填结果定位用，worker 不消费画布拓扑 |
| `erase_scene` | `"full_screen_text_erase" \| "selected_area_erase"` | 擦除场景（取值与火山 API 参数 `standard_scene` 同名同值）；本期两值，`full_screen_icon_erase` / 指定文字擦除为范围外（枚举可扩展、不预写值） |
| `mask_asset_id` | string（Asset id，非 `0` 开头数字串） | 遮罩素材身份（前端栅格化的黑白遮罩 PNG 经资产上传链路取得）：`selected_area_erase` **必填**、`full_screen_text_erase` **禁填**（zod discriminatedUnion 分支强制） |

**基础设施键 `provider_credential`**：业务键之上由创建侧冻结落库（同 §14 image_enhance 口径，!719 审查 P0 教训：凭证必须冻进 input，worker 消费端校验 `provider_credential_missing`），不进契约 zod。

### 15.3 场景出站映射与固定参数（单处定义、双端同源；文档出处 = 官方 PDF Body 参数节）

- `tool_version`：**固定 `standard`**（文档明示当前仅支持 standard，无档位可选，区别于高清放大三档映射）。
- `standard_scene`：取 `erase_scene` 同值透传。
  - `full_screen_text_erase`：**不传**遮罩与 `standard_erase_text`（擦所有文字，文档默认行为）。
  - `selected_area_erase`：**只传 `mask_url`**（遮罩素材公网地址；统一遮罩路径支持多框多笔并集），**不传** `selected_area` 矩形（文档允许两者并传擦并集，本仓不依赖该组合）。
- `output_format`：**固定 `png`**（文档默认 webp；取 png 保证结果卡可二次擦除/扩图/高清放大）。
- 遮罩硬性要求（文档）：黑白遮罩任意形状区域，**分辨率必须与源图 `image_url` 一致**——前端按源图自然分辨率栅格化（IKGOT8）。

### 15.4 输入限制常量（文档出处 = 官方 PDF `image_url` 参数「图像输入分辨率 / 文件大小 / 支持格式」节）

| 常量（TS / Java 同值） | 值 | 口径 |
|---|---|---|
| `IMAGE_ERASE_MAX_WIDTH_PX` / `MAX_INPUT_WIDTH_PX` | `2560` | 分辨率不得超过 2560x1440（宽x高） |
| `IMAGE_ERASE_MAX_HEIGHT_PX` / `MAX_INPUT_HEIGHT_PX` | `1440` | 同上 |
| `IMAGE_ERASE_MIN_SIDE_PX` / `MIN_INPUT_SIDE_PX` | `10` | 分辨率不得小于 10x10（文档有下限，同样入常量防两端漂移） |
| `IMAGE_ERASE_MAX_FILE_BYTES` / `MAX_INPUT_FILE_BYTES` | `10 * 1024 * 1024` | 单张图片不得超过 10 MB |
| `IMAGE_ERASE_INPUT_FORMATS` / `SUPPORTED_INPUT_FORMATS` | `png / jpg / jpeg / heic` | 格式白名单（**不含 webp/gif**，前端门槛置灰与后端复核同源） |

消费方 = backend 创建入口复核（IKGOT4，超尺寸/超格式拒，**宽高缺失（存量图 null）放行**交供应商按官方门槛拒）+ web 菜单门槛预检（IKGOT7，import 契约常量做展示层判断）；worker-java 不做门槛复核（镜像常量仅对账用）。

### 15.5 结果回填约定

- **成功**：worker 调网关同步路由 `POST {NEW_API_BASE_URL}/v1/mediakit/sync/erase-image`（对客模型名 `mediakit-erase-image`，鉴权同 §14.5：任务冻结的用户 sk- + `X-Trace-Id`）→ 网关原样透传上游响应（`result.image_url` 同步返回，几秒级）→ **立即下载结果图（URL 仅 24h 有效）** → 落对象存储公开读 → 建 Asset（`type='image'` / `source='generated'` / `generation_job_id`，宽高按 §8 图像元数据等价标准）→ 终态 `succeeded`（`output_asset_ids`，免费工具无结算联动，同 §14.5 形态）→ 前端经 `GET /api/jobs/:id` 拿 Asset，按 `target_node_id` 回填擦除结果卡（源卡不动；结果卡 png 可再次擦除/扩图/高清放大）。
- **失败**：调用失败 / 超时 / 供应商错误统一终态 `failed` + `error={code,message}` 走既有错误码投影（兜底 `image_erase_failed`；额度/内容政策信号识别沿用 §5）；**不提供自动重试**（同步接口不支持中途取消），用户在结果卡手动重试，沿用冻结 input。

### 15.6 注册触点与工单分工（附录 C 清单的 image_erase 实例化）

- **本票（IKGOT3）已落**：JobType 枚举项、ImageEraseContract 常量类、TS 契约常量与 zod schema、错误码 `image_erase_failed`(1040)、queue.constants tag、本节冻结。
- **IKGOT4（创建入口）**：backend 轻量创建路径（仿 image-enhancements：凭证冻结六段式——sk- 必须冻进 input.provider_credential，双侧都验；source=`image_erase`）+ 参数复核（契约 zod、场景枚举、mask_asset_id 条件约束、源素材/遮罩归属校验、§15.4 门槛复核含宽高 null 放行）+ producer 入队函数（tag=`IMAGE_ERASE_TAG`）+ 入队失败回拨标记失败（`enqueue_failed` 终态口径）。
- **IKGOT6（worker 执行）**：按附录 C 触点注册——① MQ tag + 消费者组常量（`generation-image-erase-worker`）；② Consumer 配置子类；③ `ImageEraseJobProcessor`（MediaKit 客户端 ERASE_PATH + §15.3 场景映射 + §15.5 编排）；④ claim 领取 SQL（type+source 白名单，复用 `findCandidateByTypeAndSources` 参数化）与 payload Dto；⑤ Finalizer payload 组装；⑥ 错误码赋值 + 金标用例。`GenerationTagsCondition` / `MediaStorageTagsCondition` 需把 `image_erase` 纳入启用判定（MediaKit 客户端与 TOS 转存均依赖）；README 灰度 tag 列表登记；任务来源白名单登记。**（修正六：全部 `*EnabledCondition` 与 `TagsEnabledConditions` 已删除、README「灰度开关」章节已改为「启动契约」，这两项登记动作随标签开关退役；任务来源白名单登记仍有效。）**

## 16. 修正六（2026-09-18）：退役标签开关与命名对齐（工单 IKEL4A）

背景：迁移收口后复盘发现，「按 tag 灰度开关」这套机制的存在理由已经消失，而它的默认值（空 = 什么都不消费）反而制造了一个静默故障形态——`WORKER_ENABLED_TAGS` 为空时 6 个 consumer bean 整只不装配、DataSource 退化为 Stub，而 `/ready` 仍返回 `{"status":"ready"}`，「这个实例什么都不消费」**没有任何报警途径**。决策者判定「启动还得配环境变量」不符合逻辑，据此重开决策；权威文本 = [ADR-0084](../adr/0084-generation-worker-java-runtime.md)「修正六」，本节与其同批落定。**本节取代 §1 表、§7 recovery 开关句、附录 C 触点①、§14.1 / §15.1 消费者组行中所有关于标签开关与 `-java` 后缀的描述**（正文已同步修订，旧段落保留作取证）。

**决策**

1. **退役 `WORKER_ENABLED_TAGS` 本体**：删除 6 个 `*EnabledCondition`、`TagsEnabledConditions`、`StubDataSourceConfig`、`application.yml` 中的 `worker.enabled-tags` 映射、`Dockerfile` 中的 `ENV WORKER_ENABLED_TAGS=""`、`ReadyController` 的 `enabledTags` 字段；consumer / processor / 客户端 bean **全部无条件装配**。**服务启动即消费全部 6 个 tag**（§1 表）。
2. **默认语义从「安全拉起」翻转为「缺配置即失败」**：启动即要求 MQ（`ROCKETMQ_ENDPOINTS`）、DB（`DATABASE_URL`）、上游网关（`NEW_API_BASE_URL`）、TOS（`VOLC_*`）**四套**配置齐备，缺任一项由 bean 装配抛出并终止启动（`NEW_API_BASE_URL` 与其余三套同属硬门槛：5 个网关客户端 audio / image / image_enhance / image_erase / video 全部无条件装配，构造器统一经 `NewApiHttpSupport.normalizeBaseUrl`，baseUrl 空白即抛 `IllegalStateException`）。取代原「空 tags → 不连 MQ 不连 DB，只起 `/ready`」形态——该形态把「忘记配置」与「故意只探活」压成同一个状态，是本次修复的核心动因。
3. **命名对齐**：topic `generation-video` → `generation-task`；tag `step` → `video`。生产侧与消费侧**必须在同一次发布内原子切换**：中间态不报错，只是消息无人消费（由 recovery 兜底，`RECOVERY_MAX_AGE_MINUTES` 默认 120）。**两侧取值来源相同——都是编译期常量，都没有 env 覆盖**：生产侧（`backend`）`video-queue.ts` 的 topic 读 `queue.constants.ts` 的 `GENERATION_TASK_QUEUE`（`createRocketMqVideoProducer` 直接取该常量，`loadRocketMqConfig` 只绑连接参数），tag 由六个入队函数各传各自常量；消费侧（`worker-java`）topic / tag 单处来自 `GenerationMqRoute` 枚举（`VideoConsumer.TAG`、`VideoJobProcessor.tag()` 都转发该枚举），`RocketMqConfig` 只绑连接参数。`ROCKETMQ_TOPIC` / `ROCKETMQ_TAG` 在两侧都无绑定目标、残留值被静默忽略，故不再存在「生产者被指回旧名」这条静默滞留途径；剩下的错配只可能来自两侧部署了不同版本的镜像。
4. **退役 `WORKER_GROUP_SUFFIX`**：group 名回落为字面量 `generation-<type>-worker`（原 `generation-<type>-worker-java`）。位点绑定在 `(group, topic)` 上，topic 更名后新 topic 的位点本就从零开始，故本次是**唯一的零重放风险窗口**；错过此后每次改 group 名都需处理位点。前置：确认旧 TS worker 容器已停——否则 Java 与该进程落入同名 group，消息被分流。
5. **topic 粒度保持单 topic，不按任务类型拆分**：隔离已在 consumer group 层取得（每个 tag 一个 group、一个 Semaphore、一条 receive 线程），重试队列/死信、并发度、扩缩容粒度均已独立；拆 topic 只增益位点重置/配额/按类积压可观测，对资源隔离无贡献。
6. **`GET /ready` 只返回 `{"status":"ready"}`**：`enabledTags` 与 `consumerGroupSuffix` 两个字段随开关退役删除（运维事实源从「读数组」变回「进程活着即全部 tag 在消费」）。

**被否决的备选**（同 ADR-0084 修正六）：每种任务一个独立 topic；按消费形态拆 3 个 topic；保留开关但反转默认值（空 = 全量）；保留默认全关、只把 `/ready` 改为非 ready。

**未闭合 / 上线前置（运维）**

- 风险 ③（火山流水线对 Java 镜像的构建部署支持）与 ⑥（刀②③④ 被 IKEF1K gate）在本修正后**仍未闭合**；TS 容器下线无任何记录，登记为**新风险 ⑧**。
- 上线前置项（两项，与 ADR-0084 修正六 决策 7 同口径）：① broker 上已存在**可路由**的 topic `generation-task`——这是改名新建的 topic，而 `autoCreateTopicEnable` 只在**生产者首次发送**时建 topic，消费者订阅不触发，缺失时 worker 启动即失败（`No topic route info in name server`）而非静默；创建途径以生产 broker 实际形态为准；② 旧 TS worker 容器已停。工单 IKELHC 承接并补齐 runbook。
- 对账用 TS 基线文件（§1 出处列、附录 A 行号）多为已删除文件，行号基线仅作历史取证，不得据此判断现行行为。

## 17. 冻结增量（2026-09-19，IKGZ7Z）：video_subtitle_erase（视频智能去字幕）跨进程字段冻结

第 8 个生成类型（附录 C 预告位；第 7 个 image_outpaint 契约独立在 `backend/libs/contracts/image-outpaint.ts`，未单开本文章节）。需求规格 = `docs/specs/2026-09-19-video-subtitle-erase-mediakit.md`，术语 = 根 CONTEXT.md「画布视频智能去字幕」。本节是 video_subtitle_erase 跨进程字段的**唯一事实源**：后续创建入口票（Z80）、worker 执行票（Z81）、前端票（Z82/Z83）一律照抄本节与常量落点，**不得另行发明字段名**。常量落点（双端各一处，防漂移断言对账）：

- TS 侧：`backend/libs/contracts/video-subtitle-erase.ts`（含 zod schema）；MQ tag 复用 `queue.constants.ts` 的 `VIDEO_SUBTITLE_ERASE_TAG`
- Java 侧：`worker-java/src/main/java/com/bluewhale/worker/domain/entity/VideoSubtitleEraseContract.java` + `JobType.VIDEO_SUBTITLE_ERASE` 枚举项
- 防漂移断言：`backend/libs/contracts/video-subtitle-erase.test.ts` 读 Java 源码文本与 TS 常量逐值对账（沿用 image-cutout.test.ts 同源断言模式），任一侧漂移即红
- 供应商接口 = 火山引擎 AI MediaKit「提交字幕擦除（精细化版）任务 API」（**异步任务**：提交返 task_id、轮询查询取结果，`POST /api/v1/tools/erase-video-subtitle-pro`；本仓经 new-api 网关调用，对客模型名 `mediakit-erase-video-subtitle-pro`——**家族内首个异步工具**，区别于 §14.5/§15.5 的同步路由）。**参数名以官方 PDF 为准**（出处逐条标注在契约常量注释），禁止引用二手信息。

### 17.1 任务类型 / MQ / 来源

| 项 | 值 | 说明 |
|---|---|---|
| `generation_jobs.type` | `video_subtitle_erase` | VARCHAR(32) 自由字符串，无 DB 迁移 |
| RocketMQ tag | `video_subtitle_erase` | tag=type 口径同既有七类；复用 topic `generation-task`（修正六更名） |
| 任务来源 `source` | `video_subtitle_erase` | 唯一创建入口 = 画布视频卡工具条「智能去字幕」（同 §15.1 专属来源值模式） |
| claim source 白名单 | `source IN ('video_subtitle_erase')` | 单源白名单；Z81 落领取 SQL |
| 消费者组 | `generation-video-subtitle-erase-worker`（字面量，修正六后无 groupSuffix） | 附录 C 触点①命名规则 |
| 免费口径 | 无成本预留 / 无 provider 行 / 无素材合规门 / 无余额拦截 | 同 media_extract / image_enhance / image_erase 先例；本期网关 model_price 配 0 |
| 错误码兜底 | `video_subtitle_erase_failed` → 数值 `1043` | `error-codes.ts` `ERROR_VIDEO_SUBTITLE_ERASE_FAILED`（1039-1042 已由高清/擦除/扩图/抠图占用）；无 worker 级自动重试 |

### 17.2 input 冻结键名（四键恒在、值恒为合法枚举，strict 无多余键）

| 键名 | 类型 / 取值 | 语义 |
|---|---|---|
| `source_asset_id` | string（Asset id，非 `0` 开头数字串） | 源素材身份：被去字幕的视频 Asset（命名沿用 media_extract） |
| `target_node_id` | string（非空） | 目标节点身份：画布去字幕结果卡 node id；**发送时才建卡**（同 §15.2 擦除口径），node id 由前端生成传入；前端回填结果定位用，worker 不消费画布拓扑 |
| `detect_mode` | `"subtitle_smart" \| "text_full"` | 检测模式（**本仓产品语义命名，非官方参数值**——出站经映射表换算官方 `mode`，见 §17.3） |
| `erase_boxes` | Location 归一化矩形数组，≤20，**空数组合法** | 归一化框列表：空 = 不拉框走智能默认（出站不传 `erase_ratio_location`）；非空出站映射官方 `erase_ratio_location`。框内四键 `top_left_x` / `top_left_y` / `bottom_right_x` / `bottom_right_y` 与官方 Location 对象同名同值（[0,1]，画面左上角原点 (0,0)、右下角 (1,1)），出站原样透传 |

**基础设施键 `provider_credential`**：业务键之上由创建侧冻结落库（同 §15.2 口径，worker 消费端校验 `provider_credential_missing`），不进契约 zod。

### 17.3 检测模式映射与出站固定参数（单处定义、双端同源；文档出处 = 官方 PDF Body 参数节）

- `detect_mode → mode` 映射：**subtitle_smart→Subtitle、text_full→Text**（TS `VIDEO_SUBTITLE_ERASE_MODE` / Java `MODE`）。Subtitle（官方默认）= OCR 检测字幕文本，默认仅画面下半（下方 50%），配置框后生效区 = 框与下半区交集；Text = 检测字幕及其他文本（人名、地名等，不含牌匾类场景文字），全画面检测，配置框后仅框内擦除——擦顶部字幕的途径。
- `model_version`：**固定 `v5`**（官方默认 v4；v5 优化 AIGC 视频擦除后闪烁、带阴影字幕、误擦与速度；规格 Out of Scope 不开放选择）。
- `output_encode_mode`：**固定 `Quality`**（官方默认画质优先；Size 为范围外）。
- `erase_boxes` 出站规则：空数组**不传** `erase_ratio_location` 键（走官方默认行为）；非空原样透传（≤20，官方上限）。
- `time_segment_filter`（分时间段擦除）：**本期不实现，仅留结构扩展位**（规格 Out of Scope，后续单独立项）——官方结构 = `{mode: skip|selected, segments: [{start_time: 秒≥0, end_time: 秒>start, erase_ratio_location?: Location[]（每段≤20，仅 selected）}]}`，分时段框与全局框互斥；类型占位 = TS `VideoSubtitleEraseTimeSegmentFilter`（不进 zod，strict schema 无此键、传入即拒）。
- 任务形态：**异步两段式**——提交端点返 `task_id`，查询端点轮询 `status` 至 `completed` / `failed`；结果 `result.video_url` 24h 有效 + `result.duration`（秒）。

### 17.4 输入限制常量（文档出处 = 官方 PDF `video_url` 参数「支持格式 / 输入分辨率限制」节 + 产品口径）

| 常量（TS / Java 同值） | 值 | 口径 |
|---|---|---|
| `VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX` / `MAX_INPUT_SHORT_SIDE_PX` | `1440` | 官方仅「最高支持 2K 分辨率」**无像素值**——按工单预授权沿用图片系先例（IKGOSZ 修正后口径，竖屏合法）取 2K 档：短边 = min(宽,高) |
| `VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX` / `MAX_INPUT_LONG_SIDE_PX` | `2560` | 长边 = max(宽,高)，横竖屏同口径 |
| `VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS` / `MAX_INPUT_DURATION_MS` | `10 * 60 * 1000` | 10 分钟**产品上限**（官方 API 无视频时长上限，规格故事 4 产品口径） |
| （格式面，无常量） | mp4 / flv / ts / avi / mov / wmv / mkv 等 | 官方开放式列举「等主流视频格式」——**不做格式预检白名单**（规格：我方上传面 video/* 全部在官方支持面内），口径单源在 TS 契约注释 |

消费方 = backend 创建入口复核（Z80，超 2K / 超 10 分钟拒，**宽高/时长缺失（存量 null）放行**交供应商按官方门槛拒）+ web 按钮门槛预检（Z82，import 契约常量做展示层判断）；worker-java 不做门槛复核（镜像常量仅对账用）。

### 17.5 结果回填约定

- **成功**：worker 调网关提交路由（`POST {NEW_API_BASE_URL}` 代理官方 `POST /api/v1/tools/erase-video-subtitle-pro`，对客模型名 `mediakit-erase-video-subtitle-pro`，鉴权同 §14.5：任务冻结的用户 sk- + `X-Trace-Id` + `X-Client-System: bluewhale`）→ 返 `task_id` → **复用视频生成的异步任务轮询骨架**（提交后 `markVideoSubmitted` 存 provider_task_id + 释放租约 + next+5s → `rescheduleVideoPoll` 周期轮询 → claim 按 `next_action_at` 领取，不新建任务状态机形态）→ 轮询至 `completed` 后**立即下载结果视频（URL 仅 24h 有效）**→ 落对象存储公开读 → 建 Asset（`type='video'` / `source='generated'` / `generation_job_id`）→ 终态 `succeeded`（免费工具无结算联动，同 §14.5 形态）→ 前端经 `GET /api/jobs/:id` 拿 Asset，按 `target_node_id` 回填去字幕结果卡（源卡不动；结果卡是普通视频素材卡，可再次去字幕、连线送生成）。
- **失败**：提交失败 / 轮询超时 / 供应商错误统一终态 `failed` + `error={code,message}` 走既有错误码投影（兜底 `video_subtitle_erase_failed`，上游可读原因透传前端投影；额度/内容政策信号识别沿用 §5）；**不提供自动重试**（官方无取消端点，家族「发出不取消」口径），用户在结果卡手动重试，沿用冻结 input。

### 17.6 注册触点与工单分工（附录 C 清单的 video_subtitle_erase 实例化）

- **本票（IKGZ7Z）已落**：`JobType` 枚举项、`GenerationMqRoute` 路由项、`VideoSubtitleEraseContract` 常量类、`VideoSubtitleEraseError`（domain/error）、TS 契约常量与 zod schema、错误码 `video_subtitle_erase_failed`(1043)、`queue.constants.ts` tag（含 `GenerationTag` 联合类型扩项）、`StartupContractTest` 路由对账扩项、`mq-route-parity.test.ts` 登记、本节冻结。
- **Z80（创建入口）**：backend 轻量创建路径（仿 image-erase 创建入口：凭证冻结——sk- 必须冻进 input.provider_credential；source=`video_subtitle_erase`）+ 参数复核（契约 zod、检测模式枚举、框列表 ≤20 与 [0,1] 坐标、源素材归属与媒体类型校验、§17.4 门槛复核含宽高/时长 null 放行）+ producer 入队函数（tag=`VIDEO_SUBTITLE_ERASE_TAG`）+ 入队失败回拨标记失败（`enqueue_failed` 终态口径）。
- **Z81（worker 执行）**：按附录 C 触点注册——① MQ tag + 消费者组常量（`generation-video-subtitle-erase-worker`）；② Consumer 配置子类（tag + 并发度，零 receive 逻辑）；③ `VideoSubtitleEraseJobProcessor`（MediaKit 网关客户端新增**异步提交 + 任务查询**两个端点 + §17.3 模式映射 + §17.5 轮询编排，复用视频生成轮询骨架）；④ claim 领取 SQL（type+source 白名单，复用 `findCandidateByTypeAndSources` 参数化）与 payload Dto；⑤ Finalizer payload 组装；⑥ 错误码赋值 + 金标用例；任务来源白名单登记。
- **前端（Z82/Z83）**：按钮门槛预检 import §17.4 常量（null 放行）、发送请求体按 §17.2 四键组装、来源边 `edge.data.origin = VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN`（纯视觉来源线，媒体引用推导跳过）。

## 18. 冻结增量（2026-09-19，IKH28T）：media_extract（音视频分离）切火山执行路径的契约扩面

media_extract 是老类型（IKARDY，§1/§2/§6/§8/附录 A 既有冻结继续有效，本节不改动），本节只冻结**切火山官方 API 执行路径**引入的增量：output_format 枚举面与火山执行路径错误码面。既定决策（ADR-0103）：**任务类型沿用 `media_extract`、input 字段结构不变、本地 ffmpeg 链路代码全保留**（双执行路径并存），本票不新建任务类型。本节是这些增量字段的**唯一事实源**：后续创建入口票（IKH28V）、worker 执行票（IKH28W）、网关票（IKH28Y）、前端票一律照抄本节与常量落点，**不得另行发明字段名**。常量落点（双端各一处，防漂移断言对账）：

- TS 侧：`backend/libs/contracts/media-extract.ts`（含 zod schema）；MQ tag 复用 `queue.constants.ts` 的 `MEDIA_EXTRACT_TAG`（既有，值不变）
- Java 侧：`worker-java/src/main/java/com/bluewhale/worker/domain/entity/MediaExtractContract.java`（本票新建；`JobType.MEDIA_EXTRACT` / `GenerationMqRoute.MEDIA_EXTRACT` / `MediaExtractError` 为既有注册，任务类型不变故不新增枚举项）
- 防漂移断言：`backend/libs/contracts/media-extract.test.ts` 读 Java 源码文本与 TS 常量逐值对账（沿用 video-subtitle-erase.test.ts 同源断言模式），任一侧漂移即红
- 供应商接口 = 火山引擎 AI MediaKit「提交音频提取任务 API」（**异步任务**：提交返 task_id、轮询查询取结果，`POST /api/v1/tools/extract-audio`；本仓经 new-api 网关调用）。**参数名以官方 PDF 为准**（出处逐条标注在契约常量注释），禁止引用二手信息。

### 18.1 任务类型 / MQ / 来源（全部沿用既有，不变）

| 项 | 值 | 说明 |
|---|---|---|
| `generation_jobs.type` | `media_extract` | 不变（ADR-0103 不新建任务类型） |
| RocketMQ tag | `media_extract` | 不变（复用 topic `generation-task`） |
| 任务来源 `source` | `dock` | 不变（media_extract 不套 claim source 白名单，§2/§7 既有口径） |
| 消费者组 | `generation-extract-worker` | 不变 |
| input 冻结键 | `source_asset_id` / `output_format` | 两键恒在、结构不变（§18.2 只扩 output_format 取值面） |

### 18.2 output_format 枚举与默认值（文档出处 = 官方 PDF Body 参数 `format` 节）

| 常量（TS / Java 同值） | 值 | 口径 |
|---|---|---|
| `MEDIA_EXTRACT_OUTPUT_FORMATS` / `SUPPORTED_OUTPUT_FORMATS` | `m4a / mp3 / ogg / flac / wav` | 官方 `format` 参数五值，**同名同值出站透传**（input 冻结键 `output_format` 出站映射官方 `format`，IKH28W 客户端落） |
| `MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT` / `DEFAULT_OUTPUT_FORMAT` | `m4a` | 官方 PDF `format` 节**描述文字「默认值为 m4a」**——表格示例值列写 `mp3`，以描述文字为准（契约测试断言 m4a）；创建入口未传时落本值 |
| （拒绝口径） | 非法值明确拒绝 | `output_format` 传了枚举外值 / 非字符串 / `null` → 创建入口明确拒绝（`fail(PARAM_MISSING_CODE, "output_format 仅支持 m4a / mp3 / ogg / flac / wav")`，对齐去字幕 zod 失败码口径）；**「静默回退 mp3」的旧口径随本节废除** |

消费方 = backend 创建入口（IKH28V 权威复核：缺省补默认、非法拒绝——本票已随常量抽取先落 service，IKH28V 承载其余创建入口行为切换）+ worker 出站（IKH28W 客户端按冻结值透传 `format`）；web 前端格式选择面由前端票承接。

### 18.3 火山端点路径（集中常量承载；网关侧实际路由待网关票 IKH28Y 确认）

| 常量（TS / Java 同值） | 值 | 口径 |
|---|---|---|
| `MEDIA_EXTRACT_SUBMIT_PATH` / `SUBMIT_PATH` | `/api/v1/tools/extract-audio` | 官方 PDF「1. 提交音频提取任务 API」节**逐字**（提交端点） |
| `MEDIA_EXTRACT_POLL_PATH_PREFIX` / `POLL_PATH_PREFIX` | `/v1/mediakit/async/tasks/` | **查询端点不在官方 PDF**——按家族先例落网关假设路径（去字幕 `NewApiMediaKitSubtitleEraseClient.POLL_PATH_PREFIX` 同款假设口径），**待网关票 IKH28Y 确认后定稿，有出入只改本常量** |

### 18.4 火山执行路径错误码面（三类映射口径；网关错误 / 火山任务失败 / 转存失败）

新用位一个：`media_extract_provider_failed` → 数值 **1044**（1043 已由去字幕占用，取下一空号；注册三处 = `error-codes.ts` 字符串码+数值表+文案表 / `MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED` 镜像 / `docs/api/generation-job-error.md` 数值表）。**与本地 ffmpeg 链路兜底 `media_extract_failed`(1020) 双码并存**——双执行路径并存期（ADR-0103）可从错误码区分失败来自哪条路径；本地链路细分码 `video_has_no_audio_track`(1023) / `video_download_failed`(1024) / `video_too_large`(1025) / `extract_failed`(1026) / `upload_failed`(1027) 保留给 ffmpeg 路径（含存量已落库任务投影），**火山路径不产生**（其语义由下列映射归并覆盖）。三类映射口径（IKH28W worker 实现时照抄，对齐去字幕 §17.5 模式）：

1. **网关错误**（new-api 网关调用失败：HTTP 非 2xx / 成功态 `error` 信封 / 提交 `SocketTimeoutException`）→ **复用既有通用码分类链，不新码**（`NewApiErrorClassifier` 同款：版权 → `content_rejected_reference`(1038) → 内容政策 → `content_rejected`(1018) → 额度（HTTP 402 或欠费信号）→ `quota_exhausted`(1001) → 兜底 `provider_failed`(1011)；提交超时单独归 `provider_timeout`(1012) 终态不重试——宁可不重试也不双跑）。官方同步错误结构 `error{code,message,param,type}`（如 `InvalidParameter`/`BadRequest`）按此链分类，不透传英文原文。
2. **火山任务失败**（轮询 `status=failed`）→ 上游 `error.code/message` 按分类链识别（版权 1038 / 内容 1018 / 额度 1001 保留既有码，上游可读原因随 message 透传前端投影）；**分类链外一律归并 `media_extract_provider_failed`(1044)**。轮询超时（超过上限次数）同样归并 1044。无音轨场景（原 1023 的用户语义「视频没有音轨」）在火山路径体现为上游任务 failed，不单独识别——归并 1044（是否从上游 message 精细识别留给 IKH28W 评估，不新增用位）。
3. **转存失败**（`result.audio_url` 24h 临时链接 → 自家 TOS 下载/上传失败，或转存件未配置）→ **归并 `media_extract_provider_failed`(1044)**（对齐去字幕「TOS 强依赖不降级直存、失败归并工具兜底码」口径；`storage_failed`(1016) 不启用，与去字幕一致）。

失败终态口径同家族：**无 worker 级自动重试**（轮询瞬时错误 429/5xx/网络抖动按去字幕 `isTransientPollError` 同语义续排，属轮询续排而非重试），用户在结果卡手动重试并沿用冻结 input；额度/内容政策信号识别沿用 §5。

### 18.5 注册触点与工单分工

- **本票（IKH28T）已落**：`MediaExtractContract` 常量类（tag/source/input 键/格式枚举/默认值/端点路径/兜底错误码）、`MediaExtractError` 镜像新码、TS 契约常量与 zod schema（`media-extract.ts`）、错误码 `media_extract_provider_failed`(1044) 三处注册、service 引用契约常量（缺省 m4a + 非法拒绝先落，常量单源）、`media-extract.test.ts` 防漂移断言、本节冻结。既有注册（`JobType` / `GenerationMqRoute` / `queue.constants` / `mq-route-parity` / `StartupContractTest`）任务类型不变，无需改动。
- **IKH28V（创建入口）**：service/controller 行为语义切换的其余部分（凭证冻结 `provider_credential`、`findAccessible`→`findOwnedSource` 归属口径对齐去字幕等）、请求体 zod 完整复核收口。
- **IKH28W（worker 执行）**：`NewApiMediaKitExtractAudioClient`（SUBMIT/POLL 用 §18.3 常量，`result.audio_url`/`duration` 消费）、`MediaExtractJobProcessor` 切异步轮询骨架、音频转存件（`TosVideoMediaRelay` 的 audio/ 变体）、错误映射按 §18.4 三类口径落。
- **IKH28Y（网关）**：确认经 new-api 网关的实际提交/查询路由，回写 §18.3 两常量（有出入只改常量）。
- **前端票**：格式选择面（五值 + 默认 m4a）、`(audio).mp3` 派生命名按格式扩展、失败文案按 1044 映射。
