# 素材库 API 对接文档（前端）

> 需求：IKB79K 虚拟人像库接入（火山）。后端任务：IKB8PR「素材库网关对接与视频生成素材引用」。
> 版本：v1（2026-08-26）。后端 `material` 模块（透传镜像）+ `generation` 素材引用。
> ⚠️ **透传镜像，勿套用常规信封**：本接口响应**不是**产品统一的 `{ code, msg, data }`，返回**上游信封**/直接格式 + **上游状态码**。前端不能走 `apiRequest` 解包 `data` 的那套逻辑，需单独处理（见 §1）。

---

## 0. 总览

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/material/{Action}` | 素材库增删改查 + 真人活体认证会话（**透传镜像**，共 12 个 Action） |
| POST | `/api/projects/:projectId/generation-jobs` | 视频生成任务，**新增**素材库引用字段 |

> 素材库是**账号维度**外部目录（非项目维度 Asset）。素材归属/状态以上游为权威，本地不镜像、无本地表。

---

## 1. 与常规 API 的差异（必读，防解析错）

**常规产品 API**（如 media-extractions）：响应 `{ code, msg, data }`，`code===200` 成功，前端 `apiRequest` 已解包 `data`。

**素材库 API（透传镜像）与之完全不同**：

| 维度 | 常规 API | 素材库 API |
|---|---|---|
| 成功响应 | `{ code:200, msg, data }` | 上游信封 `{ "ResponseMetadata": {...}, "Result": {...} }` |
| 错误响应 | `{ code:4xx, msg, data }` | 上游信封 `{ "ResponseMetadata": {...}, "ResponseError": { Code, Message } }` + **上游状态码** |
| 成功判定 | `code === 200` | HTTP 2xx 且看 `Result`；错误必看 `ResponseError.Code` |
| 真人认证会话 | — | **直接格式**（无信封）：`{ BytedToken, H5Link }` 等 |

**鉴权**：前端照常带 `Authorization: Bearer <登录token>`（与所有产品 API 一致）。**后端会在会话内把该头替换为网关上执行凭证（sk-）再调上游**——前端无需、也不应传网关 sk- key；网关侧《素材库对接-测试curl》里的 sk- key 是网关视角，产品前端不可用。

**两类错误（前端要区分）**：
- **产品侧拒绝**（非法 Action / 缺登录 / 服务未配置 / 网关不可达）→ 返回**产品信封** `{ code, msg, data }`，`code` ∈ `400` / `401` / `503`，`msg` 为中文提示。
- **上游侧错误** → 透传**上游信封** `ResponseError` + 上游状态码（401/403/404/412/429/500…）。

---

## 2. 素材组接口

> 统一 `POST /api/material/{Action}`，`Content-Type: application/json`，字段为火山风格 PascalCase。响应为上游信封（无 `Result` 字段的说明见各小节）。

### 2.1 创建虚拟素材组 `CreateAssetGroup`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| Name | string | 是 | 素材组名称 |
| Description | string | 否 | 描述 |
| GroupType | string | 是 | 素材组类型，当前仅支持 `AIGC`（虚拟人像库用） |

```json
{ "Name": "我的虚拟形象", "Description": "test", "GroupType": "AIGC" }
```
`Result`：`{ "Id": "group-..." }`（素材组 id，后续用它上传素材）。

### 2.2 列出素材组 `ListAssetGroups`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| Filter.GroupType | string | 否 | 类型过滤，如 `AIGC` / `LivenessFace` |
| PageNumber | int | 是 | 页码 |
| PageSize | int | 是 | 每页数量 |

```json
{ "Filter": { "GroupType": "AIGC" }, "PageNumber": 1, "PageSize": 10 }
```
> `Result` 为分页素材组列表（`TotalCount` / `Items: [groupId, name, groupType, ...]` / `PageNumber` / `PageSize`），组内字段透传不改写，以网关《素材模块-对外API接口文档》为准。

### 2.3 获取素材组详情 `GetAssetGroup`

```json
{ "Id": "group-xxx" }
```
`Result`：素材组完整信息（同列表项字段）。

### 2.4 编辑素材组 `UpdateAssetGroup`

> 仅支持修改 `Description`；传不同值的 `Name` 会报 `UnsupportedField`。

| 字段 | 类型 | 必填 |
|---|---|---|
| Id | string | 是 |
| Description | string | 否（新描述） |

```json
{ "Id": "group-xxx", "Description": "新描述" }
```

### 2.5 删除素材组 `DeleteAssetGroup`

> 同步删除组内全部素材。

```json
{ "Id": "group-xxx" }
```
`Result`：空对象 `{}`。

---

## 3. 素材接口

> 素材 URL **必须公网可访问**（烧 TOS 公网 URL），否则火山侧注册失败。图片约束：300-6000px、宽高比 (0.4, 2.5) 内、单张 <30MB。

### 3.1 上传素材 `CreateAsset`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| GroupId | string | 是 | 素材组 id |
| URL | string | 是 | 素材公网可访问地址 |
| Name | string | 是 | 素材名称 |
| AssetType | string | 是 | `Image` / `Video` / `Audio` |

```json
{ "GroupId": "group-xxx", "URL": "https://....jpg", "Name": "素材1", "AssetType": "Image" }
```
`Result`：`{ "Id": "Asset-..." }`。素材创建后**异步注册**，状态见 `GetAsset`/`ListAssets`。

> **前端上传分离两段**：先走既有 Asset 上传管道拿到公网 URL，再 `CreateAsset` 传该 URL；**不要**把本地文件直接发这里。

### 3.2 列出素材 `ListAssets`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| Filter.GroupIds | []string | 否 | 素材组 id 列表（支持跨组） |
| Filter.GroupType | string | 否 | 类型过滤 |
| Filter.Statuses | []string | 否 | `Active` / `Processing` / `Failed` |
| Filter.Name | string | 否 | 名称模糊匹配 |
| PageNumber | int | 是 | 页码 |
| PageSize | int | 是 | 每页数量 |

```json
{ "Filter": { "GroupIds": ["group-xxx"], "GroupType": "AIGC" }, "PageNumber": 1, "PageSize": 10 }
```
`Result`：`{ "TotalCount": int, "Items": [ { "Id", "Name", "URL", "GroupId", "AssetType", "Status", "CreateTime", "UpdateTime", ... } ], "PageNumber": 1, "PageSize": 10 }`。

### 3.3 获取素材详情 `GetAsset`

```json
{ "Id": "Asset-xxx" }
```
`Result`：素材完整信息（含 `Status`、`URL`、`Error.Code` / `Error.Message`）。

### 3.4 编辑素材 `UpdateAsset`

| 字段 | 类型 | 必填 |
|---|---|---|
| Id | string | 是 |
| Name | string | 否（新名称） |

```json
{ "Id": "Asset-xxx", "Name": "新名称" }
```

### 3.5 删除素材 `DeleteAsset`

```json
{ "Id": "Asset-xxx" }
```
`Result`：空对象 `{}`。

> 素材 ID 需与生成任务使用**同一账号**（同一账号下的素材库凭证与生成 API 密钥）。

---

## 4. 真人活体认证会话

> 真人素材（LivenessFace）需 H5 活体认证闭环。会话类接口返回**直接格式**（无 `ResponseMetadata`/`Result` 信封）。

### 4.1 创建真人认证会话 `CreateVisualValidateSession`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| Name | string | 否 | 组名（认证完成后用作归属组名；含 `<`/`>` 返回 400 `InvalidParameter`） |
| ProjectName | string | 否 | 项目名 |

> ⚠️ **`CallbackURL` 后端会剥离、不透传**（产品侧关闭自定义回调）。前端**不要**传该字段；认证回调由网关内置维护，前端不接收回调。

```json
{ "Name": "我的真人组", "ProjectName": "default" }
```
`Result`（直接格式，无信封）：
```json
{ "BytedToken": "bt-xxx", "H5Link": "https://h5.xxx/verify" }
```
- `BytedToken` = 会话标识（后续查询用）。
- `H5Link` = 给待验证者打开完成刷脸的链接。

### 4.2 查询真人认证结果 `GetVisualValidateResult`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| BytedToken | string | 是 | 4.1 返回的 `BytedToken` |

```json
{ "BytedToken": "bt-xxx" }
```
`Result`（直接格式，无信封）：
```json
{ "GroupId": "group-xxx" }
```
- 认证完成 → `GroupId` 为真人素材组 id。
- **未完成** → HTTP 200 + 空字符串 `{ "GroupId": "" }`，客户端继续轮询。
- 会话不存在/不属于当前用户 → 同样返回空 `GroupId`（不泄露）。

**闭环流程**：
1. `CreateVisualValidateSession` → 拿 `H5Link` + `BytedToken`
2. 把 `H5Link` 分发给真人完成刷脸
3. 轮询 `GetVisualValidateResult(BytedToken)` 直到 `GroupId` 非空（或轮询 `ListAssetGroups`，`Filter.GroupType: "LivenessFace"` 找新组）
4. 对该组 `CreateAsset` 上传真人素材

---

## 5. 视频生成素材引用（关联素材库）

> 在既有视频生成任务入口 `POST /api/projects/:projectId/generation-jobs` **新增**三类素材库引用字段，让视频生成用素材库（虚拟/真人）素材作为首帧/尾帧/参考。

新增请求字段（仅视频生成，其余字段沿用既有 generation-jobs 契约）：

| 字段 | 类型 | 说明 |
|---|---|---|
| first_frame_material_id | string | 首帧素材库素材 id（`Asset-` 前缀） |
| last_frame_material_id | string | 尾帧素材库素材 id（`Asset-` 前缀），必须与首帧同用 |
| reference_materials | object[] | 普通参考素材：`[{ id: "Asset-...", type: "image" \| "video" }]` |

```json
{
  "type": "video",
  "parameters": { "prompt": "...", "model_id": "seedance-2", "aspect_ratio": "16:9",
                  "resolution": "720p", "duration": 8 },
  "reference_materials": [
    { "id": "Asset-xxx", "type": "image" },
    { "id": "Asset-yyy", "type": "video" }
  ]
}
```

**规则**：
- 仅 `type:"video"`；图片/音频生成带素材库引用 → 失败。
- id 仅做格式校验（`Asset-` 前缀、1-128 字符）；**存在性/状态/物理约束由上游强校验**，异步翻译失败。
- 素材库首帧/尾帧与**本地 Asset** 首尾帧/参考按**并集互斥**：帧（任一类）不能与普通参考并存；同一帧位 asset 与 material 只能二选一；尾帧必须与首帧同用。
- `reference_materials` 计数上限 12；细分上限（图≤9/视频≤3）由执行端校验。

> **`asset://` 双义隔离**：素材库引用在生成时由 Worker 转成 `asset://<素材ID>` 载体交给火山，与画布内部 mention 协议的 `asset://<mention_id>` **互不串用**。前端只需传素材库 id（`Asset-` 前缀），无需关心 `asset://` 组装。

