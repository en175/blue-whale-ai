# 生成任务失败错误体对接文档（前端）

> 需求：IKBQEE / ADR-0078「生成任务失败消息体统一设计」。覆盖生成任务（图片/视频/音频/媒体提取）失败后，`GET /api/jobs/:id` 与画布快照里**失败响应的统一结构**，前端据此展示失败文案、判断重试、识别余额不足。
> 版本：v3（2026-10-29，IKRE84：失败分类与可恢复性）。所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，`code===200` 成功，前端 `apiRequest` 已解包 `data`。

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
  "msg": "积分余额不足，本次尚未提交。",
  "data": {
    "job_id": "1585",
    "status": "failed",
    "progress": 0,
    "asset": null,
    "category": "quota",
    "retryable": false
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | number | **数值错误码**（1xxx 段，见 §3 清单）。**每错一码**，前端可按码精确判断（如 `1001` 余额不足 → 引导充值）。未知/白名单外兜底 `1000` |
| `msg` | string | **用户可见中文文案**，后端统一生成，**不会泄漏 provider 原文/英文**。前端直接展示 |
| `data` | object | 任务字段：`job_id` / `status` / `progress` / `asset`，以及失败分类 `category`、可重试标记 `retryable`（见 §2.1） |

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
      "message": "积分余额不足，本次尚未提交。",
      "category": "quota",
      "retryable": false
    }
  }
]
```

> 快照场景 `error` 是**挂在任务对象上的子对象**（结构 `{code: 数值码, message: 中文, category, retryable}`），因为快照是一整棵项目树，不能把错误提升到顶层。**与轮询接口的顶层结构不同，但语义一致**：`code` 同一张数值码表、`message` 同一份中文文案。


## 2.1 失败分类与可恢复性（IKRE84）

分类与可恢复性的唯一来源是后端码表（`backend/libs/contracts/error-codes.ts` 的 `ERROR_CATEGORY_CODES`）。前端按 `category` 决定文案与动作，**不要**自行维护 `code → 分类` 映射。

| category | 含义 | 前端动作 |
|---|---|---|
| `transient` | 可恢复临时异常 | 满足 §6 条件时显示一个「重试」 |
| `content_rejected` | 内容审核未通过 | 「修改内容」，原样重发不给重试 |
| `capability` | 参数/能力不支持 | 「修改参数」，定位不符项 |
| `reference` | 参考或源素材异常 | 「更换素材」 |
| `model_unavailable` | 模型/平台不可用 | 「修改模型」；平台额度不足**不引导充值** |
| `quota` | 用户积分不足 | 引导充值 |
| `storage` | 结果保存失败 | 只显示保存失败状态，不重新生成 |
| `quote_changed` | 报价变化/不可用 | 展示新报价，用户确认后再发 |
| `unknown` | 无可靠原因 | 通用兜底，保留输入供编辑，不给重试 |

`retryable` 只表示「属于可恢复临时异常」；是否真的出现重试入口，还要同时满足：任务已明确失败、服务端内部重试已结束、原输入仍完整有效、没有同次待核对的请求。

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

## 4. 数值错误码（对外契约）

**文案与分类的唯一来源是后端码表** `backend/libs/contracts/error-codes.ts`（`ERROR_CODES` / `ERROR_CATEGORY_CODES` / `GENERATION_MESSAGE_OVERRIDES`）。本文不再复制逐码文案，避免两份表漂移。

前端需要知道的语义锚点：

| 数值码 | canonical | 语义 | category |
|---|---|---|---|
| 1000 | （未知） | 白名单外兜底 | unknown |
| 1001 | `quota_exhausted` | **用户个人积分**不足，未受理 | quota |
| 1014 | `submission_unknown` | 受理不明，走「核对状态」，不给重试 | unknown |
| 1018 / 1038 / 1059 | `content_rejected*` | 内容审核未通过 | content_rejected |
| 1056 | `quote_stale` | 报价已变化 | quote_changed |
| 1061 | `platform_quota_exhausted` | **平台**额度不足，不引导个人充值 | model_unavailable |
| 1063 | `quote_unavailable` | 无法取得有效报价，本次未提交 | quote_changed |

其余 1002–1062 的文案、分类与可恢复性以码表为准；新增码必须同时补分类（穷举测试会拦）。

> **段位约定**（全项目统一，`packages/contracts/src/result.ts`）：
> - `4xx`/`5xx`：HTTP 语义错误（参数/未授权/资源不存在等基础设施错误）
> - `1xxxx`（100000+）：Java SystemCode 系全局业务码
> - `1xxx`（1000-1999）：**领域错误码**——生成任务领域已用 1001-1061，其他领域（Agent/资产/支付等）从 1100+ 起扩展，每错一码、前端按码映射文案
>
> 历史旧码（`invalid_video_inputs` 等）由后端归一映射到 canonical 码再转数值码，前端无需处理。

---

## 5. 额度不足识别：个人（1001）与平台（1061）分开

额度不足有**两个主体**，必须分开处理（决策见 [ADR-0128](../adr/0128-personal-vs-platform-quota-exhausted.md)）：

| 主体 | 码 | 什么时候出现 | 该做什么 |
|---|---|---|---|
| **用户个人积分** | `1001` `quota_exhausted` | 提交时预扣被拒，事务回滚、**不落 job** | 引导用户**本人充值** |
| **平台统一调用账户** | `1061` `platform_quota_exhausted` | 上游 new-api 拒单（402 / `insufficient_user_quota` / 欠费文案），落 `job.error` | 提示「生成服务额度不足，请联系平台管理员」，**不引导个人充值** |

new-api 只有一份共享凭证（`system_settings.upstream.new_api_key`），所以上游的额度错误**必然是平台账户**，不可能是用户个人。

**平台额度不足的典型响应**：
```json
{ "code": 1061, "msg": "生成服务额度不足，请联系平台管理员", "data": { "job_id": "3369", "status": "failed", "progress": 0, "asset": null } }
```

**上游识别链**（worker 失败分类）：版权 → 内容政策 → **额度（HTTP 402 或响应含「预扣费额度失败|剩余额度|余额不足|额度不足|balance|payment_required」）→ `platform_quota_exhausted`** → 兜底 `provider_failed`。

> ⚠️ **旧记录按证据补救**：改版前落库的 `quota_exhausted` job，投影时若 `error.message`（上游原文）命中上面的额度信号词 → 显示为 `1061`；命中不上则保持 `1001`。改版前落库的 `provider_failed` 欠费**不重算**。

**前端建议**：`code === 1001` 时引导充值；`code === 1061` 只展示 msg，**不要**弹充值框。

---

## 6. 前端消费建议（供参考）

| code | 建议 UI |
|---|---|
| `1001`（quota_exhausted） | 显示 msg + **引导充值** |
| `1061`（platform_quota_exhausted） | 显示 msg（「请联系平台管理员」），**不引导个人充值** |
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
| v3 | 2026-10-29 | IKRE84：失败响应新增 `category` 与 `retryable`（分类唯一来源在码表）；108 条生成码文案按 PRD 5.2/5.3 改写；新增 1063 `quote_unavailable`；删除 §4 逐码表，改为码表指针 |
| v2 | 2026-08-29 | **二期结构升级**：失败从 `data.error` 子对象 → 顶层 `{code: 数值码, msg: 中文, data: 纯任务字段}`；字符串码 → 数值码表（1001-1028，每错一码，兜底 1000）；删除 `retryable`/`params` 对外输出；快照 `error` 保持 `{code,message}` 子对象（数值码 + 中文） |
