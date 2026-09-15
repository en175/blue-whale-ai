# 素材库 API 对接文档（前端）

> 需求：IKB79K 虚拟人像库接入（火山）。后端任务：IKB8PR「素材库网关对接与视频生成素材引用」。
> 版本：**v2（2026-09-15）**。v2 新增：**素材校验状态与生成拦截**（IKFYHJ / ADR-0087）——见 §5.1、§6.3、§7。
> v1（2026-08-26）：后端 `material` 模块（透传镜像）+ `generation` 素材引用。
> ⚠️ **透传镜像，勿套用常规信封**：本接口响应**不是**产品统一的 `{ code, msg, data }`，返回**上游信封**/直接格式 + **上游状态码**。前端不能走 `apiRequest` 解包 `data` 的那套逻辑，需单独处理（见 §1）。

---

## 0. 总览

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/material/{Action}` | 素材库增删改查 + 真人活体认证会话（**透传镜像**，共 12 个 Action） |
| POST | `/api/projects/:projectId/generation-jobs` | 视频生成任务，**新增**素材库引用字段；**带素材校验门**（§5.1） |
| POST | `/api/projects/:projectId/generation-jobs/:jobId/retry` | 重试同样**带素材校验门**（§5.1） |

> 素材库是**账号维度**外部目录（非项目维度 Asset）。素材归属/状态以上游为权威。
> **v2 变更**：后端现在会把素材状态镜像到本地表，并在视频生成采纳素材时校验——**上传达标 ≠ 校验通过，只有 `Active` 才能用**（见 §5.1）。

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
> **产品侧行为（IKEXX8）**：`Filter.GroupType === "AIGC"` 时本 Action **不打上游**，改读产品本地 `material_groups`（虚拟组镜像）返回同款信封（`Items[] = {Id, Name, GroupType, CreateTime, UpdateTime}`，`RequestId` 为后端合成 `req_<uuid>`）；无 Filter / `LivenessFace` / 其他值仍透传。前端请求与响应形状不变，见 [素材关联对接文档 §6.2](./2026-09-07-material-association-api.md)。

### 2.3 获取素材组详情 `GetAssetGroup`

```json
{ "Id": "group-xxx" }
```
`Result`：素材组完整信息（同列表项字段）。
> **产品侧行为（IKEXX8）**：`Id` 命中本地虚拟组 → 本地返回；未命中（真人组等）→ 透传上游。形状同上。

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
`Result`：`{ "Id": "asset-..." }`。素材创建后**异步注册**，**此刻状态必然是 `Processing`，校验结果尚不存在**。

> ⚠️ **拿到 `Id` ≠ 校验通过**（v2 起后端会强制这一点）。必须轮询 `GetAsset` 到 `Status:"Active"` 才能拿去生成视频；`Processing` 期间发起生成会被后端拒绝（§5.1）。
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
{ "Id": "asset-xxx" }
```

`Result`（**这是前端判断「校验通过」的唯一依据**）：

```json
{
  "Result": {
    "Id": "asset-xxx",
    "Name": "素材1",
    "URL": "https://....jpg",
    "GroupId": "group-xxx",
    "AssetType": "Image",
    "Status": "Active",
    "CreateTime": "2026-09-15T10:00:00Z",
    "UpdateTime": "2026-09-15T10:00:30Z",
    "Error": { "Code": "InvalidParameter", "Message": "人脸不清晰" }
  }
}
```

- `Status` 三值：`Active`（**可用**）/ `Processing`（处理中）/ `Failed`（**不可用**）。
- `Error` **仅在失败时有值**；成功时不返回该字段。
- **不要向用户展示 `Error.Code` / `Error.Message`**：火山官方未公开素材库错误码枚举，原文无从解读，只作内部归因。用户侧统一说「素材未审核通过」。
- 建议轮询节奏：1~2 秒一次，封顶 2 分钟；超时后提示「校验耗时较长，可稍后刷新查看」。后端也在每 5 秒跟进状态（仅素材创建后 10 分钟内），但**前端不能依赖它**——自己轮询到终态才算数。

