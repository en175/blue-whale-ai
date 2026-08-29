# 生成任务失败消息体统一设计（Generation Error Unification）

- **状态**：Accepted（一期已实施；二期修订结构见文末）
- **日期**：2026-08-28（一期）；2026-08-29（二期修订）
- **决策者**：李小强（经 `grill-with-docs` 会话确认）
- **关联工单**：需求 IKAZIG 下「任务」子工单 IKBQEE（一期 + 二期）
- **上游决策**：[ADR-0074 前后端分离 NestJS Product API](0074-frontend-backend-separation-nestjs-product-api.md)、[ADR-0075 generation-worker 入 NestJS](0075-generation-worker-into-nestjs-backend.md)、[ADR-0076 媒体提取复用 generation_jobs](0076-media-extract-reuse-generation-jobs-and-ffmpeg.md)
- **触发案例**：job 1494（图片 `doubao-seedream-5-0-260128`）失败 `error` 存 provider 原文 `{"code":"provider_failed","message":"The request failed because your account has an overdue balance. Request id: 0217..."}`——quota 语义被 `provider_failed` 吞掉、英文原文进 DB。

## 背景

`generation_jobs` 失败态通过 `GET /api/jobs/:id` 与快照接口以 `error` 对象暴露给前端。现状问题（两个只读探查结论）：

1. **错误码无统一清单**：码全部散落在 worker / runner 的内联字符串字面量。唯一收口 `backend/libs/shared/jobs/public-error.ts` 的 `KNOWN_CODES`（26 个）是白名单，但**实际在用码大量不在其中**（`model_unavailable`、`provider_config`、`unsupported_type`、`quota_exhausted`、`provider_timeout`、`unsupported_input`、`invalid_video_response`），投影时被 fallback 成笼统的 `image/video/media_extract_generation_failed`，**语义丢失**。
2. **`retryable` 恒为 `false`**：与事实矛盾——图片 `provider_failed` 有指数退避自动重试（`TRANSIENT_IMAGE_ERROR_CODES`，`generation-worker.ts:44`），对外却恒 false。`retry_after_seconds` / `request_id` / `input_request_id` / `budget_effect` 全是恒 null/"none" 占位。
3. **provider 原文透传进 DB**：new-api 视频/图片把上游 `task.error.message` 原样写入 `error.message`（如 1494 的英文欠费文案）。对外投影虽经 `messageFor()` 重新生成中文，但**语义细节（欠费 vs 服务不可达）在 code 层丢失**，DB 原文也非结构化。
4. **同语义多码**：`invalid_input`/`invalid_video_inputs`/`unsupported_input`/`unsupported_video_inputs` 并存；参考素材不可用三套码（`unsupported_input`/`reference_asset_unavailable`/`source_asset_unavailable`）；`provider_failed`（catch 兜底）/`media_extract_failed`/`xxx_generation_failed`（fallback）并存。
5. **创建期与执行期两套表达**：创建期校验（`handle-create-generation-job` 等）直接 HTTP 400 裸中文（"参考图最多 N 张"），执行期同语义是 `unsupported_input`；同一语义两种形态。
6. **前端只消费 `message`**：`web/src/api/jobs.ts` 定义 `JobError{code,message,retryable}`，画布 MediaNode 失败态只读 `detail.error?.message`；`retryable`/`code` 无任何消费点。媒体提取另有第二份文案映射 `mediaExtract.ts ERROR_CODE_TEXT`，与后端 `messageFor()` 双份维护。

## 决策

1. **统一错误码清单（枚举化）**：新建 `backend/libs/shared/jobs/error-codes.ts` 定义 `GenerationErrorCode` 常量/枚举，收拢**所有在用码**，按语义分五类（input / provider / processing / safety / internal）。**只登记不动名**：历史 DB 已写入的 `error.code` 字面量不动（仅新写入使用枚举）；**同语义合并**以收敛重复码，合并映射表在落地工单中定死（见「落地拆解」工单 1）。`public-error.ts` 的 `KNOWN_CODES` 改为引用该枚举，**不再 fallback 丢码**——白名单外码只可能是新枚举遗漏（lint/测试兜底），投影保留原始 code + 对应中文文案。
2. **对外错误对象结构**：顶层 `{code, message, retryable}` **保持兼容不变**（前端零改动、`public-error.ts` 返回形状兼容），新增两个**纯增量**字段：
   - `details?`：调试详情（DB 原文、provider request_id、重试次数等），**禁止展示给用户**，供排查/埋点。
   - `params?`：结构化上下文（契约预留，本期只对个别码填，如 `{max_reference_count}`），供前端后续拼接文案/定位。
   - 恒占位字段 `retry_after_seconds` / `request_id` / `input_request_id` / `budget_effect` **移除**（不再输出）。`retry_after_seconds` 语义并入 `params`。
