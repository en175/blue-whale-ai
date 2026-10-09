# 人像库关联收口前端对接文档

> 母单：IKKFHJ（人像库改造）；后端任务：IKKH81；决策：[ADR-0126](../adr/0126-material-link-single-source-and-delete-cascade.md)。
> 版本：v1（2026-10-09）。
> 前置阅读：[`material-library.md`](./material-library.md)（素材库透传镜像、上游信封、两段式上传）、[`asset-delete-consistency.md`](./asset-delete-consistency.md)（删除资产与画布的关系）。

---

## 0. 本次改动的意图

| 痛点 | 现状 | 本次改造后 |
|---|---|---|
| 素材库列表拿不到本地资产 | 上游 `ListAssets` 只回素材库自己的字段；前端要知道「这条素材我本地有没有、url 是什么」得再拉一遍 `GET /api/assets` 自己配对 | **新接口**一条调用拿到合并结果（状态以上游为准 + 本地补 `asset_id` / `url`） |
| 删了本地资产，素材库里还在 | `DELETE /api/assets/:assetId` 只软删本地，素材库里那条素材留着——用户下次刷新列表还会看到它 | **删除级联**：先删上游素材，成功才软删本地；失败就报错 |
| 素材组能看到别人的 | `ListAssetGroups` 的真人组走透传上游；素材库是「共享、单租户」，上游返回不带归属 | 虚拟组与真人组**都读本地**，只返回当前用户自己的组 |
| 同一个素材被重复入库 | 第二次 `CreateAsset` 会把 `material_id` 覆盖掉，上一条变成无人指向的孤儿 | **入库前置判断**：已就绪直接回既有素材 id；历史判失败先清掉再重建 |
| 组归属字段存两遍 | `assets.material_group_id` 与 `material_assets.material_group_id` 是同一个事实 | 删掉 `assets.material_group_id`，组归属的唯一真相是 `material_assets` |

**一句话给前端**：① 素材库列表改调 `POST /api/assets/library-materials`；② 删资产前弹框要提示「会一并删除素材库素材」；③ `ListAssetGroups` 的 `GroupType` **必须传**；④ 入库拿到 `Result.AlreadyLinked === true` 就提示「已入库」。

---

## 1. 新接口：素材库列表 + 本地资产补全

### 1.1 调用

```
POST /api/assets/library-materials
Authorization: Bearer <token>
```

**请求体与上游 `ListAssets` 同形**（不重造参数）：

```json
{
  "Filter": { "GroupIds": ["group-xxx"], "GroupType": "LivenessFace" },
  "PageNumber": 1,
  "PageSize": 20
}
```

### 1.2 响应

产品统一信封 `{ code, msg, data }`，`code === 200` 为成功。`data` = 上游 `Result` **原样**，每项多两个字段：

```json
{
  "code": 200,
  "msg": null,
  "data": {
    "TotalCount": 2,
    "Items": [
      { "Id": "Asset-xxx", "Status": "Active", "…": "上游字段原样",
        "asset_id": "526", "url": "https://…/a.png" },
      { "Id": "Asset-yyy", "Status": "Active", "…": "上游字段原样",
        "asset_id": null, "url": null }
    ],
    "PageNumber": 1,
    "PageSize": 20
  }
}
```

| 新增字段 | 含义 |
|---|---|
| `asset_id` | 该素材在本地 `assets` 表的 id（字符串），**未导入过为 `null`** |
| `url` | 该本地资产的访问 URL，**未导入过为 `null`** |

- **状态仍以上游为准**：`Status` 取自上游 `ListAssets`，本地镜像不参与展示。
- **副作用与透传口同口径**：本端点内部同样会把上游状态**镜像回本地**，并对判 `Failed` 的素材走统一处置（删上游死素材 + 留 `Failed` 行 + 清本地关联）。所以前端可以放心把素材库列表从 `POST /api/material/ListAssets` 改调本端点，**不会丢掉状态跟进**。
- 本地只补那两个字段，**不覆盖、不删除上游的任何字段**。

