# 素材关联改造前端对接文档

> 需求：IKDJNZ 原始素材与真人/虚拟素材关联改造。后端任务：IKDJNZ。
> 版本：v1（2026-09-07）。覆盖两块改动：**素材上传带原始素材 id（关联绑定）** + **视频生成参考素材改单数组 `references`（保序）**。
> 前置阅读：[`docs/api/material-library.md`](./material-library.md)（素材库透传镜像、上游信封、两段式上传等基础契约）。

---

## 0. 本次改动的意图（为什么这么改）

| 痛点 | 现状 | 本次改造后 |
|---|---|---|
| 原始素材与素材库素材无关联 | 本地 `assets` 素材与素材库（虚拟/真人人像库）素材是两套孤立数据，互相找不到 | 上传素材库素材时**携带原始素材 id**，后端落关联字段；删除素材库素材/组时自动清关联 |
| 生成时参考素材**顺序丢失** | 前端把参考拆成 `reference_asset_ids` + `reference_materials` 两个数组传给后端，拆分两次丢前端拖拽顺序 | 改**单个有序数组 `references`**，数组顺序 = 上游顺序 |
| 关联素材走本地 url 而非素材库 id | 已关联素材库的本地素材生成时仍走本地 TOS url | worker 自动识别关联 → 走素材库 `asset://<素材id>`（不走 url），重复 id 去重 |

**一句话给前端**：上传素材库素材时多带一个 `SourceAssetId`；视频生成时把参考素材从「两个数组」换成「一个有序数组 `references`」。

---

## 1. 上传素材库素材时携带原始素材 id

### 1.1 接口

`POST /api/material/CreateAsset`（透传镜像，见 `material-library.md` §3.1）

**请求体新增字段 `SourceAssetId`**（原始素材 id，即本地 `assets` 表 id，纯数字字符串）：

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
   - `assets.material_id` = 上游返回的素材 id（`asset-...`）
   - `assets.material_group_id` = 请求 `GroupId`（`group-...`）
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

- `DeleteAsset` 成功 → 后端清所有 `assets.material_id` 等于该素材 id 的关联。
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
| `asset_id` | 二选一 | 纯数字字符串 | 本地 `assets` 表 id |
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