---

## 6. 状态与错误码

### 素材状态枚举

`Active`（就绪）、`Processing`（处理中）、`Failed`（失败）。**状态以上游为准，本地不镜像**，前端按 `GetAsset`/`ListAssets` 的 `Status` 展示即可。

### 上游错误码（透传镜像，配合上游状态码）

| Code | HTTP | 含义 |
|---|---|---|
| InvalidParameter | 400 | 请求参数非法 |
| UnsupportedField | 400 | 不支持的字段修改（如 UpdateAssetGroup 的 Name） |
| InvalidAction | 400 | 不支持的 Action |
| Unauthorized | 401 | 鉴权失败 |
| Forbidden | 403 | 无权限 |
| FeatureNotEnabled | 403 | 租户未开启素材库/拦截原因功能 |
| NotFound | 404 | 资源不存在或跨租户不可见 |
| FailedPrecondition | 412 | 前置条件不满足（如素材组未就绪不可上传） |
| LimitExceeded | 429 | 资源数量达上限 |
| ServiceNotConfigured | 503 | 火山服务未配置 |
| InternalError | 500 | 内部错误（可重试） |

### 产品侧错误（前端可依赖中文 `msg`）

| code | 含义 | 场景 |
|---|---|---|
| 400 | 不支持的素材操作 / 素材库引用仅支持视频 / 首尾帧只能指定一个来源… | 非法 Action、生成参数非法 |
| 401 | 缺少登录凭证 | 未登录/会话失效 |
| 503 | 素材库服务未配置 / 网关不可达 | 后端缺 env、上游无响应 |