### 3.4 编辑素材 `UpdateAsset`

| 字段 | 类型 | 必填 |
|---|---|---|
| Id | string | 是 |
| Name | string | 否（新名称） |

```json
{ "Id": "asset-xxx", "Name": "新名称" }
```

### 3.5 删除素材 `DeleteAsset`

```json
{ "Id": "asset-xxx" }
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
| first_frame_material_id | string | 首帧素材库素材 id（`asset-` 前缀） |
| last_frame_material_id | string | 尾帧素材库素材 id（`asset-` 前缀），必须与首帧同用 |
| reference_materials | object[] | 普通参考素材：`[{ id: "asset-...", type: "image" \| "video" }]` |

```json
{
  "type": "video",
  "parameters": { "prompt": "...", "model_id": "seedance-2", "aspect_ratio": "16:9",
                  "resolution": "720p", "duration": 8 },
  "reference_materials": [
    { "id": "asset-xxx", "type": "image" },
    { "id": "asset-yyy", "type": "video" }
  ]
}
```

**规则**：
- 仅 `type:"video"`；图片/音频生成带素材库引用 → 失败。
- id 仅做格式校验（`asset-` 前缀、1-128 字符）；**存在性/状态/物理约束由上游强校验**，异步翻译失败。
- 素材库首帧/尾帧与**本地 Asset** 首尾帧/参考按**并集互斥**：帧（任一类）不能与普通参考并存；同一帧位 asset 与 material 只能二选一；尾帧必须与首帧同用。
- `reference_materials` 计数上限 12；细分上限（图≤9/视频≤3）由执行端校验。

> **`asset://` 双义隔离**：素材库引用在生成时由 Worker 转成 `asset://<素材ID>` 载体交给火山，与画布内部 mention 协议的 `asset://<mention_id>` **互不串用**。前端只需传素材库 id（`asset-` 前缀），无需关心 `asset://` 组装。

### 5.1 素材校验门（v2 新增，必读）

**只有 `Status:"Active"` 的素材能用作视频生成参考。** 创建期与重试期都会校验，不通过直接 400 拒绝、零写入（不建任务）。

**校验范围**——以下两批素材 id 都会被查：

1. **直接声明的素材库引用**：`first_frame_material_id`、`last_frame_material_id`、`reference_materials[].id`。
2. **本地 Asset 引用中已绑素材库的那些**：`references[].asset_id`、`first_frame_asset_id`、`last_frame_asset_id`、`reference_asset_ids`。
   ⚠️ 这条容易被忽略：**如果某个本地 Asset 被用户「入库」过（合规校验 = 上传素材库），那它身上就带了素材库绑定**。此后再拿它做视频参考，走的是同一个门——**前端传的是 `asset_id`，但后端会追到它背后的素材状态**。用户以为「这是我自己上传的本地图」，实际会被素材库状态拦住。

> **存量素材不会被漏放**：早于本次改造入库、本地无状态记录的素材，后端会**实时查一次上游**再判定，行为等价于「以此刻真实状态为准」。

**拒绝时的响应**（产品信封，**不是**上游信封）：

```json
{ "code": 400, "msg": "该素材未审核通过，不能用于视频生成", "data": { "code": "invalid_reference" } }
```

| 场景 | code | msg |
|---|---|---|
| 素材 `Failed` / `Processing` 未就绪 | 400 | `该素材未审核通过，不能用于视频生成` |
| 上游查不到（网络失败、超时、网关不可达） | 400 | `素材状态校验失败，请稍后重试` |

- 两种情况 `data.code` 都是 `invalid_reference`，**前端请按 `msg` 区分**：后者是暂时性故障，值得让用户重试；前者要引导用户重新走一遍合规校验。
- 文案只说「未通过」，**后端不提供失败原因**（火山无公开错误码枚举）。

