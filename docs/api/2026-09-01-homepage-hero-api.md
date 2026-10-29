# 首页背景图/视频 后台动态配置 API 对接文档（前端）

> 需求：IKCH01「首页背景图/视频支持后台动态配置」。后端任务：IKCH05【后端】。
> 版本：v2（2026-10-21）：新增 `scene` 场景字段，同一套配置承载**首页背景**与**登录弹窗背景**，两边素材与排序互不影响。
> 后端 `site-config/homepage-heroes` 模块（admin 管理端）+ `site/homepage-heroes`（公开读取）。
> 前端消费方：Admin 站点设置页（子工单 IKCH0C）+ 首页 `HeroVideoCarousel` 轮播 + 登录弹窗背景。

---

## 0. 总览

| 用途 | 方法 | 路径 | 鉴权 |
|---|---|---|---|
| 管理端列表 | GET | `/api/admin/site-config/homepage-heroes?scene=homepage\|auth` | admin |
| 管理端新增 | POST | `/api/admin/site-config/homepage-heroes` | admin |
| 管理端编辑 | PATCH | `/api/admin/site-config/homepage-heroes/:id` | admin |
| 管理端删除 | DELETE | `/api/admin/site-config/homepage-heroes/:id` | admin |
| 管理端调序 | PUT | `/api/admin/site-config/homepage-heroes/:id/sort` | admin |
| 上传预签名 | POST | `/api/admin/site-config/homepage-heroes/uploads/presign` | admin |
| 上传完成确认 | POST | `/api/admin/site-config/homepage-heroes/uploads/complete` | admin |
| **公开读取（首页轮播）** | GET | `/api/site/homepage-heroes?scene=homepage` | **免登录** |
| **公开读取（登录弹窗）** | GET | `/api/site/homepage-heroes?scene=auth` | **免登录** |

> 全局前缀 `/api`；管理端接口统一走 admin 鉴权（`Authorization: Bearer <登录token>`，角色需 admin），公开接口免鉴权。

### 场景 `scene`

| 值 | 用途 | 说明 |
|---|---|---|
| `homepage` | 首页背景轮播 | 缺省值；不传 `scene` 时按此场景读写 |
| `auth` | 登录弹窗动态背景 | 与首页完全独立：独立素材、独立排序、独立启用上限 |

两类场景各自最多 8 条启用条目，互不占用额度。`scene` 只在创建时指定，**编辑时不可修改**（传不同值返回 400）。

---

## 1. 数据模型 `content_homepage_heroes`

| 字段（snake） | 接口字段（camel） | 类型 | 说明 |
|---|---|---|---|
| `id` | `id` | string（BigInt 序列化） | 主键 |
| `scene` | `scene` | string | `homepage` / `auth`；创建后不可改 |
| `media_type` | `media_type` | string | `image` / `video` |
| `media_url` | `media_url` | string | 视频/图片资源 URL（可空，见 §7 迁移期） |
| `poster_url` | `poster_url` | string \| null | 视频封面 URL；**视频必填**，图片可空 |
| `sort_order` | `sort_order` | number | 排序值，升序渲染；调序后为连续 0..n |
| `enabled` | `enabled` | number | 1 进轮播 / 0 停用；**仅管理端视图暴露** |
| `gmt_create` | `created_at` | string（ISO） | 创建时间 |
| `gmt_modified` | `updated_at` | string（ISO） | 最后修改时间 |

**产品规则（后端强校验）**：
- 只有 `enabled=1` 且未软删的条目进公开读取，且只返回请求场景的条目。
- **每个场景启用条目上限 8 条**：新增即启用、或把已禁用条目改回启用时校验，超限返回 409。
- `media_type=video` 必须有 `poster_url`，否则创建/编辑均被拒（400）。
- `media_type=image` 时 `poster_url` 可空（纯图背景）。
- 删除为软删（`is_delete=1`），删除后从所有列表消失；**无恢复接口**，误删需重建。

---