3. **message 两档制**：DB `error.message` 保留**原始失败信息**（provider 原文/请求详情，调试价值）；对外 `error.message` **一律**经 `messageFor()` 生成**用户可读中文**，杜绝 provider 原文/英文 request id 到前端。`messageFor()` 补齐枚举**全部码**（含现在缺的 `model_unavailable`/`quota_exhausted`/`unsupported_input`/`provider_config`/`provider_timeout`/`unsupported_type` 等）。provider 原文与结构化详情进 `details`。
4. **`retryable` 真实计算**：后端按码判定（瞬时可重试 = `provider_failed` / `provider_timeout` 等上游瞬时类；不可重试 = `invalid_input` / `unsupported_input` / `model_unavailable` / `quota_exhausted` / `provider_credential_missing` / `content_rejected` 等），替代恒 false。**前端本期不消费**（前端零改动，`retryable` 由前端同事后续使用）。
5. **quota 语义还原**：new-api 402 → `quota_exhausted`（现在是 `provider_failed` 吞掉语义，见 1494）；与 `retryable:false` 组合。该码供前端后续做充值引导（非本期）。
6. **创建期校验统一码**：`handle-create-generation-job` / `handle-retry-generation-job` 的 HTTP 400 裸中文，升级为**统一枚举码 + 中文 message**（响应体结构不变，前端 `e.message` 消费不变）。
7. **前端零改动**：本期只改后端（error 枚举、public-error 投影、fail 调用点、创建期校验、DB 写入）。契约字段对前端是纯增量（JSON 多字段，前端类型未声明即忽略）。前端 `mediaExtract.ts` 双份映射**维持现状**，后端 message 完善后成为无害冗余，**由前端同事后续清理**（不属本期）。
8. **不在本期**：`partially_succeeded` 的失败槽位统一展示、执行期 `quota_exhausted` 充值弹框、不可重试 UI（重试按钮置灰）、i18n/多端文案抽象。均为前端消费侧，留待前端同事或后续工单。

## 被否方案

- **前端唯一文案映射 / 共享包（contracts）放 code→文案**：当前无 i18n、无多端（仅 web 画布），后端唯一生成最省事；等真有多端/i18n 需求再升级。
- **错误码重命名新分类法（如 `asset_unavailable` 前缀）**：历史 DB 数据兼容成本高、收益低；只登记不动名 + 合并同语义足够。
- **`retryable` 维持假字段**：与事实矛盾且误导未来消费方。
- **DB 只存用户可见中文**：丢失调试原文；`details` 两档制兼顾用户展示与排查。
- **全部推翻重来 / 历史码废弃**：破坏历史数据可读性，无必要。

## 后果

- 新增 `GenerationErrorCode` 枚举 + `messageFor()` 全覆盖；`projectPublicError()` 返回 `{code, message, retryable, details?, params?}`（顶层兼容）。
- worker / video-job-runner / media-extract-runner / media-extractions.service 的 fail 调用点字面量迁移到枚举常量；new-api 402 归一为 `quota_exhausted`。
- DB `error` JSON 新增 `details` 字段；旧记录无 `details`，投影时向后兼容（`details ?? null`）。
- 新写失败记录 code 为 canonical 码；旧记录保持原样，投影时若 code 不在新清单按类型 fallback（仅极少数历史死码会触发）。
- 前端契约无破坏：现有 `{code,message,retryable}` 继续可用，新增字段为增量；前端同事后续可消费 `retryable`/`params`/`details`。
- 1494 类欠费失败在统一后投影为：`{code:"quota_exhausted", message:"账户余额不足，请充值后重试", retryable:false, details:{raw:"The request failed because your account has an overdue balance. Request id: ..."}}`。

## 落地拆解（建议子任务）

