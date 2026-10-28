# 素材关联改造前端对接文档

> 需求：IKDJNZ 原始素材与真人/虚拟素材关联改造。后端任务：IKDJNZ。
> 版本：**v2（2026-09-11，IKEXX8 增补 §6）**；v1（2026-09-07）覆盖：**素材上传带原始素材 id（关联绑定）** + **视频生成参考素材改单数组 `references`（保序）**。
> 前置阅读：[`docs/api/material-library.md`](./material-library.md)（素材库透传镜像、上游信封、两段式上传等基础契约）。

---

## 0. 本次改动的意图（为什么这么改）

| 痛点 | 现状 | 本次改造后 |
|---|---|---|
| 原始素材与素材库素材无关联 | 本地 `user_assets` 素材与素材库（虚拟/真人人像库）素材是两套孤立数据，互相找不到 | 上传素材库素材时**携带原始素材 id**，后端落关联字段；删除素材库素材/组时自动清关联 |
| 生成时参考素材**顺序丢失** | 前端把参考拆成 `reference_asset_ids` + `reference_materials` 两个数组传给后端，拆分两次丢前端拖拽顺序 | 改**单个有序数组 `references`**，数组顺序 = 上游顺序 |
| 关联素材走本地 url 而非素材库 id | 已关联素材库的本地素材生成时仍走本地 TOS url | worker 自动识别关联 → 走素材库 `asset://<素材id>`（不走 url），重复 id 去重 |

**一句话给前端**：上传素材库素材时多带一个 `SourceAssetId`；视频生成时把参考素材从「两个数组」换成「一个有序数组 `references`」。

---

## 1. 上传素材库素材时携带原始素材 id

### 1.1 接口

`POST /api/material/CreateAsset`（透传镜像，见 `material-library.md` §3.1）

**请求体新增字段 `SourceAssetId`**（原始素材 id，即本地 `user_assets` 表 id，纯数字字符串）：

```ts
// 前端两段式上传第 2 步：uploadAssetFile 拿公网 URL 后调 CreateAsset
{
  GroupId: "group-20260827113901-cbkmf",  // 素材库组 id（既有）
  URL: "https://bluewhale-asset.tos-cn-shanghai.volces.com/uploads/50/image/xxx.jpg", // 既有
  Name: "素材1",                            // 既有
  AssetType: "Image",                       // 既有：Image / Video / Audio
  SourceAssetId: "4946"                     // ⭐ 新增：原始素材 id（uploadAssetFile 返回的 asset_id）
}
```

### 1.2 后端行为

1. 透传前**剥离 `SourceAssetId`**，上游收到的请求体保持原样（不含该字段）。
2. 上游 `CreateAsset` 成功后，后端用 `SourceAssetId` + 上游返回的素材 id + 请求 `GroupId` 落库关联：
   - `user_assets.material_id` = 上游返回的素材 id（`asset-...`）
   - `user_assets.material_group_id` = 请求 `GroupId`（`group-...`）
3. 关联覆盖写：同一原始素材重复上传素材库素材 → 以后一次为准。
4. `SourceAssetId` 非纯数字 / 素材 id 或组 id 非 `asset-...`/`group-...` 格式 → 跳过绑定（不影响素材库上传本身）。

### 1.3 前端改动

- `web/src/api/material.ts` 的 `CreateAssetParams` 增加 `SourceAssetId: string`。
- 上传流程（`Assets/index.tsx` 素材库分组详情视图）`createMaterialAsset({...})` 时带上 `uploadResult.asset_id`：

```ts
const uploadResult = await uploadAssetFile(file);          // 返回 { asset_id, url, ... }
await createMaterialAsset({
  GroupId: materialDetailGroupId,
  URL: uploadResult.url,
  Name: finalName,
  AssetType: assetType,
  SourceAssetId: uploadResult.asset_id,                    // ⭐ 新增
});
```

> **为什么前端要传 `SourceAssetId`**：后端是「收到什么存什么」——不靠 URL 反查、不靠内容识别。前端不传则绑定不生效，生成时该素材不会自动转素材库引用。

### 1.4 删除同步清关联（后端自动，前端无感知）

- `DeleteAsset` 成功 → 后端清所有 `user_assets.material_id` 等于该素材 id 的关联。
- `DeleteAssetGroup` 成功 → 后端按组 id 批量清 `material_id` + `material_group_id`。

前端不需要额外调用清理接口。

---

## 2. 视频生成参考素材：单数组 `references`

### 2.1 接口

`POST /api/projects/:projectId/generation-jobs`（视频生成）

**请求体新增字段 `references`**（单数组，保序）：

```ts
type RefItem =
  | { role: 'first_frame'; asset_id?: string; material_id?: string; type: 'image' }
  | { role: 'last_frame';  asset_id?: string; material_id?: string; type: 'image' }
  | { role: 'reference';   asset_id?: string; material_id?: string; type: 'image' | 'video' | 'audio' };

references: RefItem[];
```