## 2. 管理端接口（`/api/admin/site-config/homepage-heroes`）

> 统一响应信封：成功 `{ success: true, data }`；失败 `{ success: false, error }`（HTTP 400/404/409/503）。

### 2.1 列表 `GET`

查询参数 `scene`：`homepage`（缺省）/ `auth`；非法值返回 400。

返回该场景全部存活条目（**含禁用**），按 `sort_order` 升序：

```json
{ "success": true, "data": [ { "id": "1", "scene": "homepage", "media_type": "video", "media_url": "https://...mp4", "poster_url": "https://...jpg", "sort_order": 0, "enabled": 1, "created_at": "...", "updated_at": "..." } ] }
```

### 2.2 新增 `POST`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `scene` | string | 否 | `homepage`（缺省）/ `auth` |
| `media_type` | string | 是 | `image` / `video` |
| `media_url` | string | 否 | http(s):// URL；**可缺省/空串**（迁移期占位） |
| `poster_url` | string \| null | 条件必填 | 视频必填；可传 `null` 清空 |
| `sort_order` | number | 否 | 非负整数；缺省自动取**同场景**当前最大值 +1 |
| `enabled` | number | 否 | 严格 0/1；缺省 1（默认启用） |

```json
{ "media_type": "video", "media_url": "", "poster_url": "https://...jpg" }
```

成功：`{ "success": true, "data": { "id": "1" } }`
失败：400（参数非法 / 视频缺封面 / URL 格式错）；**409**（启用条目已达上限 8 条）。

> 校验细节：`media_url` / `poster_url` 必须是 `http(s)://` 开头、长度 ≤512；`enabled` 只认数字 0/1（布尔 `true`/字符串 `"1"` 均拒绝）；`sort_order` 非负整数 ≤ 2^31-1。

### 2.3 编辑 `PATCH /:id`

部分字段合入现条目后整体校验（保证「视频必须有封面」跨字段规则仍然成立——例如把图片改成视频但没给封面会被 400 拒绝）。

请求体同 2.2（任意子集）。`scene` 不可修改：传入与当前不同的值返回 400。
成功：`{ "success": true, "data": { "id": "1" } }`
失败：400 / 404（配置不存在）/ 409（改回启用超上限）。

### 2.4 删除 `DELETE /:id`

软删除。成功：`{ "success": true, "data": { "id": "1" } }`；失败：400 / 404。

### 2.5 调序 `PUT /:id/sort`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `direction` | string | 是 | `up`（上移）/ `down`（下移），与**同场景**相邻条目交换后整体重排为连续 0..n |

```json
{ "direction": "up" }
```

成功：`{ "success": true, "data": { "id": "1" } }`
失败：400（direction 非法）/ 404（配置不存在）/ **409**（已在边缘，无法再移）。

---

## 3. 上传流程（`/api/admin/site-config/uploads/*`）

**三段式：presign → 浏览器直传 TOS → complete 回填 URL**。前端**不接触 AccessKey**；拿到的 `upload_url` 带签名，直接 PUT 上传即可。

### 3.1 预签名 `POST /api/admin/site-config/homepage-heroes/uploads/presign`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 是 | `image` / `video` |
| `mime` | string | 是 | 完整 MIME，如 `video/mp4`、`image/jpeg` |
| `size` | number | 是 | 文件字节数 |

```json
{ "type": "video", "mime": "video/mp4", "size": 10485760 }
```

成功：`{ "success": true, "data": { "storage_key": "admin/site-config/video/xxx", "upload_url": "https://tos...?...", "headers": { ... }, "expires_in": 3600 } }`
失败：400（type/mime/size 非法）；**503**（对象存储未配置）。

**限制**：图片 `image/jpeg|png|webp|gif` ≤20MB；视频 `video/mp4` ≤200MB。

### 3.2 浏览器直传

用 `upload_url` 发起 `PUT`，带 presign 返回的 `headers`（含 `Content-Type`、签名头）。**文件本体不进产品后端**。

