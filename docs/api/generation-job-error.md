# 生成任务失败错误体对接文档（前端）

> 需求：IKBQEE / ADR-0078「生成任务失败消息体统一设计」。覆盖生成任务（图片/视频/音频/媒体提取）失败后，`GET /api/jobs/:id` 与画布快照里 `error` 对象的**统一结构**，前端据此展示失败文案、判断重试、识别余额不足。
> 版本：v1（2026-08-29）。所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，`code===200` 成功，前端 `apiRequest` 已解包 `data`。

---

## 0. 总览

| 场景 | 接口 | error 来源 |
|---|---|---|
| 任务轮询（生成中/已失败） | `GET /api/jobs/:id` | `data.error`（`status==="failed"` 时有值，否则 `null`） |
| 画布水合（快照恢复） | 快照接口 | 节点 `data.error` |
| 创建/重试请求失败 | `POST .../generation-jobs` / `.../retry` | HTTP 层 `ApiError`（`msg`/`code`） |

> 本次改动**前端零破坏**：`error` 顶层字段 `{code, message, retryable}` 与旧版**完全兼容**；只**删除**了旧占位字段（`retry_after_seconds`/`request_id`/`input_request_id`/`budget_effect`，前端没在用），**新增**了 `params`。原 `details` 字段**不再返回**（仅供后端排查，存在 DB）。

---

## 1. 轮询响应里的 error 对象

```
GET /api/jobs/:id
```

`status === "failed"` 时：

```json
{
  "code": 200,
  "data": {
    "job_id": "1565",
    "status": "failed",
    "progress": 0,
    "asset": null,
    "error": {
      "code": "quota_exhausted",
      "message": "账户余额不足，请充值后重试",
      "retryable": true,
      "params": null
    }
  },
  "msg": null
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string | 错误码（见 §3 清单）。**后端按语义归一的 canonical 码**，历史旧码会归一（如 `invalid_video_inputs`→`invalid_input`） |
| `message` | string | **用户可见中文文案**，后端统一生成，**不会泄漏 provider 原文/英文**。前端直接展示 |
| `retryable` | boolean | **当前恒 `true`**：任何失败都可用户手动重试（`POST /retry` 只看状态，失败原因由用户按 message 自判）。若未来某失败码不允许重试，后端会置 `false`，前端据此隐藏/置灰重试按钮 |
| `params` | object\|null | 结构化上下文（契约预留）。目前仅创建期参考图超限时带 `{max_reference_count}`；大多数场景 `null`。前端可选消费 |

### 删除的旧字段（前端无需适配）

`retry_after_seconds` / `request_id` / `input_request_id` / `budget_effect` —— 旧版恒 `null`/"none" 占位，已移除。

### 非 failed 状态

`status` ∈ `queued` / `processing` / `succeeded` / `cancelled` 时 `error` 为 `null`（仅 `failed` 才有）。

---

## 2. 创建/重试请求失败的 error（HTTP 层）

`POST /api/projects/:id/generation-jobs` 与 `POST .../:jobId/retry` 校验失败时：

```json
{ "code": 400, "msg": "参考图最多 10 张", "data": { "code": "unsupported_input", "params": { "max_reference_count": 10 } } }
```

- 前端 `apiRequest` 已抛 `ApiError(status, msg, code)`——**读 `msg` 展示即可**，行为与旧版一致
- `data.code` 为统一错误码（可选，前端需要精确判断时用，如余额/参考图超限）
- `code===200` 且 `status==="failed"` 的**执行期失败**走 §1 的 `data.error`，**不是**这个 HTTP 层 error

---

## 3. 错误码清单（canonical）

> 前端可按 `code` 做分支（如余额不足引导充值）。message 已足够展示，code 用于精确语义判断。

### input 类（输入/素材不合法）
| code | message（示例） |
|---|---|
| `invalid_input` | 输入参数无效（含历史 `invalid_video_inputs`/`invalid_reference_video` 归一） |
| `unsupported_input` | 输入内容不支持（含历史 `unsupported_video_inputs`/`unsupported_reference_type` 归一） |
| `unsupported_type` | 不支持的生成类型 |
| `model_unavailable` | 模型未开通或不可用 |
| `reference_asset_unavailable` | 参考素材不可用 |
| `reference_limit_exceeded` | 参考素材数量超过限制 |
| `source_asset_unavailable` | 源视频资产不可用 |

### provider 类（上游生成服务）
| code | message |
|---|---|
| `quota_exhausted` | **账户余额不足，请充值后重试**（new-api 402 或预扣费/余额不足信号，识别见 §4） |
| `provider_failed` | 视频/音频/图像生成失败 |
| `provider_timeout` | 生成服务响应超时 |
| `provider_credential_missing` | 生成服务凭证未配置 |
| `provider_config` | 生成服务配置不完整 |
| `no_result` | 生成服务未返回结果 |

### processing 类
| code | message |
|---|---|
| `submission_unknown` | 无法确认视频任务是否已提交 |
| `timed_out` | 视频生成超时 |
| `storage_failed` | 生成结果存储失败 |
| `all_outputs_failed` | 所有输出均生成失败 |

### safety 类
| code | message |
|---|---|
| `content_rejected` | 生成内容未通过安全审核 |
| `content_review_unavailable` | 内容审核不可用 |

### internal / 媒体提取
| code | message |
|---|---|
| `media_extract_failed` | 音频提取失败 |
| `video_has_no_audio_track` | 视频没有音轨 |
| `video_download_failed` | 视频下载失败 |
| `video_too_large` | 视频超过大小上限 |
| `extract_failed` | 音频提取失败 |
| `upload_failed` | 音频上传失败 |
| `enqueue_failed` | 任务入队失败 |
| `video_generation_failed` / `image_generation_failed` | 视频/图像生成失败（未知码兜底） |

> 未列举的未知 code：后端按任务类型兜底为 `video_generation_failed` / `media_extract_failed` / `image_generation_failed`，message 相应「视频/音频/图像生成失败」——前端**无需兜底分支**，message 永远可展示。

---

## 4. 余额不足识别（quota_exhausted）

后端在四类 provider（图片/视频/音频/new-api 视频任务）识别**欠费信号** → `quota_exhausted`：

- HTTP **402**
- 响应/body 含「预扣费|剩余额度|余额|额度不足」或 `quota`/`balance`/`insufficient` 关键词

**典型场景**（用户余额不足时，无论 HTTP 200+body 还是 402）：
```json
{
  "code": "quota_exhausted",
  "message": "账户余额不足，请充值后重试",
  "retryable": true
}
```

> ⚠️ 历史已失败 job（改版前落库的 `provider_failed` 欠费）**不会重算**，仍显示「视频/图像生成失败」；新产生的欠费 job 才会是 `quota_exhausted`。

**前端建议**：`code === "quota_exhausted"` 时引导充值（弹充值框/充值入口），而非普通重试。

---

## 5. 前端消费建议（供参考，非本期必做）

| code | 建议 UI |
|---|---|
| `quota_exhausted` | 显示 message + **引导充值**（`retryable` 仍 true，充值后可手动重试） |
| `retryable: false`（未来出现） | 隐藏或置灰重试按钮 |
| 其他 | 展示 `message`，失败节点显示「重试」按钮（当前所有失败都可重试） |

> 媒体提取（视频→音频）失败节点：后端已置 `genStatus:"failed"` + `errorText`（为 message 中文），前端按现有逻辑展示即可。

---

## 6. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-08-29 | 新增；对齐 IKBQEE / ADR-0078 实施后形态（retryable 恒 true、details 不返回、quota 识别） |