**完整示例**（含参考音频）：

```json
{
  "type": "video",
  "expected_output_count": 1,
  "parameters": {
    "prompt": "人物走过街角，镜头缓慢推进",
    "model_id": "seedance-2",
    "aspect_ratio": "16:9",
    "resolution": "720p",
    "duration": 8
  },
  "references": [
    { "role": "first_frame", "asset_id": "4946", "type": "image" },
    { "role": "last_frame",  "material_id": "asset-20260820153209-6c9z8", "type": "image" },
    { "role": "reference",   "asset_id": "4759", "type": "image" },
    { "role": "reference",   "material_id": "asset-20260827113901-ab12", "type": "video" },
    { "role": "reference",   "asset_id": "4972", "type": "audio" },
    { "role": "reference",   "material_id": "asset-20260901103002-cd34", "type": "audio" }
  ]
}
```

### 2.2 字段说明

| 字段 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `role` | ✅ | `first_frame` / `last_frame` / `reference` | 引用角色 |
| `type` | ✅ | `image` / `video` / `audio` | 媒体类型；**首尾帧只能 `image`**（`audio` 只能作普通参考） |
| `asset_id` | 二选一 | 纯数字字符串 | 本地 `user_assets` 表 id |
| `material_id` | 二选一 | `asset-` 前缀字符串 | 素材库素材 id |

> **参考音频**（`type: "audio"`，IKDJNZ）：与图片/视频参考同数组、同结构，`role` 必须为 `reference`。上游 Seedance 以 `audio_url` + `role: reference_audio` 提交（后端组装，前端只传 id）。

### 2.3 校验规则（后端创建期强制，400 拒绝）

1. 每项 `asset_id` / `material_id` **只能填一个**。
2. `first_frame`、`last_frame` 各**至多 1 个**；有尾帧**必须配首帧**。
3. 普通参考（`role: "reference"`）**≤ 12 个**（首尾帧不计入）。
4. **`references` 不能与旧参考字段混用**——同时出现 `reference_asset_ids` / `reference_materials` / `first_frame_asset_id` / `last_frame_asset_id` / `first_frame_material_id` / `last_frame_material_id` 任一 → 400 `references 不能与旧参考字段混用`。
5. 仅 `type: "video"` 支持；图片/音频带 `references` → 400。
6. **参考音频 `role` 必须为 `reference`**——`first_frame`/`last_frame` 带 `audio` → 400 `参考素材引用无效`。
7. **参考音频不计入图/视频 12 上限**：`role: "reference"` 且 `type: "audio"` 的项不占普通参考额度，与图片/视频参考分开计数。

### 2.4 关键语义（前端要知道的）

- **数组顺序 = 上游顺序**。首尾帧与普通参考可**混排**在同一数组，后端按数组序解析并送上游（不再拆两数组，顺序不再丢失）。
- **已关联素材自动转素材库引用**：某 `asset_id` 对应的本地素材若已通过 §1 绑定过 `material_id`，worker 生成时自动走 `asset://<material_id>`（**不走本地 url**），前端**无需**手动把它改成 `material_id`。
- **去重**：多个 `material_id` 相同时只保留**首次出现**（跨 role 生效，如首帧与参考同一素材只算一次）。
- **`asset://` 前端不关心**：`asset://<素材id>` 由后端 worker 组装，前端只传 id。
- **参考音频约束（worker 侧，submit 前）**：≤ 3 个参考音频；参考音频只在 Seedance 2.0 模型下可用（非 2.0 拒绝）。单个音频的时长/格式无本地校验，由上游强校验——**建议前端只放行 mp3/wav 等常规音频，控制时长**。

### 2.5 旧字段兼容（过渡期）

后端**保留**旧字段路径（`reference_asset_ids` + `reference_materials` + 首尾帧字段），前端未切新契约前旧路径照常工作。但：

- 新旧**不能混用**（见 §2.3 第 4 条）。
- 旧路径语义不变：首尾帧与普通参考**互斥**、帧位 asset/material 二选一。
- **建议前端直接切 `references` 单数组**：保序、支持混排，是本次改造的目标形态。

### 2.6 前端改动建议

`CanvasPage/index.tsx` 的 `startGenerationJob` 组装参考素材处，把「按 `asset-` 前缀拆两数组」改为「组装单个有序 `references` 数组」：

```ts
// 之前：referenceAssetIds + referenceMaterials 两个数组
// 之后：单个 references，每项标注 role + asset_id 或 material_id，保持用户拖拽顺序
const refs: RefItem[] = resolvedRefs.map((r, i) => {
  // r 可能是本地 asset（纯数字 id）或素材库素材（asset- 前缀）
  return {
    role: keyframe ? (i === 0 ? 'first_frame' : i === resolvedRefs.length - 1 ? 'last_frame' : 'reference') : 'reference',
    ...(/^asset-/i.test(r.id) ? { material_id: r.id } : { asset_id: r.id }),
    type: r.type,
  };
});
```

