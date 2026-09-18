# 上传 md5 去重 API 对接文档（前端）

> 需求：IKCNLS 上传 md5 去重（后端）。目的：同一用户上传内容相同的文件时，按 md5 去重，命中则复用已有素材，跳过 TOS 重复上传，**省流量省存储**。
> 版本：**v2（2026-09-18）**——v2 新增 §6：带素材库 id 上传时的自动关联与状态闸（IKGQWR / ADR-0093）。v1（2026-09-02）：md5 去重。所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，`code===200` 为成功，前端 `apiRequest` 已解包 `data`。

---

## 0. 影响：上传流程插入一步「查重」

**后端未改动现有 presign → PUT → complete 三步主链路**，只在**前端 presign 之前新增一次可选查重调用**。命中则整个上传流程可跳过；未命中走原三步。

**前端需改动点**：`web/src/api/assets.ts` 的 `uploadAssetFile()`（或新增一个封装），在 presign 前加：

```
计算文件 md5 → 调 POST /api/agent/assets/uploads/dedup
  ├─ 命中（data.dedup === true）→ 拿 data.asset，跳过 presign/PUT/complete，直接返回
  └─ 未命中（data.dedup === false）→ 走原有 presign → PUT → complete
```

> 前端 `uploadAssetFile` 现有逻辑：`fileToAssetType`（MIME→type）+ 大小校验 → presign → PUT → complete。只需在 presign 前插入查重。

---

## 1. 新增：上传 md5 查重接口

### 1.1 调用

```
POST /api/agent/assets/uploads/dedup
```

请求：
```json
{
  "type": "image",
  "mime": "image/png",
  "size": 102400,
  "md5": "aabbccddeeff00112233445566778899",
  "project_id": "55"
}
```
- `type`：`image`（≤20MB）/ `video`（≤200MB）/ `audio`（≤25MB）
- `mime` 须以 `type/` 开头
- `size`：字节，正整数
- `md5`：**前端在浏览器算好的文件 MD5**（32 位小写 hex）。前端可用 `crypto.subtle.digest` 或 `spark-md5`。
- `project_id`：**可选**。命中时把素材挂到该项目（建 project_asset 关联，跨项目复用）。不传则只查重不挂项目。

### 1.2 响应

**命中**（`data.dedup === true`）：
```json
{
  "code": 200,
  "data": {
    "dedup": true,
    "asset": {
      "asset_id": "526",
      "status": "ready",
      "type": "video",
      "url": "https://...",
      "width": 854,
      "height": 480,
      "duration": null,
      "mime": "video/mp4",
      "size": 100
    }
  },
  "msg": null
}
```
- `data.asset` **形状与 `/api/agent/assets/uploads/complete` 的响应 data 完全一致**——前端可直接复用已解析的资产对象，不必另写解析。
- `data.dedup === true` 时 **presign/PUT/complete 全部跳过**，拿 `data.asset` 继续。

**未命中**（`data.dedup === false`）：
```json
{ "code": 200, "data": { "dedup": false }, "msg": null }
```
- 前端走原有 presign → PUT → complete 三步。

**md5 格式不标准 / 类型不匹配**（后端视为未命中，不报错）：
```json
{ "code": 200, "data": { "dedup": false }, "msg": null }
```
- 后端对不合法 md5 **fail-open**（返回 `dedup:false`），不会阻断上传。前端无需特殊处理，未命中就正常上传。

**错误**：
- `code: 100301`：`project_id` 非 0 但项目不存在/不归属。前端按资源不存在处理（当前不应出现，因为 presign 前项目已建立）。

---

## 2. 复用的既有接口（未改动）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/agent/assets/uploads/presign` | 获取 TOS 预签名（**仅在 dedup 未命中时调用**） |
| POST | `/api/agent/assets/uploads/complete` | 上传完成落库。**新增可选入参 `md5`**（字符串），落库存 md5 供下次查重 |
| POST | `/api/projects/:pid/assets/:assetId/link` | 素材-项目关联（`dedup` 命中时会自动调，前端也可不用管）|

`complete` 请求体新增字段（**可选**）：
```json
{ "md5": "aabbccddeeff00112233445566778899" }
```
- 不传也能用（旧行为），传了则落库写 md5，**后续同内容文件会命中查重**。建议 `uploadAssetFile` 在 complete 时也带上 md5。

---

## 3. 前端 MD5 计算建议

前端在浏览器计算文件 md5（异步，大文件建议流式计算避免卡主线程）：

```ts
async function fileMd5(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("MD5", buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
```

> 注意：`crypto.subtle.digest("MD5")` 在非 HTTPS（`localhost` 除外）会因 `[SecureContext]` 不可用。若产品在 http 环境，建议用 `spark-md5` 等库。后端对格式不标准 md5 会 fail-open，**不会丢上传**，但会失去去重效果。

