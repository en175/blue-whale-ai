# 音频生成参考素材 前端对接文档

> 需求：**IKE4GC** 打通音频参考文件。版本 v1（2026-09-08）。
> 本辑为**纯后端接口先行**——音频生成（`type:"audio"`）已接受参考素材 `references`，前端本期**无需改动**（AudioDialog 仍纯文本），下期接 UI 时按本文档实现。
> 前置阅读：[`docs/api/2026-09-07-material-association-api.md`](./2026-09-07-material-association-api.md)（`references` 单数组契约）+ [`docs/api/material-library.md`](./material-library.md)（素材库两段式上传）。

---

## 0. 本次改动的意图

| 痛点 | 现状 | 本次改造后（接口层） |
|---|---|---|
| 音频生成不能带参考 | 音频生成（seed-audio-1.0）一期拒收一切参考素材（`音频生成一期不支持参考素材`） | `type:"audio"` 生成接受单数组 `references`（保序），后端校验 + 冻结 + 透传上游 |
| 音频参考能否用素材库 | — | **不支持**。音频生成参考**仅本地资产**（`asset_id`→本地 url），素材库（真人/虚拟人像库 `material_id`→`asset://`）创建期拦截 |

**一句话给前端**：音频生成现在能带本地音频/图片参考（`references`），但不能带素材库素材；prompt 里的 `@AudioN`/`@ImageN` 标记由前端负责，后端不改 prompt。

---

## 1. 请求体：音频生成 + references

`POST /api/projects/:projectId/generation-jobs`（`type:"audio"`）

```json
{
  "type": "audio",
  "expected_output_count": 1,
  "parameters": {
    "prompt": "@Audio1 海浪拍打礁石的声音，浑厚低沉",
    "model_id": "seed-audio-1.0"
  },
  "references": [
    { "role": "reference", "asset_id": "4946", "type": "audio" },
    { "role": "reference", "asset_id": "4950", "type": "image" }
  ]
}
```

> ⭐ **`@Audio1` 写进 `prompt` 是前端的事**（见 §4）。后端把 `references` 数组原样透传、`prompt` 原样透传，不做任何改写。

---

## 2. 字段说明

`references` 为**单数组、保序**，每项：

| 字段 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `role` | ✅ | **`reference`**（仅此值） | 音频/图片生成**无首尾帧**概念，`first_frame` / `last_frame` → 400 |
| `type` | ✅ | `audio` / `image` | 参考介质；`video` 对音频生成无意义 → 400 |
| `asset_id` | ✅ | 纯数字字符串 | **本地** `user_assets` 表 id（生成走本地 url） |
| `material_id` | ❌ | —— | **音频生成禁止素材库引用**，传了 → 400 `音频生成不支持素材库引用` |

**数量硬约束**（seed-audio 官方限制）：

- 音频参考 **≤ 3** 个
- 图片参考 **≤ 1** 个
- 音频 + 图片**不可混用**（同一次任务只能全音频或全图片）

---

## 3. 校验规则（创建期强制，400 拒绝）

| # | 规则 |
|---|---|
| 1 | `role` 非 `reference`（如 `first_frame`/`last_frame`）→ 400 `参考素材引用无效` |
| 2 | `type` 为 `video` → 400 `参考素材引用无效` |
| 3 | 音频参考 **>3** → 400 `参考音频最多 3 个` |
| 4 | 图片参考 **>1** → 400 `参考图最多 1 个` |
| 5 | 音频 + 图片混用 → 400 `音频与图片参考不可混用` |
| 6 | 项带 `material_id` → 400 `音频生成不支持素材库引用` |
| 7 | 与旧参考字段（`reference_asset_ids`/`input_asset_ids`/`reference_materials`/首尾帧字段）混用 → 400 `references 不能与旧参考字段混用` |
| 8 | 空数组 → 400 `参考素材不能为空` |

错误响应形如：`{ code: 400, msg: "音频生成不支持素材库引用", data: { code: "unsupported_input" } }`（`msg` 为中文文案，前端直接展示；`data.code` 供按码分支）。

---

## 4. `@AudioN` / `@ImageN` 标记（前端负责，本次不改）

seed-audio 用**内联标记**引用参考素材：在 `text_prompt` 里写 `@Audio1`、`@Audio2`… 对应 `references` 里第 N 个**音频**参考；图片用 `@Image1` 对应图片参考（图片参考仅 1 个）。

- **标记序号从 1 开始，按 `references` 数组顺序对应**。
- `@AudioN` 最大序号 ≤ 已传音频参考数；`@Image1` 只在传了图片参考时可写。
- **后端不改 prompt**——`prompt` 原样透传，是否写标记、怎么写完全由前端决定。

> ⚠️ 上线前请对上游查证一次 `@AudioN`/`@Image1` 的**精确写法**（是否区分大小写、是否 `@Audio 1` 带空格、图片参考是否也用 `@Image1` 还是自动生效）。后端不感知，只透传。

---

## 5. 前端改动清单（下期接 UI 时）

1. `web/src/api/jobs.ts` / `web/src/api/generation.ts`：`CreateJobPayload.parameters` 增加 `references`（`type:"audio"` 时），类型见 §2。
2. `AudioDialog`：增加参考素材选择（本地资产：音频/图片两类，按 §2 约束、§3 上限、且**只能本地资产**，不能从素材库/角色库选）。
3. 组装 `prompt`：把用户所选参考按序写成 `@AudioN`/`@ImageN` 内联标记。
4. 组装 `references`：`{ role:"reference", asset_id, type }`，**不传 `material_id`**。
5. 拖拽/选择顺序 = `references` 数组顺序 = `@AudioN` 序号。

**本期不改**：AudioDialog 保持纯文本（已下掉参考按钮），不实现以上 UI。

---

## 6. 注意事项

1. **音频参考仅本地资产**：`asset_id` → 本地 url。即使该本地素材已绑定素材库（`material_id`），音频生成也用本地 url，**不转 `asset://`**（与视频生成相反，视频偏好素材库、音频禁用素材库）。
2. **顺序即语义**：`references` 数组顺序 = 上游顺序 = `@AudioN` 序号，前端按用户选择顺序组装，勿自行重排。
3. **`material_id` 别传**：音频生成带素材库引用直接 400，前端下期在选参考 UI 里直接过滤掉素材库素材即可。
4. **历史/无参考不受影响**：不传 `references` 的音频任务（纯文本）照常生成，后端对空 references 不做额外处理。

---

## 7. 参考

- 上游 seed-audio `references` 协议：`POST /api/v3/tts/create`，字段 `references: [{ speaker|audio_data|audio_url }]`（音频）/ `[{ image_data|image_url }]`（图片），音频 ≤3、图片 ≤1、不可混用。
- new-api DoubaoAudio 通道（blue-whale-api `relay/channel/doubaoaudio`）**全透传**顶层字段（仅锁 `model`），`references` 原样到上游。
