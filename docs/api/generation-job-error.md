# 生成任务失败错误体对接文档（前端）

> 需求：IKBQEE / ADR-0078「生成任务失败消息体统一设计」。覆盖生成任务（图片/视频/音频/媒体提取）失败后，`GET /api/jobs/:id` 与画布快照里**失败响应的统一结构**，前端据此展示失败文案、判断重试、识别余额不足。
> 版本：v2（2026-08-29，二期结构升级）。所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，`code===200` 成功，前端 `apiRequest` 已解包 `data`。

---

## 0. 总览

| 场景 | 接口 | 失败形态 |
|---|---|---|
| 任务轮询（生成中/已失败） | `GET /api/jobs/:id` | **顶层** `{ code: 数值码, msg: 中文, data: {job_id,status,progress,asset} }` |
| 画布水合（快照恢复） | 快照接口 | `generation_jobs[].error = { code: 数值码, message: 中文 }`（挂在任务对象上） |
| 创建/重试请求失败 | `POST .../generation-jobs` / `.../retry` | HTTP 层 `ApiError`（`msg`/`code`，`code=400`） |

> **二期结构升级要点**：失败不再用 `data.error` 子对象，错误码提升到**顶层 `code`**、中文文案在**顶层 `msg`**；`data` 只放纯任务字段。成功保持 `code=200`。

---

## 1. 轮询响应：失败任务（顶层结构）

```
GET /api/jobs/:id
```

`status === "failed"` 时：

