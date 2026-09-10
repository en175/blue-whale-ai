# worker-java 迁移契约（IKEL4A / ADR-0084）

- **状态**：待冻结——由 IKEL4H 从现行代码逐项核对补全后，本文件即 TS/Java 双端对账唯一基准；冻结后改动须双端同步评审。
- **原则**：领域规则权威在 NestJS backend（TS）侧；本文件描述 Java 侧可见的全部事实。凡与代码不符处，以代码为准并回写本文件。

## 1. MQ 消息契约

- topic：`generation-video`；按 tag 路由：`step`（video）、`image`、`audio`、`media_extract`。
- TS 消费者组（现状，迁移后保留为回滚位）：`generation-video-worker` / `generation-image-worker` / `generation-audio-worker` / `generation-extract-worker`。
- Java 消费者组（新，灰度开关的另一半）：同名加 `-java` 后缀；同一时刻同一 tag 只允许一侧组在消费（停一开一即切换，回滚反向）。
- 消息体 schema（触发器语义，正确性在 DB claim）：`{ "jobId": ... }`——**待 IKEL4H 逐 tag 核对字段**。

## 2. generation_jobs 状态机（权威 = backend）

- 关键列：`status`、`fencing_token`（BigInt CAS）、`lease_owner`、`lease_expires_at`、`cancel_requested_at`、`evidence_reconcile_until`、`next_action_at`。
- 领取语义：claim-by-id CAS + fencing token 防过期 worker；心跳续租；settle 结算预扣。流转实现**只在** `backend/libs/shared/persistence/generation-worker-*.ts`，Java 侧经 internal endpoints 使用。
- recovery：TS 侧 `@Interval(60s)` 扫描租约过期的 queued/processing 重投——保留在 TS，是 Java worker 故障时的降级网。

## 3. internal endpoints（IKEL4J 交付）

- `POST /internal/generation/jobs/claim` / `heartbeat` / `complete` / `fail`。
- 语义 = 现有 worker repo 的 CAS SQL 原样封装，**禁止顺手改语义**；鉴权与错误码映射 **待 IKEL4H/I 定义**。

## 4. 上游调用与结算

- new-api 网关（`NEW_API_BASE_URL`）：image / video task / audio TTS / consume-log 对账（`getConsumeLogByRequestId`）；Ark 直连兜底（`VOLC_ARK_BASE_URL` / `GENERATION_PROVIDER=ark`）。
- TOS：预签名 PUT、`makePublic`、批量删除；资产 key 规则与公开语义 **待核对**。
- 错误码（`packages/core`，如 `ERROR_PROVIDER_FAILED`）↔ 重试分类 ↔ 计费影响：映射表 **待 IKEL4H 补全**。

## 5. 配置（与 TS 版同名）

- 消费并发：`IMAGE_CONCURRENCY=20` / `AUDIO_CONCURRENCY=5` / `MEDIA_EXTRACT_CONCURRENCY=2`（Java 侧等价 Semaphore/consumeThread 配置）。
- 新增（Java 专属）：`WORKER_ENABLED_TAGS`（灰度刀开关）、`BACKEND_INTERNAL_API_BASE_URL`。
- cron 类（`GENERATION_RECOVERY_INTERVAL_MS`、`ASSET_GC_*`）留 TS 侧，Java 不接管。

## 6. 冻结前待办清单（归 IKEL4H）

- [ ] 4 类消息体逐字段核对
- [ ] claim/heartbeat/complete/fail 的 SQL/CAS 语句与幂等语义逐条对照
- [ ] 错误码全枚举 + 重试/计费分类映射表
- [ ] video-step 多步状态机（submit/poll/relay）步骤定义与取消语义
- [ ] asset 落库字段、TOS key 规则、metadata（宽高）提取等价标准（sharp → Java）
- [ ] ffmpeg 参数与 `-progress` 解析输出等价标准
