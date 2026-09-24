# 上传 md5 去重 API 对接文档（前端）

> 需求：IKCNLS 上传 md5 去重（后端）。目的：同一用户上传内容相同的文件时，按 md5 去重，命中则复用已有素材，跳过 TOS 重复上传，**省流量省存储**。
> 版本：**v4（2026-09-23）**——v4 新增 §8：`asset` 带回素材关联与审核状态
> （`material_id` / `material_status`，IKI65H）。v3（2026-09-18）见 §7：`assets.md5` 不再只由上传写入
> （IKGS73）。v2（2026-09-18）见 §6：带素材库 id 上传时的自动关联与状态闸（IKGQWR / ADR-0093）。
> v1（2026-09-02）：md5 去重。所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，
> `code===200` 为成功，前端 `apiRequest` 已解包 `data`。

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

---

## 7. v3（2026-09-18，IKGS73）：`assets.md5` 不再只由上传写入

> 背景：此前 `assets.md5` **只有上传路径**会写（`createUploadedAsset`）。所有**生成产物**
> （`image` / `video` / `audio` / `media_extract` / `image_enhance`）落库时 `md5` 为空，
> 于是 md5 去重对生成产物完全失效。IKGS73 把 md5 补到全部生成路径。
>
> **第六个类型 `image_erase`（画布图片擦除）** 是后续新增的，在 0915 批次上随一次编译修复
> 一并接上——它走同一个 TOS 出口，md5 本来就已算出，只是接的时候漏了。

### 7.1 对本接口的影响：命中的来源变多了（行为，不是形状）

本文档 §0–§6 描述的**接口形状没有变化**。变化在**命中率**：

- 用户**先让模型生成一张图、再手动上传同一张图** —— v3 起 `dedup` 会命中，直接复用生成产物，
  不再重复 PUT 一份一模一样的对象到 TOS。v3 之前必然未命中。
- 反之亦然：生成产物会参与去重复用。

前端**无需任何改动**：`data.dedup === true` 的语义与返回形状都没变。

### 7.2 已知边界（去重在这几种情况下仍不生效）

1. **降级路径**：TOS 未配置时 video / image 直存供应商 URL，**手上没有字节**，`md5` 留空。
   这些产物不参与去重。worker 日志会打一行 warn 留痕。
   - 注意 `audio` 的 URL 回退路径**不依赖 TOS 配置**（上游只给 URL、没给字节），同样留空。
2. **存量数据**：v3 之前落库的生成产物 `md5` 仍为空，不回填。
3. **`image_erase` 没有降级路径**：TOS 对它**是硬依赖**（结果图 URL 24h 失效，不允许直存
   供应商 URL），所以它恒有字节、`md5` **恒非空**——六个类型里唯一不会落空的那个。
4. **`mask_erase` 遮罩中间素材**（IKGOTB）：`findOwnedByMd5` 显式排除 `source='mask_erase'`，
   否则用户手动上传与遮罩同字节的图时会命中遮罩资产、而该来源被资产列表排除，表现成
   「刚上传的图不见了」。**擦除产物本身不是遮罩**（它是 `source='generated'`），照常参与去重。
5. **擦除产物可能与它的输入字节相同**（空操作 / 未改动的擦除），此时两张资产的 `assets.md5`
   相同。今天无害——`findOwnedByMd5` 取 `orderBy id desc`（较新那条），前端也不把 md5 当
   节点身份用。但**别把 `assets.md5` 当成「这张图是独立生成的」的凭据**。

### 7.3 口径（改 md5 相关代码前必读）

`assets.md5` 的算法与编码是 **`computeFileMd5`（前端）与 `ContentDigest.md5Hex`（worker-java）
逐字节对齐**的：都对**原始字节**算、都输出 **32 位小写 hex**。