**不校验的情形**（前端可放心）：

- **非视频任务**：图片、音频生成不受影响。音频的 `references` 虽然也带 `asset_id`，但音频执行链路根本不消费素材库绑定，后端按类型短路，**不会**拿视频文案误伤音频。
- **完全没进过素材库的本地 Asset**：没有素材库绑定，不进门。
- **重试**：重试沿用原任务的参数快照，但会**重过一遍同一个门**——原任务创建后素材若变成 `Failed`，重试会被拒。

### 5.2 前端已有的轮询是对的，别退回去

**前端已经做对了**：`characterLibraryDeposit.ts` 在 `CreateAsset` 拿到 `Id` 后 `await waitAssetReady(Id)`（轮询 `GetAsset` 到 `Active`/`Failed`），通过才置 `compliancePassed`；复用已有 `materialId` 时也走 `waitComplianceAssetReady`（IKFVMQ / `03b107d2`）。**这套逻辑正是 v2 需要的，不用改。**

v2 新增的只有一件事——**生成侧的 400 要接住**：

| 触发场景 | 用户看到的现象 | 前端应做 |
|---|---|---|
| 素材在**通过之后**被撤销/删除，用户拿它去生成 | 400 `该素材未审核通过…` | 提示素材已失效，引导重走合规校验 |
| 原任务失败后用户**重试**，而那张素材此刻已 `Failed` | 400 同上 | 同上（重试按钮旁给说明） |
| 本地 Asset 入库过（带素材库绑定），拖进视频生成 | 400 同上 | 见下方提醒——用户会以为是本地图，需给可理解的提示 |
| 上游网关抖动/不可达 | 400 `素材状态校验失败，请稍后重试` | **给「重试」按钮**，不要引导用户重传素材 |

> ⚠️ **别把 `compliancePassed: true` 当成「永久可用」**。它记录的是**上传那一刻**的判定；素材状态在上游可以再变。生成接口是二次校验，前端不能假设「我标过通过就一定过」。这也是为什么两条 400 必须分开处理——文案不同，用户该做的动作也不同。

---

## 6. 状态与错误码

### 素材状态枚举

`Active`（就绪）、`Processing`（处理中）、`Failed`（失败）。

**状态以上游为权威**（v2 修正：后端现在会把状态镜像到本地表用于生成拦截，但**对外展示仍以 `GetAsset`/`ListAssets` 的 `Status` 为准**——本地镜像只跟进素材创建后 10 分钟内的 `Processing` 行，10 分钟后再变化就追不上了）。前端展示与判定一律用素材库接口返回的状态，不要读任何后端派生的「校验状态」字段（没有这个字段）。

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

| code | `data.code` | msg | 场景 |
|---|---|---|---|
| 400 | `invalid_reference` | 该素材未审核通过，不能用于视频生成 | 素材 `Failed`/`Processing` 未就绪（v2） |
| 400 | `invalid_reference` | 素材状态校验失败，请稍后重试 | 上游查不到 / 网关不可达（v2，**可重试**） |
| 400 | — | 不支持的素材操作 / 素材库引用仅支持视频 / 首尾帧只能指定一个来源… | 非法 Action、生成参数非法 |
| 401 | — | 缺少登录凭证 | 未登录/会话失效 |
| 100409 | — | 幂等键冲突：同键异载荷 | 重试/创建同 Key 不同 body（沿用既有口径，非本次新增） |
| 503 | — | 素材库服务未配置 | 后端缺 env（生成路径不走这条，会被上面第二条兜住） |

---

## 7. 前端改动清单

