# 上传 md5 去重 API 对接文档（前端）

> 需求：IKCNLS 上传 md5 去重（后端）。目的：同一用户上传内容相同的文件时，按 md5 去重，命中则复用已有素材，跳过 TOS 重复上传，**省流量省存储**。
> 版本：v1（2026-09-02）。所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，`code===200` 为成功，前端 `apiRequest` 已解包 `data`。

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
