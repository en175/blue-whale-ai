# worker-java 迁移契约（IKEL4A / ADR-0084）

- **状态**：**已冻结 + 修正一**（2026-09-10，IKEL4H 从代码逐项核对回填；同日修正一记录 cost_reservations 记账移出迁移范围）。本文件是 TS（NestJS backend）与 Java（worker-java）双端对账唯一基准；冻结后改动须双端同步评审。

## 0. 修正一（2026-09-10）：cost_reservations 记账移出迁移范围（工单 IKEM7S）

- 决策：`cost_reservations` 预扣/结算/release 记账**整体下线**（IKEM7S），**Java 侧一概不实现**。本修正覆盖 §3.3、§4、§5、§6、§8 中所有结算/退款语义：`.../complete`、`.../fail`、`.../requeue` 端点实现必须封装**删除后**的逻辑，禁止先行按旧语义封装。
- 实施顺序钉死：IKEM7S 删除（TS 产品路径 → release 批次）→ 本契约修正二（终态语义定稿）→ IKEL4J 端点 → 四刀。
- **不受删除影响的外部事实（保留）**：new-api 网关按 token 真实扣费；`ERROR_QUOTA_EXHAUSTED` 识别（HTTP 402 / 文案正则，§5 优先级不变）；失败分类中该码仍是终态。receipt/consume-log 查询随 settle 一并消失；展示额度口径（quota/50000）是另一契约，不在本单。
- 下列旧段落保留作**删除前基线取证**（对账历史数据、验证删除完整性用），标注处语义以本节为准：
  - §3.3 `completeJobAndSettle` 的 settle 段、`release_note`/refund 证据链 → 删
  - §4 `.../complete` `.../fail` 中的结算/释放职责 → 端点只做状态终写
  - §5 receipt→`actual_amount_fen`、`quotaToFen`、video 偏差 warn → 删
  - §6 audio/image/video 结算联动、§8 `publishVideoResult` settle 字段 → 删
  - §4 `claim` 投影中的 `reservedAmountFen`（video）→ 删
- **原则**：领域规则权威在 NestJS backend 侧；§3/§4 描述的实现**不迁移、只暴露**——Java 侧经 internal endpoints 使用，禁止二次实现。
- 文件行号基线 = 本地 master `59ba3282`。

## 1. MQ 消息契约

| 项 | 值 | 出处 |
|---|---|---|
| topic | `generation-video`（env `ROCKETMQ_TOPIC` 可覆盖） | `queue.constants.ts` / `video-queue.ts:43` |
| tags | `step`(video) / `image` / `audio` / `media_extract` | `queue.constants.ts:2,5,8,11` |
| TS 消费者组 | `generation-video-worker` / `generation-image-worker` / `generation-audio-worker` / `generation-extract-worker`（各 env 可覆盖） | 4 个 consumer `:28-85` |
| Java 消费者组 | 同名 + `-java` 后缀；同一 tag 同一时刻仅一侧在消费（停一开一 = 灰度/回滚开关） | ADR-0084 决策 4 |
| 消息体 | **恒为 `{"jobId":"<字符串>"}`**，无其他字段、无类型判别、无重试计数 | `video-queue.ts:57-59` |
| 投递类型 | **全部 DELAY 消息**，delay 下限 1000ms（0 也按 1000） | `video-queue.ts:60`、`VIDEO_MIN_DELAY_MS:17` |
| 拉取 | `receive(10, 30_000)`（batch=10，不可见 30s） | 4 consumer |
| ack 语义 | 成功才 ack；体解析失败/（image、audio）jobId 非纯数字 → ack 丢弃毒丸；**handler 抛错 → 不 ack 不 nack，broker 30s 后重投**。全仓无显式 nack、无 DLQ 代码 | video `:79-100`、image `:147-169`、audio `:144-167`、extract `:137-156` |
| 并发 | video 顺序 for-await；image/audio/extract = receive 后 Semaphore(20/5/2) fire-and-forget | consumer 各文件 |
| recovery 补发 | 60s 扫库（§7），用**同一 producer 原样重发**，body 不变 | `recovery.service.ts:35-105` |

## 2. 生成负载字段与状态枚举