1. **新建素材库请求层**：不套 `apiRequest` 解包 `data` 的逻辑；单独封装 `rawPostMaterial(action, body)`，直接读 HTTP 状态 + `Result`/`ResponseError`（鉴权仍带 `Authorization: Bearer <登录token>`）。
2. **素材库管理**（虚拟人像库功能依赖）：`ListAssetGroups(GroupType:"AIGC")` / `CreateAssetGroup` / `ListAssets` / `GetAsset(轮询状态)` / `CreateAsset`（两段式上传）。
3. **真人认证闭环**：`CreateVisualValidateSession` → 分发 `H5Link` → 轮询 `GetVisualValidateResult`。
4. **视频生成用素材库**：建任务时带 `first_frame_material_id` / `last_frame_material_id` / `reference_materials`。

**v2 新增（IKFYHJ）——只有一条，其余前端已具备**：

5. **接住生成侧的 400 并按 `msg` 分流**（§5.1 / §5.2）：`该素材未审核通过…` → 引导重走合规校验；`素材状态校验失败，请稍后重试` → 给「重试」按钮。**轮询到 `Active` 那部分前端已有**（`waitAssetReady` / `waitComplianceAssetReady`，IKFVMQ），不要重写。

---

## 8. 注意事项

1. **不要用产品信封解析**：素材库响应是上游信封/直接格式，`code===200` 不适用；成功看 `Result`，失败看 `ResponseError`。
2. **上游错误 = 透传**：后端不改写状态码/信封；前端按上游状态码 + `ResponseError.Code` 提示。
3. **异步状态**：`CreateAsset` 后素材异步注册，用 `GetAsset`/`ListAssets` 轮询 `Status` 到 `Active`。
4. **URL 公网可达**：素材 URL 必须公网可访问；否则注册失败。
5. **两段式上传**：先 Asset 管道拿公网 URL，再 `CreateAsset`。
6. **CallbackURL 勿传**：真人会话 `CallbackURL` 由后端剥离，前端不接收回调。
7. **账号维度隔离**：素材库按登录账号隔离；`asset-` id 仅在**同一账号**下对生成任务有效。
8. **状态以上游为准**（v2 修正）：素材库对外仍是「无本地业务表」，前端列表/详情状态全部以素材库接口为准。后端确实新增了一张状态镜像表，但**它只服务于生成拦截，不作为接口返回给前端**——不要去找后端要「素材校验状态」字段（没有）。
9. **`CreateAsset` 成功 ≠ 校验通过**：返回的 `Id` 只代表「已提交注册」。拿它去生成视频，在状态到 `Active` 之前会被 400 拒绝（§5.1）。
10. **生成被拒的 400 不是 bug**：`data.code === "invalid_reference"` 且 msg 为「该素材未审核通过」，说明素材没过审。这是设计行为（Active-only），不要当异常上报。

---

## 9. 完整流程示例

**虚拟人像 → 生成**：
1. `ListAssetGroups(GroupType:"AIGC")` 找到/`CreateAssetGroup` 建虚拟素材组 → 得 `group-...`
2. 已有公网图 URL → `CreateAsset(GroupId, URL, Name, AssetType:"Image")` → 得 `asset-...`（此刻状态是 `Processing`，**不是**校验通过）
3. `GetAsset` 轮询该 `asset-...` 到 `Status:"Active"` —— **到这一步才算校验通过**，前端才置 `compliancePassed`
4. `Status:"Failed"` → 提示「素材未审核通过」并给重传入口；轮询超时 → 提示稍后刷新
5. `POST /api/projects/:projectId/generation-jobs`（视频）带 `reference_materials:[{id:"asset-...", type:"image"}]` 或首帧 `first_frame_material_id`
   - 若素材此时已不是 `Active`（被删/状态漂移）→ 400 `invalid_reference`，按 §5.1 分流提示

**真人素材 → 生成**：
1. `CreateVisualValidateSession` → `H5Link` + `BytedToken`
2. 真人刷脸 → 轮询 `GetVisualValidateResult(BytedToken)` 到 `GroupId` 非空
3. `CreateAsset(GroupId, URL, ..., AssetType:"Image")`
4. 轮询 `GetAsset` 到 `Active`（同虚拟人像第 3 步）
5. 视频生成任务引用该 `asset-...`