> 首尾帧场景：数组第一项 `role: "first_frame"`、最后一项 `role: "last_frame"`（成对出现），中间项 `role: "reference"`。

---

## 3. 错误码速查（新增校验相关）

| 场景 | HTTP / 产品 code | msg |
|---|---|---|
| 素材库上传绑定：`SourceAssetId` 非纯数字 | 忽略绑定（上传本身成功） | —（后端日志留痕） |
| 素材库上传绑定：上游素材/组 id 格式异常 | 忽略绑定（上传本身成功） | —（后端日志留痕） |
| 生成：`references` 含旧参考字段 | 400 | `references 不能与旧参考字段混用` |
| 生成：`references` 为空数组 | 400 | `参考素材不能为空` |
| 生成：`references` 项缺 `asset_id`/`material_id` 或双填 | 400 | `参考素材引用无效` |
| 生成：首帧重复 / 尾帧重复 | 400 | `首帧只能指定一个` / `尾帧只能指定一个` |
| 生成：有尾帧无首帧 | 400 | `尾帧必须与首帧一起使用` |
| 生成：首尾帧 `type` 非 image | 400 | `参考素材引用无效` |
| 生成：普通参考 > 12 | 400 | `参考素材最多 12 个` |
| 生成：参考音频当首尾帧（`role` 非 reference 且 `type` audio） | 400 | `参考素材引用无效` |
| 生成：非 video 带 `references` | 400 | `素材库引用仅支持视频生成` |

---

## 4. 前端改动清单（汇总）

1. `web/src/api/material.ts`：`CreateAssetParams` 增加 `SourceAssetId`。
2. 素材库上传处（`Assets/index.tsx` / `CharacterLibrary`）：`createMaterialAsset` 带 `uploadResult.asset_id`。
3. 视频生成参考素材组装（`CanvasPage/index.tsx`）：两数组 → 单数组 `references`（保序，role + asset_id/material_id）。
4. 生成任务请求类型（`web/src/api/jobs.ts`）：增加 `references` 字段类型。
5. 视频生成参考音频（IKDJNZ 扩展）：`references` 里增加 `{ role: 'reference', asset_id 或 material_id, type: 'audio' }` 项；音频只作普通参考，不做首尾帧；参考音频不计入图/视频 12 上限。

---

## 5. 注意事项

1. **`references` 与旧字段严格互斥**：前端切新契约后，不要再发旧字段（`reference_asset_ids` / `reference_materials` / 首尾帧字段），否则 400。
2. **顺序即语义**：`references` 数组顺序 = 上游顺序，前端按用户拖拽/选择顺序组装，不要自行分组排序。
3. **`SourceAssetId` 是绑定唯一入口**：漏传则不绑定；绑定后生成自动走素材库 `asset://`，无需前端在生成侧手动映射。
4. **素材 id 大写前缀也认**：`asset-` 前缀大小写不敏感（上游实测小写），前端正常传即可。
5. **账号维度隔离**：`asset-` id / `SourceAssetId` 均在同一登录账号下有效，跨账号无关联。
6. **历史数据不处理**：改造前的本地素材无 `material_id` 关联，生成时照旧走本地 url，不受影响。
7. **参考音频仅普通参考**：`role` 必须为 `reference`、`type` 必须为 `audio`；音频不能当首尾帧。
8. **音频生成参考素材（IKE4GC，接口先行）**：`type` 为 `audio` 的生成任务同样支持 `references`，但仅接受 **`type: "audio"` / `type: "image"`**（无首尾帧概念，`role` 必须为 `reference`；`video` 参考对音频无意义 → 400）。数量硬约束（seed-audio 官方限制）：**音频 ≤3 个、图片 ≤1 个、二者不可混用**。**音频生成不支持素材库（真人/虚拟人像库）引用**：`references` 项只能传本地资产的 `asset_id`（→ 本地 url），传 `material_id`（素材库 `asset://`）→ 400 `音频生成不支持素材库引用`（创建期拦截，前端下期接 UI 时只放行本地资产）。`text_prompt` 里的 `@AudioN`/`@ImageN` 内联标记由**前端**负责（后端不改 prompt，只透传 `references` 数组）——前端本期无需改动。

---

## 6. IKEXX8 增补（2026-09-11）：资产读路径暴露关联字段 + 虚拟组查询换源

### 6.1 `/api/assets` 与 snapshot 成对返回关联字段（⭐ 前端新增可读）

以下**既有接口**的每条素材记录新增两个字段（值即 §1 绑定的结果，未关联为 `null`）：