### 3.3 完成确认 `POST /api/admin/site-config/homepage-heroes/uploads/complete`

请求体 = presign 入参 + `storage_key`（presign 返回值）。后端校验对象实际 size/mime 与声明一致 → 置公有读 → 返回最终公网 URL。

```json
{ "type": "video", "mime": "video/mp4", "size": 10485760, "storage_key": "admin/site-config/video/xxx" }
```

成功：`{ "success": true, "data": { "url": "https://tos-public/..." } }`
失败：400（大小/类型与实际上传不符、存储键前缀不匹配、对象不存在）；503（未配置）。

> **回填**：把 `complete` 返回的 `url` 写进条目 `media_url`（视频再传一张封面图，把其 `url` 写进 `poster_url`）——即 PATCH §2.3 完成落库。

---

## 4. 公开读取 `GET /api/site/homepage-heroes`

**免登录**。查询参数 `scene`：`homepage`（缺省，首页）/ `auth`（登录弹窗）；非法值返回 400。响应为产品统一信封 `{ code, msg, data }`：

```json
{ "code": 200, "msg": "ok", "data": [ { "id": "1", "media_type": "video", "media_url": "https://...mp4", "poster_url": "https://...jpg", "sort_order": 0 } ] }
```

- 只返回请求场景下 `enabled=1` 且未软删条目，按 `sort_order` 升序（同排序按 id）。
- **不返回 `enabled` / `scene` 字段**（公开面不暴露启停与场景）。
- 无任何启用条目时返回空数组 `{ "data": [] }`（HTTP 200，非错误）——首页轮播应降级为「无背景素材则不渲染轮播/用静态占位」；登录弹窗应降级为静态占位背景。

---

## 5. URL 直填说明

- `media_url` / `poster_url` 均接受**任意 http(s):// URL**，不限于 TOS——运营可直接粘贴 CDN / 对象存储地址，无需走上传接口。
- 传 `poster_url: null` 可清空封面（仅图片类型可清空；视频清空封面会被 400 拒绝）。
- 传 `media_url: ""`（或缺省）表示暂不填地址（迁移期占位，见 §7）。

---

## 6. 状态与错误码

### 管理端（`{ success: false, error }`，error 为中文提示）

| HTTP | 场景 |
|---|---|
| 400 | 参数非法（type/media_url/sort_order/enabled 校验失败）、视频缺封面、文件大小/类型与实际上传不符 |
| 404 | 配置不存在（已被删 / id 无效） |
| 409 | 启用条目达上限 8 条、调序已在边缘 |
| 503 | 对象存储未配置（TOS 环境变量缺失） |
| 401 | 未登录 / 非 admin 角色 |

### 公开读取（`{ code, msg, data }`）

| code | 场景 |
|---|---|
| 200 | 成功（含空数组） |
| 500 | 服务端异常 |

---

## 7. 迁移期说明（重要）

**当前 TOS 资源迁移中**：运营新建条目时 `media_url` 可留空（`""`）先占位、只配类型/封面/排序/启停；待迁移完成后再 `PATCH` 回填真实地址。此期间**公开列表会正常返回空 `media_url` 的条目**，前端需容忍空地址（见 §4 降级逻辑），否则轮播会加载失败。

迁移完成后无需任何接口/结构变更——仍是同一个 `PATCH` 改 `media_url` 字段。

---

## 8. 前端改动清单

1. **Admin 站点设置页**（IKCH0C）：复用列表/新增/编辑/删除/调序五个管理端接口；上传走 §3 三段式（或直接用 URL 直填）。
2. **首页轮播 `HeroVideoCarousel`**：把硬编码片源改为请求 `GET /api/site/homepage-heroes` 渲染；空列表 / 空 `media_url` 时降级处理；视频条目优先用 `poster_url` 做首帧占位。
3. **素材不再进 `web/src/assets/home-hero/`**：资源统一经后台配置（TOS 公网 URL），前端目录不再内置片源。