| # | 子任务 | 内容 | 影响面 |
|---|---|---|---|
| 1 | 错误码枚举 + 投影补齐 | `error-codes.ts` 建枚举（五类）、`public-error.ts` 引用枚举、`messageFor()` 全覆盖、`retryable` 真实计算、`details`/`params` 输出、移除占位字段 | backend/libs/shared/jobs + 测试 |
| 2 | worker/runner 失败点迁移 | `generation-worker.ts`、`video-job-runner.ts`、`media-extract-runner.ts`、`media-extractions.service.ts` 的 fail 字面量 → 枚举；new-api 402 → `quota_exhausted`；provider 错误归一 | generation-runtime / generation-worker + 测试 |
| 3 | 创建期校验统一码 | `handle-create-generation-job.ts`、`handle-retry-generation-job.ts` 等 HTTP 400 裸中文 → 统一枚举码 + 中文 message | backend apps/blue-whale + 测试 |
| 4 | DB 写入结构 | `failJob`/`failVideoJob`/`failMediaExtractJob`/`markFailed` 落 `details`；投影向后兼容旧记录 | packages/persistence + 测试 |
| 5 | 前端（同事，非本期） | 消费 `retryable`（不可重试不显示/置灰重试）、`params`、`quota_exhausted` 充值引导；清理 `mediaExtract.ts` 双份映射 | web/ |

---

## 二期修订（2026-08-29）：失败响应结构升级为顶层数值码 + 中文 msg

### 背景

一期（子任务 1-4 落地）后，失败响应为 `{code:200, data:{..., error:{code,message,retryable,params}}}`——错误码是**字符串 canonical**、`retryable` 恒 true、`params` 恒 null。前端只消费 `message`，`code`（字符串）无精确分支能力。用户明确要求：

- **msg 按不同错误码返回对应中文**；
- **错误码全项目统一**（生成任务 + 未来 Agent/资产/支付等领域都可扩展），**每错一码**（非归类）；
- 响应结构升级为顶层 `{code, msg, data}`，用户格式示例：
  `{code:1001, data:{job_id:"1579", status:"failed", progress:0, asset:null}, msg:"账户余额不足，请充值后重试"}`
- 前端改动由同事另做，后端只出结构。

### 决策（二期）

1. **失败响应结构**：`GET /api/jobs/:id` 失败不再用 `data.error` 子对象，错误码提升到**顶层 `code`**（数值码）、中文文案在**顶层 `msg`**；`data` 只放纯任务字段 `{job_id, status, progress, asset}`。成功保持 `code=200`。前端 `apiRequest` 见 `code !== 200` 抛 ApiError（`msg` 即中文），轮询需在 `.catch` 收敛失败态（前端同事适配点）。
2. **数值错误码（对外契约）**：在 `packages/contracts/src/generation-error-codes.ts` 建跨包共享的字符串码 → 数值码映射表（28 码 → 1001-1028，`quota_exhausted=1001`，未知/白名单外兜底 `1000`）；段位约定写入 `result.ts`：`4xx/5xx`=HTTP 语义、`1xxxx`(100000+)=Java SystemCode、**`1xxx`(1000-1999)=领域错误码**（生成领域 1001-1028，其他领域从 1100+ 起扩展）。`errorCodeToNumeric(code)` 为唯一转换入口。
3. **快照接口**：`generation_jobs[].error` 保持子对象形态，内容升级为 `{code: 数值码, message: 中文}`（同表同文案）。
4. **`retryable`/`params`/`details` 不再对外输出**：一期决策 #2/#3 的增量字段在二期**全部移除**（`details` 仍存 DB 供排查、不进响应）。对外错误对象收敛为 `{code: 数值码, message: 中文}`。
5. **投影逻辑**：`projectPublicError(storedError, type)` → 字符串码归一（`resolveErrorCode`）→ 白名单外按类型 fallback → `errorCodeToNumeric()` 映射数值码；`messageFor(code, type)` 按任务类型输出中文（video/audio/image/media_extract 分支）。`stored_error` 为 null 时返回 null，调用方（`jobs.service.ts`）同步用 `errorCodeToNumeric(fallbackErrorCode(type))` + `messageFor(fallback, type)` 兜底，保证 code 与 msg 一致。

### 二期后果

- `packages/contracts` 新增数值码映射表 + `PublicGenerationError{code:number, message:string}`（跨包共享唯一来源，web 与 backend 共用）。
- 前端**行为破坏**（同事适配）：失败轮询从 `.then` 读 `data.error` → `.catch` 读 `ApiError.msg`；字符串 code → 数值码分支。
- 历史字符串码（DB 旧记录）由投影归一映射，前端无需处理旧码。
- 全项目错误码段位约定落定（`result.ts` 注释），后续领域从 1100+ 顺延扩展。
- 对应代码：`packages/contracts/src/generation-error-codes.ts`、`backend/libs/shared/jobs/public-error.ts`、`backend/libs/shared/jobs/jobs.service.ts`、`backend/libs/shared/snapshot/handle-snapshot.ts`。对接文档见 `docs/api/generation-job-error.md`（v2）。