| 接口 | 位置 |
|---|---|
| `GET /api/assets`（列表） | 每条 record |
| 单资产详情 | 同投影 |
| `GET /api/projects/:id/snapshot` | `assets[asset_id]` map 每项（与 `asset_id`/`access_url`/`type` 并列） |

```ts
{
  // ...既有字段
  material_id: string | null;        // "asset-..."（素材库素材 id）
  material_group_id: string | null;  // "group-..."（所属组 id）
}
```

前端用途：不必再反查素材库即可判断「该本地素材已关联素材库」，可直接用 `material_id` 组装 `references`（§2）或做「已入库」角标。命名 snake_case 与既有字段一致；**请求侧零改动**。

### 6.2 `ListAssetGroups` / `GetAssetGroup` 虚拟组查询换源本地（请求/响应形状不变，前端无感）

后端对这两个 Action 内部分流，**入口、参数、响应信封均与上游一致**，前端代码无需任何改动；仅需知道的行为差异：

- `ListAssetGroups` 且 `Filter.GroupType === "AIGC"` → 返回**后端本地**虚拟组（即 §6.3 自动建的「默认分组：<userId>」，未上传过时为 `TotalCount: 0, Items: []`）；
- `GetAssetGroup` 的 `Id` 命中本地虚拟组 → 本地返回；**真人组（`LivenessFace`）仍实时查上游**，与改造前行为一致；
- 本地返回的 `Items[]` 字段：`Id` / `Name` / `GroupType: "AIGC"` / `CreateTime` / `UpdateTime`（ISO8601 秒精度，如 `2026-09-11T02:32:22Z`）；`ResponseMetadata.RequestId` 为后端合成值（`req_<uuid>`），**不要当作真实链路 id 用于排障关联**。

### 6.3 虚拟组自动建组（前端不感知组的存在，复习 + 补参数说明）

向虚拟人像库 `CreateAsset` **不传 `GroupId`** 时：后端自动确保当前用户的虚拟默认组（无则上游建组，`GroupType:"AIGC"` 由后端显式携带），并强制替换 `GroupId` 后透传。前端角色库上传路径继续不传组即可；真人组上传照常显式传 `GroupId`。

---

## 7. IKFYHJ 增补（2026-09-15）：素材读路径带上校验状态

### 7.1 三条读路径每条素材记录新增两个字段

在 §6.1 的 `material_id` / `material_group_id` 之后**并列**再加两个：

| 接口 | 位置 |
|---|---|
| `GET /api/assets`（列表） | 每条 record |
| `GET /api/assets/:assetId`（详情） | 同投影（与 `prompt` 并列） |
| `GET /api/projects/:id/snapshot` | `assets[asset_id]` map 每项 |

```ts
{
  // ...既有字段（asset_id / access_url / type / material_id / material_group_id）
  material_status: 'Active' | 'Processing' | 'Failed' | null;
  material_status_checked_at: string | null;  // ISO8601，最后一次向上游确认的时刻
}
```

| 取值 | 含义 |
|---|---|
| `'Active'` | 校验通过，可用于视频生成 |
| `'Processing'` | 上游仍在注册中 |
| `'Failed'` | 校验未通过 |
| `null` | **未关联素材库**，**或**关联了但后端没有该素材的状态记录（早于本功能入库的存量素材） |

**请求侧零改动**，字段名与 §6.1 同风格（snake_case）。

### 7.2 三条必须知道的口径

1. **这是本地镜像，可能陈旧 —— 不是判定依据。** 后端只跟进素材创建后 10 分钟内的状态；之后上游再变化（比如 `Active` 被撤销）就追不上。**「此刻能不能用」以生成接口为准**（创建/重试时会实时查上游，不通过直接 400）。
2. **`material_status_checked_at` 是给你判断有多旧的**：离现在越远越不可信。为 `null` 表示这条状态从没被上游确认过。
3. **不要用它替代生成失败的处理**：用户点生成仍可能因为素材已失效而拿到 400 `invalid_reference`，那条路径必须照常接（见 `material-library.md` §5.1）。

### 7.3 前端用途

开画布首屏、资产库列表即可点亮「校验中 / 校验通过 / 审核失败」角标，**不必为每个素材发一次 `GetAsset`**。需要更准的状态时再按单条素材实时查（`GetAsset`），或等生成接口的判定结果。

> **后端实现口径（供排障，前端不必关心）**：状态走**一次批量 `IN` 查本地镜像表**，不做 N+1、不在读路径打上游；整页一个素材都没关联素材库时不发查询。控制器对 `?size=` 没有上限、前端 `fetchAllAssets` 又是并发翻页全量拉取，所以 `IN` 列表按 500 分批。实测 1200 条/页（800 条有绑定）约 50–70ms。