---

## 4. 对接要点总结

| 项 | 说明 |
|---|---|
| 改动范围 | 前端仅在 `uploadAssetFile` presign 前插入 dedup 调用 |
| 新增接口 | `POST /api/agent/assets/uploads/dedup`（1 次往返，失败不影响上传）|
| 命中 | `data.dedup===true` → 拿 `data.asset` 直接复用，跳过上传 |
| 未命中 | `data.dedup===false` → 原有 presign→PUT→complete |
| 幂等 | 同一文件重复上传 → 命中复用；`complete` 带 md5 后可跨项目复用 |
| 边界 | 后端只做去重，**不改变**主链路；md5 不合法/类型不匹配一律 fail-open |

---

## 5. 相关工单

- IKCNLS 上传 md5 去重（后端）
- IKCNLP 资产删除一致性（project_asset 关联表，`link` 接口被 dedup 命中复用）——见 `docs/api/` 相关文档或工单

---

## 6. v2（2026-09-18，IKGQWR / ADR-0093）：带素材库 id 上传时的自动关联与状态闸

> 背景：人像库（虚拟 + 真人）素材进画布要先转成本地资产。`!726` 落了骨架（`materialId` 字段、
> md5 命中即关联、按素材库 id 反查免上传），本版补上**状态闸**、**`material_group_id` 落列**与
> **覆盖语义**。设计全文见 `docs/adr/0093-material-autolink-and-upload-gate.md`。

### 6.1 请求体字段 `materialId`

`POST /api/agent/assets/uploads/dedup` 与 `POST /api/agent/assets/uploads/complete` 的请求体各有一个**可选**字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `materialId` | string | 否 | 素材库素材 id，`Asset-` 前缀（大小写不敏感）。格式不符 → **静默忽略并跳过关联**，不影响上传本身 |

> ⚠️ 命名不一致：同一 DTO 里 `storage_key` / `project_id` 是 snake_case，这个字段是 camelCase。`!726` 已合入，**沿用不改**——改名是纯破坏性 churn，收益只是命名一致。

### 6.2 `dedup` 多了一条命中路径

带 `materialId` 时，后端除了 md5 还会**按素材库 id 反查本地资产**：

- **md5 未命中 ≠ 要上传。** 反查命中时同样返回 `{dedup:true, asset}`。
- **md5 算不出来时也要照常调 dedup**（例如跨域导致 md5 为 `undefined`）。只要带 `materialId`，反查仍可能命中。

`data.dedup` 的语义与返回值形状**没有变化**，前端不需要区分命中来源。

### 6.3 新增错误：`400 + code 2013`

闸不过时 `dedup` / `complete` 返回产品信封（**不是**上游信封）：

```json
{ "code": 2013, "msg": "该素材未审核通过，不能用于视频生成", "data": null }
```

`code` 固定为 `2013`（`ASSET_MATERIAL_UNAVAILABLE`），**前端按 `msg` 分流**（与生成门同款口径，ADR-0087 决策 6）：

| `msg` | 含义 | 前端动作 |
| --- | --- | --- |
| `该素材未审核通过，不能用于视频生成` | 终局：素材 `Failed`，或上游已不存在 | 引导重走合规校验，**不要给重试按钮** |
| `素材状态校验失败，请稍后重试` | 暂时故障：上游不可达 / 鉴权 / 限流 / 5xx | 给重试入口 |

⚠️ **不要按两个 code 分流**——刻意的一个码两条 msg，与生成门一致；拆成两个码会让用户在上传口和生成口拿到两套话术。

### 6.4 `complete` 被拒时会删掉刚 PUT 的对象

闸不过时后端会把 `storage_key` 指向的对象从 TOS 删掉（对齐既有 `rejectUploadedObject` 惯例——「留着它没有任何用处，正因为没有任何一行数据指向它」）。前端必须知道：

- 被拒后**不能**拿同一个 `storage_key` 重试 `complete`（对象已删），要重走 `presign → PUT → complete`。
- 不要假设「文件已经传上去了，只是没关联上」。

### 6.5 §0 那条「绝不阻断上传」变了——**只对带 `materialId` 的请求**

第 0 节说「后端只做去重，不改变主链路；md5 不合法一律 fail-open」，这对**不带 `materialId`** 的请求逐字成立，回归不受影响。但带上 `materialId` 之后，素材状态是用户**明确指名**要关联的对象——放行等于让一张不可用的素材悄悄变成可用的本地资产。所以那条路径是 **fail-closed** 的，§0 的表述只覆盖前者。

### 6.6 `complete` 复用既有资产时会回收这份新字节

若本地已有该素材对应的资产（反查命中），后端直接复用，并把前端这次 PUT 上来的那份多余对象一并删掉（仅当它不是被复用那行的对象）。前端同样不要假设这个 `storage_key` 还活着。