- `generation_jobs.status` 合法值（VarChar(32)）：`queued` / `processing` / `succeeded` / `partially_succeeded` / `failed` / `cancelled`。**`partially_succeeded` 由 slot 聚合改写产生**（`settle-ops:104-121`），双端对账不可漏。
- `generation_jobs.type`：`image` / `video` / `audio` / `media_extract`。`processClaimedJob` 仅收 image/video/audio，其余 `ERROR_UNSUPPORTED_TYPE`（`generation-worker.ts:287`）。
- 领取 source 白名单：image/audio 共用 `CLAIMABLE_JOB_SOURCES = [bottom_dock, plan_apply, storyboard_preview]`（`-internals.ts:12-16`）；video 硬编码 `[bottom_dock, plan_apply, plan, scene_card]`（`claim-ops:139,261`）；**media_extract / audio claim-by-id 不过滤 source**。
- **死列（不迁移、不参与对账）**：`evidence_reconcile_until`、`execution_deadline_at`（全仓无读写）；`next_poll_at`（写但领取用 `next_action_at`，疑似遗留）；`assets.content_sha256`（schema 有、代码从不写）。

## 3. claim / 租约 / 终态写入（权威 = backend TS，internal endpoints 暴露）

### 3.1 claim（两段式）
1. 候选 findFirst：`status='queued' AND is_delete=false AND source IN 白名单 AND next_action_at<=now`（by-id 变体额外接受 `{status:'processing', lease_expires_at null 或 < now}` **孤儿接管**）。
2. CAS updateMany：`WHERE id AND status=候选值 AND fencing_token=候选值`（by-id 精确路径再加 `user_id`）`SET status='processing', lease_owner=workerId, lease_expires_at=now+120s, last_polled_at=now, fencing_token+1, version+1`。
3. 返回投影用**增后**token（`candidate.fencing_token + 1n`）；0 行 / DB 异常（`.catch→{count:0}`）一律返回 null、零副作用。
4. 后续一切写：`WHERE ... status='processing' AND lease_owner=workerId AND fencing_token=<持有值>`（`fenceWhere`，`settle-ops:13-19`）。**guard fail 一律静默返回 false，不上抛**——stale worker 效应被吞、留给租约过期 + recovery。此语义 Java 必须复刻（不许加异常日志之外的行为）。

### 3.2 租约与心跳
- TTL `IMAGE_JOB_LEASE_SECONDS` 默认 **120s**，全类型同值。
- 真心跳仅 media_extract：`updateMediaExtractProgress` 写 progress(0–99) 同时续租（`media-extract-ops:26-43`）。
- video 无心跳：`markVideoSubmitted` / `rescheduleVideoPoll` 写完即**释放租约**（lease_owner/expires 置 null）并设 `next_action_at=now+5000ms`，下轮以孤儿接管方式再 claim。轮询上限 `MAX_VIDEO_POLLS=720`（≈60 分钟）→ `ERROR_PROVIDER_TIMEOUT`。

### 3.3 终态与结算（同事务原子）
- `completeJobAndSettle` = completeJobInTx + settleReservationInTx 单事务；settle 抛错整体回滚。终态清 `next_action_at`、租约、`progress=100`。
- `failJob` 族：`status='failed'`、`error={code,message,details?}`、slot `pending→failed`、`generation_job_logs`、`project_events`、`cost_reservations reserved→released`（`actual_amount_fen=0`）+ `release_note`。
- `release_note` 规则：`refund_confirmed` = 有证据（`attemptedRequestIds`）且 `readConsumeQuota` 全部查实无扣费；无证据/查询失败/查到扣费 → `refund_unverified`。video：`provider_task_id` 为空（从未提交上游）→ confirmed，否则 unverified（`video-job-runner.ts:545`）。
- 取消：仅 `cancel_requested_at` 在 **claim 后、派发前** 检查一次；DB 守卫 `provider_task_id IS NULL`；置 `cancelled`、`progress=0`、released + `refund_confirmed`。**已提交上游的单不可中断，必跑到终态**——用户可见行为，Java 必须一致。
- 幂等：终态不可再被翻转（guard 要求 `processing`）；`settleReservation` 独立变体 guard 是**终态 status + fencing**（非 processing）。
- `createAsset`（stays processing）与 `publishVideoResult` / `publishMediaExtractResult`（一步事务含 asset 创建 + settled + slot + 事件）三类写路径的字段清单见 §6/§8。