两边只要有一处偏了（换算法、改大小写、算的对象不同），字段照样非空但**一次都不会命中**——
而且不会报错、不会让任何测试变红。所以：
- worker-java 侧两个 TOS 出口共用**同一份** `ContentDigest`，不要各写一遍；
- `ContentDigestTest` 用 RFC 1321 公开向量把算法钉死，`TosMediaStorageTest` 钉住三处出口真的调了它。

---

## 8. v4（2026-09-23，IKI65H）：`asset` 带回素材关联与审核状态

> 背景：ADR-0093 决策 6 末句要求「前端去掉 `toLocalAssetRecord` 里硬编码的
> `material_status: 'Active'`，**改由服务端返回值决定**」——但服务端没返回过这个值。
> 本版把它补上：`dedup` 与 `complete` 的 `data.asset` 各多两个字段。

### 8.1 新增字段

`data.asset` 新增两字段，命名与语义对齐资产列表 `GET /api/assets` 的返回项：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `material_id` | `string \| null` | 这条资产绑定的素材库素材 id（`asset-...`）。**未绑定为 `null`** |
| `material_status` | `string \| null` | 该素材在本地镜像表里的状态：`Active` / `Processing` / `Failed`，**原样返回**。资产未绑素材、或本地没有这条素材的状态行时为 `null` |

命中时的 `data`：

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
      "size": 100,
      "material_id": "asset-20260820153209-6c9z8",
      "material_status": "Active"
    }
  },
  "msg": null
}
```

**两个字段恒在**——没有可给的值时是 `null`，不是不出现。调用方不必写「有没有这个 key」的分支。

### 8.2 四处口径

1. **只在有资产时才有**。`dedup` 未命中仍是 `{dedup:false}`，**不带**这两个字段（没有资产可依附）。
   `complete` 三个成功分支都带。
2. **`material_id` 是「这条资产此刻绑的那个」**，不是请求里传的 `materialId`。两者在
   「没传 `materialId`、但 md5 命中一条已绑素材的旧资产」时分叉——这时给的是那条旧资产身上的真实绑定。
3. **`material_status` 不保证是 `Active`。** 闸不过时接口回 400，所以「带 `materialId` 且刚过闸」那条路上
   它通常就是 `Active`。但下面三种情况不是：

   | 情况 | 值 | 为什么 |
   | --- | --- | --- |
   | `complete` 幂等重放（那条路**不重新过闸**，理由见 §6.4） | `Failed` / `Processing` | 资产可能挂着一个**后来**被判 `Failed` 的素材，而接口照回 200 |
   | `dedup` 命中一条已绑素材的旧资产、且请求**没带** `materialId` | `Failed` / `Processing` | 这条路压根没过闸（通用上传路径 `uploadAssetFile` 就是这条），回的是镜像原值 |
   | 闸放行了，但本地这条素材**没有状态行**、上游又没给 `GroupId`（闸此时不补行，见 ADR-0093 决策 3） | `null` | 拿不到任何状态 |

   ⚠️ **`null` 不等于「未通过」**，它的语义是「拿不到本地状态行」。判断素材可用性请认
   `material_status === 'Active'`，**不要**把 `null` 当成 `Failed` ——把两者混为一谈会让一张服务端
   刚刚判定通过并放行的素材，在消费端被当成未校验。
4. **这个值取自本地镜像，可能陈旧**。它不等于生成门的实时判定（生成采纳处会按需实时查上游）。
   镜像的新鲜度同理：不随每次响应刷新。

### 8.3 `dedup` 与 `complete` 的形状仍然完全一致

§1.2 那句「`data.asset` 形状与 `complete` 的响应 data 完全一致」**依然成立**：两个接口共用同一个
响应构造，两个接口这次一起改了。前端复用同一套解析仍然有效。

### 8.4 本期不动前端

前端侧「去掉 `toLocalAssetRecord` 硬编码 `material_status: 'Active'`」是独立工单；本版只产出后端契约。
在那边落地之前，这两个字段**在响应里存在但无人消费**。
