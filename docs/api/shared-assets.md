# 画布共享资产 API 对接文档（前端）

> 需求：IK9QKP 画布共享资产。后端 `shared-assets` 模块，供画布共享资产面板、保存入口、资产库页调用。
> 版本：v1（2026-08-21）。所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，`code===200` 为成功，前端 `apiRequest` 已解包 `data`。

---

## 0. 总览

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/shared-assets/save` | 保存到共享资产（双入口：画布右键 / 资产库页） |
| GET | `/api/shared-assets` | 面板列表（类型过滤 + 分页） |
| GET | `/api/shared-assets/:id` | 详情（添加回画布取快照） |
| POST | `/api/shared-assets/:id/add-to-project` | 场景卡添加回画布（后端复制实体到目标项目） |
| DELETE | `/api/shared-assets/:id` | 移除共享条目 |
| POST | `/api/agent/assets/uploads/presign` | **上传素材**（复用既有；参考图/商品图/音色等取 URL 用） |
| POST | `/api/agent/assets/uploads/complete` | **上传完成**（复用既有；返回 url + asset_id） |

> 上传接口复用既有 agent-assets，前端 `api/assets.ts` 已有 `uploadAssetFile()`，无需新增。

**共享资产类型（两层，对齐画布节点）**：

| assetType | kind | 对应画布 | 说明 |
|---|---|---|---|
| `card` | `style` / `character` / `object` / `environment` / `custom` | assetNode.data.kind | 卡片（带参考图/描述/音色） |
| `media` | `image` / `video` / `audio` | mediaNode.data.mediaType | 媒体文件 |
| `goods` | —（null） | productNode | 商品 |
| `scene` | —（null） | scene_card | 场景卡 |
| `text` | —（null） | textNode | 文本 |

---

## 1. 上传素材（复用既有，供保存前取 URL）

保存卡片/商品/角色卡音色时，若素材是新上传的，先走上传拿到公开 URL，再拼进 snapshot。

### 1.1 获取预签名地址

```
POST /api/agent/assets/uploads/presign
```

请求：
```json
{ "type": "image", "mime": "image/png", "size": 102400 }
```
- `type`：`image`（≤20MB）/ `video`（≤200MB）/ `audio`（≤25MB）
- `mime` 须以 `type/` 开头

响应 `data`：
```json
{ "storage_key": "uploads/2/image/xxx", "upload_url": "https://...", "headers": {}, "expires_in": 600 }
```

### 1.2 直传文件

`PUT {upload_url}`，带 `headers`，body 为文件二进制。

### 1.3 完成上传

```
POST /api/agent/assets/uploads/complete
```
请求：
```json
{ "type": "image", "mime": "image/png", "size": 102400, "storage_key": "uploads/2/image/xxx" }
```
响应 `data`：
```json
{ "asset_id": "3821", "status": "ready", "type": "image", "url": "https://bluewhale-assets.tos-cn-beijing.volces.com/uploads/2/image/xxx.jpg", "width": 1024, "height": 768, "duration": 0, "mime": "image/png", "size": 102400 }
```
- `url` → 用作 snapshot 里 `src`；`asset_id` → 可作 `id`。

---

## 2. 保存到共享资产

```
POST /api/shared-assets/save
```

按 `assetType` 判别，**请求体形状不同**（多余字段会被拒绝）。

### 2.1 卡片（card）

```json
{
  "assetType": "card",
  "kind": "style",
  "snapshot": {
    "referenceImages": [{ "id": "img-1", "src": "https://.../a.jpg" }],
    "description": "赛博朋克",
    "voice": { "name": "女声", "src": "https://.../v.mp3" }
  }
}
```
- `kind`：`style`/`character`/`object`/`environment`/`custom`
- `voice` 仅角色卡（character）需要，可选
- **校验**：`referenceImages` 为空 且 `description` 为空 → `100408` 拒绝

### 2.2 媒体（media）

```json
{ "assetType": "media", "kind": "image", "sourceAssetId": "3821", "name": "生成-1043" }
```
- `sourceAssetId` = 画布 mediaNode 的 `assetId`（后端按 assets.id 抓取快照，不复制文件）
- `kind`：`image`/`video`/`audio`，须与源资产类型一致
- `name`：可选，默认取文件名

### 2.3 商品（goods）

```json
{
  "assetType": "goods",
  "snapshot": { "name": "商品 1", "detail": "", "images": [{ "id": "p1", "src": "https://.../p.jpg", "enabled": true }] }
}
```
- 对齐画布 productNode.data

### 2.4 场景卡（scene）

```json
{ "assetType": "scene", "sourceSceneCardId": "7" }
```
- `sourceSceneCardId` = 场景卡 id（后端抓取内容 + 生成预设快照）

### 2.5 文本（text）

```json
{ "assetType": "text", "snapshot": { "html": "<p>文案</p>" } }
```

### 2.6 响应

```json
{
  "code": 200, "msg": null,
  "data": {
    "created": true,
    "item": {
      "id": "115",
      "assetType": "card",
      "kind": "style",
      "name": "赛博朋克",
      "thumbnailUrl": "https://.../a.jpg",
      "snapshot": { "referenceImages": [{"id":"img-1","src":"https://.../a.jpg"}], "description": "赛博朋克" },
      "status": "normal",
      "createdAt": "2026-08-21T00:00:00.000Z"
    }
  }
}
```
- `created: false` = 已存在（媒体幂等/卡片去重/删除后重存复活），`item` 为既有项；前端据此 toast「该素材已在共享资产中」，**不要重复创建**。

---

## 3. 共享资产列表

```
GET /api/shared-assets?assetType=card&kind=style&page=1&size=20
```

查询参数（均可缺省）：

| 参数 | 取值 | 说明 |
|---|---|---|
| `assetType` | `card`/`media`/`goods`/`scene`/`text` | 第一层过滤；缺省 = 全部 |
| `kind` | `style`/`character`/`object`/`environment`/`custom`/`image`/`video`/`audio` | 第二层过滤；缺省 = 全部 |
| `page` | ≥1，默认 1 | 分页 |
| `size` | 1–100，默认 20 | 分页 |

面板常用组合：
- **全部**：`GET /api/shared-assets`
- **资产 tab（全部卡片）**：`?assetType=card`
- **资产子筛选 风格**：`?assetType=card&kind=style`
- **图片**：`?assetType=media&kind=image`
- **场景**：`?assetType=scene`

响应 `data`：
```json
{
  "records": [ { "id": "115", "assetType": "card", "kind": "style", "name": "赛博朋克", "thumbnailUrl": "...", "snapshot": {}, "status": "normal", "createdAt": "..." } ],
  "total": 42, "size": 20, "current": 1
}
```

---

## 4. 详情（添加回画布取快照）

```
GET /api/shared-assets/:id
```

响应 `data`：完整 `SharedAssetView`（含 `snapshot` 全量）。

**添加回画布**（除场景卡外的类型，前端据此拼节点，无后端写）：
- `card` → 构造 assetNode：`{ type:"assetNode", data:{ kind: item.kind, referenceImages: snapshot.referenceImages, description: snapshot.description, voice: snapshot.voice } }`
- `media` → 构造 mediaNode：`{ type:"mediaNode", data:{ src: snapshot.url, mediaType: item.kind, fileName: item.name } }`
- `goods` → 构造 productNode：`{ type:"productNode", data:{ name: snapshot.name, detail: snapshot.detail, images: snapshot.images } }`
- `text` → 构造 textNode：`{ type:"textNode", data:{ html: snapshot.html } }`
- **`scene` → 走接口 5**（需要后端复制实体）

---

## 5. 场景卡添加回画布

```
POST /api/shared-assets/:id/add-to-project
```

请求：
```json
{ "projectId": "169" }
```

响应 `data`：
```json
{ "sceneCardId": "77" }
```
- 后端在目标项目复制 `scene_cards` + `generation_presets`，返回新场景卡 id；前端再放 `scene_card` 画布节点引用它。

---

## 6. 移除共享条目

```
DELETE /api/shared-assets/:id
```
- 响应 `data: null`；用于 E8 失效条目的「提示移除」。
- 注意：本功能与 assets 互不影响，删除源素材不会级联删共享条目（快照自包含）。

---

## 7. 错误码

| code | 含义 | 处理 |
|---|---|---|
| 400 | 参数不合法（Zod 校验失败，含类型/形状不匹配） | 检查请求体 |
| 100202 | 源素材不可用或不存在 / 类型与保存类型不一致 | 提示刷新 |
| 100301 | 共享资产 / 场景卡不存在 | 提示刷新 |
| 100408 | 卡片无参考图且无描述（E6） | toast「请先为卡片补充参考图或描述」 |
| 100410 | 不支持的共享资产类型 | 前端 bug，检查 assetType |

---

## 8. 完整流程示例

**保存风格卡**：
1. （可选）上传参考图 → 拿 `url`
2. `POST /api/shared-assets/save` `{assetType:"card", kind:"style", snapshot:{referenceImages:[{id,src}], description}}`
3. `created:true` → toast「已保存到共享资产」；`created:false` → toast「该素材已在共享资产中」

**画布右键保存媒体节点**：
1. 取 mediaNode 的 `assetId` / `fileName` / `mediaType`
2. `POST /save` `{assetType:"media", kind:mediaType, sourceAssetId:assetId, name:fileName}`

**资产库页保存商品/文本**：取对应节点 data → `POST /save` 相应形状。

**共享面板添加回画布**：
1. `GET /api/shared-assets` 拿列表（含 `snapshot`）
2. 点击 → `GET /api/shared-assets/:id` 拿全量快照（或直接用列表项）
3. card/media/goods/text → 按 §4 拼节点 → 走既有 `PUT /api/canvases/:projectId` 保存画布
4. scene → `POST /api/shared-assets/:id/add-to-project` `{projectId}` → 拿 `sceneCardId` → 放 `scene_card` 节点