### 1.3 失败

上游非 2xx 时接口不返回半个列表：

| 情形 | HTTP | body |
|---|---|---|
| 上游 4xx（鉴权 / 租户 / 限流…） | 上游状态码 | `{ "code": <上游状态码>, "msg": "素材库列表获取失败，请稍后重试", "data": null }` |
| 上游 5xx / 网关不可达 | 503 | 同上，`code: 503` |

前端按非 200 处理即可（文案可直接展示 `msg`）。

> 成功时 **HTTP 状态是 `201`**：本仓没有 `@HttpCode`，所有 POST 都走 Nest 默认。**判据是 body 里的 `code === 200`，不是 HTTP 状态码。**

> 为什么不直接改上游 `ListAssets` 的透传响应：`material-library-client` 的「信封与非 2xx 原样透传」是既有决策，往上游字段空间里塞自定义键既顶它、又容易与上游新增字段撞名。

---

## 2. 删除资产：级联删除素材库素材

### 2.1 语义变化

```
DELETE /api/assets/:assetId
```

**新行为**（`asset-delete-consistency.md` §0 的「删除素材不动画布」**不变**）：

1. 若该资产**已入库**（响应里的 `material_id` 非空）→ **先调上游 `DeleteAsset`**；
2. 上游 **2xx**，或上游指认该素材**已不存在**（`NotFound.asset` / `InvalidParameter.asset`）→ 视为成功，继续软删本地并清掉本地关联与状态行；
3. 上游其他失败（鉴权 / 限流 / 5xx / 网关不可达）→ **接口报错，本地一行不动**。

第 3 条是刻意的：素材库列表以上游为准，如果上游没删掉却把本地删了，用户会看到「删了还在」，而没有任何东西会重试。

### 2.2 失败响应

| 情形 | HTTP | body |
|---|---|---|
| 上游删不掉 | 400 | `{ "code": 2013, "msg": "素材库服务不可用，删除失败，请稍后重试", "data": null }` |
| 资产不存在 / 不归属 | 200 | `{ "code": 100301, "msg": "资源不存在", "data": null }` |

`2013` 与上传口素材闸**同一个码**（「一个码 + 多条 msg，前端按 msg 分流」）。失败文案可直接展示，并给重试入口。

### 2.3 弹框（前端要做）

删除前弹确认框，**当该资产已入库时**提示后果：

> 该资产已入库，删除会一并删除素材库里的这条素材，**不可恢复**。

- 判据：资产库里那条记录的 `material_id` 非空（`GET /api/assets` 与项目快照都会返回它）。
- 与既有的「该素材被 N 个项目引用」提示（`GET /api/assets/:assetId/references` → `projectCount`）**并列显示**，两者互不影响。
- 仍是**只提示、不拦截**——与既有口径一致（`asset-delete-consistency.md` §2.3）。

> 上游删除**不可逆**，而本地删除是软删：这个不对称是有意的。弹框文案里「不可恢复」这句不能省。

---

## 2.5 重复入库：`CreateAsset` 的前置判断

`POST /api/material/CreateAsset` 带 `SourceAssetId`、且该资产**已经入库过**时，后端在**打上游之前**先判一次：

| 绑定素材此刻 | 行为 | 响应 |
|---|---|---|
| **就绪**（Active） | **幂等短路**——不建第二条、不打上游、不改绑定 | HTTP 200 + 上游同款信封：`Result = { Id: <既有素材id>, AlreadyLinked: true }`（本地状态未到终态时可能顺带刷新一次状态镜像） |
| **判失败**（Failed） | 清掉历史的（上游 + 本地）后**正常入库** | 正常透传上游 `CreateAsset` 的结果 |
| 上游**不可达** | 放行（判不了就不拦） | 正常透传 |
| 该资产没入库过 / 没带 `SourceAssetId` | 放行 | 正常透传 |

**前端要做的**：见到 `Result.AlreadyLinked === true` 就提示「该素材已入库，无需重复上传」，**别**按「新建成功」继续走等待审核的流程——`Id` 是既有那条，状态可能早就 `Active`。