```json
{
  "code": 1001,
  "msg": "账户余额不足，请充值后重试",
  "data": {
    "job_id": "1585",
    "status": "failed",
    "progress": 0,
    "asset": null
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | number | **数值错误码**（1xxx 段，见 §3 清单）。**每错一码**，前端可按码精确判断（如 `1001` 余额不足 → 引导充值）。未知/白名单外兜底 `1000` |
| `msg` | string | **用户可见中文文案**，后端统一生成，**不会泄漏 provider 原文/英文**。前端直接展示 |
| `data` | object | 纯任务字段：`job_id` / `status` / `progress` / `asset`。**不再包含 `error`/`retryable`** |

> ⚠️ **前端行为变化**：失败响应 `code !== 200`，`apiRequest`（`web/src/api/http.ts`）会**抛 ApiError**（`msg` 即中文文案）。轮询失败任务时**不能**依赖 `data.status`——它不可达，需在 `.catch` 里按 `ApiError` 收敛为失败态。旧接口（`code=200` + `data.error`）已不再返回。

### 非 failed 状态

`status` ∈ `queued` / `processing` / `succeeded` / `cancelled` 时响应 `code=200`，`data` 同构（`error` 字段无）：

```json
{ "code": 200, "msg": null, "data": { "job_id": "1584", "status": "processing", "progress": 30, "asset": null } }
```

---

## 2. 快照接口：generation_jobs[].error

画布水合（`GET /api/projects/:id/snapshot`）里，`generation_jobs[]` 每个任务带 `error` 字段（**仅 `status==="failed"` 有值，否则 `null`**）：

```json
"generation_jobs": [
  {
    "job_id": "1585",
    "status": "failed",
    "progress": 0,
    "type": "image",
    "error": {
      "code": 1001,
      "message": "账户余额不足，请充值后重试"
    }
  }
]
```

> 快照场景 `error` 是**挂在任务对象上的子对象**（结构 `{code: 数值码, message: 中文}`），因为快照是一整棵项目树，不能把错误提升到顶层。**与轮询接口的顶层结构不同，但语义一致**：`code` 同一张数值码表、`message` 同一份中文文案。

---

## 3. 创建/重试请求失败的 error（HTTP 层）

`POST /api/projects/:id/generation-jobs` 与 `POST .../:jobId/retry` 校验失败时：

```json
{ "code": 400, "msg": "参考图最多 10 张", "data": { "code": "unsupported_input", "params": { "max_reference_count": 10 } } }
```

- 前端 `apiRequest` 已抛 `ApiError(status, msg, code)`——**读 `msg` 展示即可**，行为与旧版一致
- `data.code` 为统一字符串错误码（可选，前端需要精确判断时用）
- `code===200` 且 `status==="failed"` 的**执行期失败**走 §1 的顶层结构，**不是**这个 HTTP 层 error

---

## 4. 数值错误码清单（对外契约）

> 前端可按 `code` 做分支（如余额不足引导充值）。`msg` 已足够展示，`code` 用于精确语义判断。**每错一码，一一对应**；未列出的未知码兜底 `1000`。

| 数值码 | canonical 字符串码 | msg（中文） |
|---|---|---|
| **1000** | （未知/白名单外） | 按任务类型兜底：视频/音频/图像生成失败 |
| **1001** | `quota_exhausted` | **账户余额不足，请充值后重试** |
| 1002 | `invalid_input` | 输入参数无效 |
| 1003 | `unsupported_type` | 不支持的生成类型 |
| 1004 | `unsupported_input` | 输入内容不支持 |
| 1005 | `model_unavailable` | 模型未开通或不可用 |
| 1006 | `reference_asset_unavailable` | 参考素材不可用 |
| 1007 | `reference_limit_exceeded` | 参考素材数量超过限制 |
| 1008 | `source_asset_unavailable` | 源视频资产不可用 |
| 1009 | `provider_credential_missing` | 生成服务凭证未配置 |
| 1010 | `provider_config` | 生成服务配置不完整 |
| 1011 | `provider_failed` | 视频/音频/图像生成失败（按任务类型） |
| 1012 | `provider_timeout` | 生成服务响应超时 |
| 1013 | `no_result` | 生成服务未返回结果 |
| 1014 | `submission_unknown` | 无法确认视频任务是否已提交 |
| 1015 | `timed_out` | 视频生成超时 |
| 1016 | `storage_failed` | 生成结果存储失败 |
| 1017 | `all_outputs_failed` | 所有输出均生成失败 |
| 1018 | `content_rejected` | 生成内容未通过安全审核 |
| 1019 | `content_review_unavailable` | 内容审核不可用 |
| 1020 | `media_extract_failed` | 音频提取失败 |
| 1021 | `video_generation_failed` | 视频生成失败 |
| 1022 | `image_generation_failed` | 图像生成失败 |
| 1023 | `video_has_no_audio_track` | 视频没有音轨 |
| 1024 | `video_download_failed` | 视频下载失败 |
| 1025 | `video_too_large` | 视频超过大小上限 |
| 1026 | `extract_failed` | 音频提取失败 |
| 1027 | `upload_failed` | 音频上传失败 |
| 1028 | `enqueue_failed` | 任务入队失败 |
| 1029-1043 | （后续工单新增细分码） | 能力目录/参考系/图像系（高清/擦除/扩图/抠图）/去字幕等兜底与细分码——单一来源 = `backend/libs/contracts/error-codes.ts` 数值表，此处不再逐行展开 |
| **1044** | `media_extract_provider_failed` | 音频提取失败，请重试（音视频分离火山执行路径兜底；本地 ffmpeg 链路兜底仍为 1020，映射口径 = 迁移契约 §18.4） |

> **段位约定**（全项目统一，`packages/contracts/src/result.ts`）：
> - `4xx`/`5xx`：HTTP 语义错误（参数/未授权/资源不存在等基础设施错误）
> - `1xxxx`（100000+）：Java SystemCode 系全局业务码
> - `1xxx`（1000-1999）：**领域错误码**——生成任务领域已用 1001-1028，其他领域（Agent/资产/支付等）从 1100+ 起扩展，每错一码、前端按码映射文案
>
> 历史旧码（`invalid_video_inputs` 等）由后端归一映射到 canonical 码再转数值码，前端无需处理。

---

## 5. 余额不足识别（code=1001）

后端在四类 provider（图片/视频/音频/new-api 视频任务）识别**欠费信号** → `quota_exhausted` → 数值码 `1001`：

- HTTP **402**
- 响应/body 含「预扣费|剩余额度|余额|额度不足」或 `quota`/`balance`/`insufficient` 关键词

**典型场景**（用户余额不足时，无论 HTTP 200+body 还是 402）：
```json
{ "code": 1001, "msg": "账户余额不足，请充值后重试", "data": { "job_id": "1585", "status": "failed", "progress": 0, "asset": null } }
```

> ⚠️ 历史已失败 job（改版前落库的 `provider_failed` 欠费）**不会重算**，仍显示「视频/图像生成失败」；新产生的欠费 job 才会是 `1001`。

**前端建议**：`code === 1001` 时引导充值（弹充值框/充值入口），而非普通重试。

---

## 6. 前端消费建议（供参考）

| code | 建议 UI |
|---|---|
| `1001`（quota_exhausted） | 显示 msg + **引导充值** |
| `1000`（未知兜底） | 显示 msg（按类型的中文兜底文案） |
| 其他 | 展示 msg，失败节点显示「重试」按钮（当前所有失败都可手动重试，`POST /retry` 只看状态） |

> 媒体提取（视频→音频）失败节点：后端已置 `genStatus:"failed"` + `errorText`（为 msg 中文），前端按现有逻辑展示即可。
>
> ⚠️ 轮询失败任务时 `apiRequest` 抛 ApiError（`code !== 200`），**不能在 `.then` 里读 `data.status`**——需在 `.catch` 里按 `ApiError.message` 收敛为失败态（参考画布 `pollJob` 的改造点）。

---

## 7. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-08-29 | 新增；一期实施后形态（`data.error` 子对象、`retryable` 恒 true、details 不返回、quota 识别） |
| v2 | 2026-08-29 | **二期结构升级**：失败从 `data.error` 子对象 → 顶层 `{code: 数值码, msg: 中文, data: 纯任务字段}`；字符串码 → 数值码表（1001-1028，每错一码，兜底 1000）；删除 `retryable`/`params` 对外输出；快照 `error` 保持 `{code,message}` 子对象（数值码 + 中文） |