---

## 7. 前端改动清单

1. **新建素材库请求层**：不套 `apiRequest` 解包 `data` 的逻辑；单独封装 `rawPostMaterial(action, body)`，直接读 HTTP 状态 + `Result`/`ResponseError`（鉴权仍带 `Authorization: Bearer <登录token>`）。
2. **素材库管理**（虚拟人像库功能依赖）：`ListAssetGroups(GroupType:"AIGC")` / `CreateAssetGroup` / `ListAssets` / `GetAsset(轮询状态)` / `CreateAsset`（两段式上传）。
3. **真人认证闭环**：`CreateVisualValidateSession` → 分发 `H5Link` → 轮询 `GetVisualValidateResult`。
4. **视频生成用素材库**：建任务时带 `first_frame_material_id` / `last_frame_material_id` / `reference_materials`。

---

## 8. 注意事项

1. **不要用产品信封解析**：素材库响应是上游信封/直接格式，`code===200` 不适用；成功看 `Result`，失败看 `ResponseError`。
2. **上游错误 = 透传**：后端不改写状态码/信封；前端按上游状态码 + `ResponseError.Code` 提示。
3. **异步状态**：`CreateAsset` 后素材异步注册，用 `GetAsset`/`ListAssets` 轮询 `Status` 到 `Active`。
4. **URL 公网可达**：素材 URL 必须公网可访问；否则注册失败。
5. **两段式上传**：先 Asset 管道拿公网 URL，再 `CreateAsset`。
6. **CallbackURL 勿传**：真人会话 `CallbackURL` 由后端剥离，前端不接收回调。
7. **账号维度隔离**：素材库按登录账号隔离；`Asset-` id 仅在**同一账号**下对生成任务有效。
8. **零本地表**：素材库无本地镜像，前端列表/详情状态全部以素材库接口为准。

---

## 9. 完整流程示例

**虚拟人像 → 生成**：
1. `ListAssetGroups(GroupType:"AIGC")` 找到/`CreateAssetGroup` 建虚拟素材组 → 得 `group-...`
2. 已有公网图 URL → `CreateAsset(GroupId, URL, Name, AssetType:"Image")` → 得 `Asset-...`
3. `ListAssets/GetAsset` 轮询该 `Asset-...` 到 `Status:"Active"`
4. `POST /api/projects/:projectId/generation-jobs`（视频）带 `reference_materials:[{id:"Asset-...", type:"image"}]` 或首帧 `first_frame_material_id`

**真人素材 → 生成**：
1. `CreateVisualValidateSession` → `H5Link` + `BytedToken`
2. 真人刷脸 → 轮询 `GetVisualValidateResult(BytedToken)` 到 `GroupId` 非空
3. `CreateAsset(GroupId, URL, ..., AssetType:"Image")`
4. （同虚拟人像）视频生成任务引用该 `Asset-...`