> 为什么放在后端而不是前端判：同一条本地资产重复入库会**覆盖**它的 `material_id`（单列唯一 + 覆盖写），被覆盖的那条素材在本地再也无人指向 → 只能去上游界面删。前置短路把这条路堵死，前端漏判也拦得住。

---

## 3. `ListAssetGroups` 改查本地

### 3.1 行为变化

`POST /api/material/ListAssetGroups` 的虚拟组与真人组**都改读本地表**（`material_groups`），不再吐上游的全租户列表。

| `Filter.GroupType` | 行为 |
|---|---|
| `"AIGC"` | 读本地 `kind="virtual"` 分页（与改动前一致） |
| `"LivenessFace"` | 读本地 `kind="real"` 分页（**改动前是透传上游**） |
| 缺失 / 其他值 | 仍透传上游（保持既有语义，但**不要依赖**） |

**所以前端必须继续传 `GroupType`**——两个 tab 靠它分流，不传会走透传、拿回全租户的组。

### 3.2 响应字段

返回信封与改动前一致，列表项多一个 **`CoverUrl`**（真人组封面，虚拟组为 `null`）；`GroupType` 现在会如实回 `"LivenessFace"`。

```json
{ "Id": "group-xxx", "Name": "我的真人组", "GroupType": "LivenessFace",
  "CoverUrl": "https://…/cover.png", "CreateTime": "…", "UpdateTime": "…" }
```

### 3.3 真人组的本地行从哪来

真人组只有在用户**走完 H5 刷脸领组**（`GetVisualValidateResult` 返回非空 `GroupId`）时才会落到本地表。因此：

- **新领的组**：领到即落行，此后 `ListAssetGroups(LivenessFace)` 能查到。
- **存量真人组**：**不补偿**。上线前已经领过的组，本地表里没有行，列表**看不到它们**；组里的素材也看不到。
  - 处置：让这些用户**重新走一次 H5 认证**。拿到的是**新的组 id**，旧组仍留在上游、原组里的素材不会自动跟过来——需要重新上传。
  - 项目前期用户少，接受这个代价；产品侧要准备好引导文案。
  - 2026-10-09 实测的旁证：改造前 user 66 在列表里拿到了 user 38 的两个组。

---

## 4. 字段移除

| 出口 | 变化 |
|---|---|
| `GET /api/assets` | 响应项**不再有 `material_group_id`**（`material_id` 保留） |
| `GET /api/projects/:id/snapshot` | `assets[]` 项**不再有 `material_group_id`**（`material_id` 保留） |

前端此前对这两个字段**没有任何消费**。

---

## 5. 对接要点总结

| 项 | 前端动作 |
|---|---|
| 素材库列表 | 改调 `POST /api/assets/library-materials`（体与 `ListAssets` 同形）；读新增的 `asset_id` / `url`，为 `null` 表示还没导入 |
| 删除资产 | 弹框加「会一并删除素材库素材，不可恢复」；失败分支按 `code 2013` 的 `msg` 展示 + 重试按钮 |
| 重复入库 | 见到 `Result.AlreadyLinked === true` → 提示「已入库」，不要当新建成功 |
| 素材组列表 | `GroupType` 必须传（`"AIGC"` / `"LivenessFace"`）；列表项新增 `CoverUrl` |
| 快照 / 资产列表 | 别再读 `material_group_id`（已移除） |
| 真人组存量 | 产品侧引导重新刷脸认证；新组 id ≠ 旧组 id，素材要重传 |

---

## 6. 相关工单/文档

- 母单 IKKFHJ（人像库改造）、后端任务 IKKH81
- ADR-0126：关联单一化 / 删除级联 / 组列表改本地 / 入库前置判断
- 上游决策：ADR-0087（素材校验状态镜像与生成门）、ADR-0093（上传口自动关联——本次推翻其布局的一半）
- `material-library.md`、`asset-delete-consistency.md`