## 4. internal endpoints（IKEL4J 交付；语义 = §3 函数原样封装，禁止顺手改）

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
- 请求头：`Authorization: Bearer <per-job 解封凭证>`（AES sealed credential）、`X-Trace-Id`、**`X-Client-System: bluewhale`**（ADR-0080 白名单头，缺了登录隔离会破）、`Content-Type`。
- **receipt**：响应头 `X-Oneapi-Request-Id` → `getConsumeLogByRequestId` 精确查本次扣费 quota → `quotaToFen` 得 `actual_amount_fen`（image/audio 结算路径）；查不到 → 落 0 + warn（非失败）。查询侧重试 500ms×3（`generation-worker.service.ts:23-43`）。video 不用 receipt，读 `TaskDto.quota`（终态时=实际扣费）；与预留偏差 >50% 出 warn（`video-job-runner.ts:321-334`）。
- 换算：`quotaToFen = round(quota/500000 × 7.3 × 100)`（env `QUOTA_PER_UNIT`/`USD_EXCHANGE_RATE` 可覆盖）；仅记账，**≠ 展示额度契约（quota/50000）**，两口径勿混。
- 预扣创建在主 API（`createJobWithinTx`，与 job 行同事务，`cost_reservations reserved`，provider 恒 `"volc"`，4 个版本字段缺省 `"dev"`）——worker/Java 均不建预扣。
- 错误信号识别（跨 provider 共用，优先级 content > quota > provider_failed，IKDAJN）：内容政策 `/(copyright|sensitive|版权|敏感|policy violation|policyviolation|content policy)/i`；额度 HTTP 402 或 `/(预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required)/i`。

## 6. 错误码 ↔ 重试分类（`packages/contracts/src/error-codes.ts`，字符串码为权威值，`job.error.code` 写字符串）

- 生成域 1xxx 全表以代码文件为准（`ERROR_QUOTA_EXHAUSTED`…`ERROR_OUTPUT_COUNT_MISMATCH`，1001–1037；未知回退数值 1000）。Java 侧从本契约文档生成常量表，禁止手抄新增。
- **重试规则（决定 MQ ack/结算，双端必须一致）**：
  - image：仅 `provider_failed` 且 `retry_count<3` → `.../requeue`（退避 30/60/120s，300s 封顶）；其余终态 fail。
  - video：submit 阶段错误全终态；poll 阶段瞬态（`NewApiNetworkError`/`NewApiTimeoutError`/HTTP 429,500,502,503,504，但 `invalid_json_response`/`invalid_video_response` 除外）→ `.../reschedule`；`poll_count≥720` → `provider_timeout` 终态。
  - audio / media_extract：无 worker 级重试，全部终态 fail。
  - 消费者级不 ack → broker 30s 重投属**传输层**，与上表叠加，Java 客户端需保持等价（不主动 nack）。
- 按 job 类型的错误码赋值点清单（凭据缺失/模型不可用/参考素材/无结果/catch-all）：见附录 A（本文件末，冻结自 agent 核对记录，IKEL4J 实现端点时逐条对照）。

## 7. recovery / asset-GC（留 TS 进程，Java 不接管，此处仅登记行为边界）

- recovery（60s）：`listDue*JobIds`（批 100）选 `next_action_at<=now` 且 `queued` 或 `processing 且租约过期`；video 限 4 源白名单、24h 内；重发同 body。→ **它同时是 Java worker 崩溃时的降级网**。
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

- image（`generation-worker.ts`）：`unsupported_type:288`、`invalid_input:303`、`model_unavailable:338`、`invalid_reference:349/362`、`provider_credential_missing:502`、`invalid_reference_type:537/550`、`unsupported_input:558`、`no_result:600`、catch-all `:687-692`；provider 分类 `ark-image-provider.ts:141-157`（content_rejected > quota_exhausted > provider_failed）。
- audio：`provider_credential_missing:370`、`model_unavailable:381`、`reference_asset_unavailable:395`；provider `new-api-audio-provider.ts:119-163`（同上优先级）、timeout `:101`、no-json `:140`。
- video（`video-job-runner.ts`）：credential `:220`、`invalid_input:311/605`、`invalid_reference:652-670`、`invalid_reference_type:632/638`、`reference_asset_unavailable:679/769`、`unsupported_input:709/722`、poll 超时 `:273`、catch-all `:365`；提交超时 30s / 轮询 10s（`new-api-video-task-provider.ts:51-53`）。
- media_extract（`media-extract-runner.ts`）：`invalid_input:210`、`source_asset_unavailable:221`、MediaExtractError/回退 `media_extract_failed:305`。
