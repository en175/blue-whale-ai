# 资产删除一致性 API 对接文档（前端）

> 需求：IKCNLP 资产删除引用一致性（方案C）。产品 PRD：IKC3RY。
> 版本：v1（2026-09-02）。所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，`code===200` 为成功。

---

## 0. 核心语义：删除素材不动画布

**后端删除素材时，绝不改动画布节点。** 画布上的节点始终保留；前端进入画布时，通过 `GET /api/projects/:id/snapshot` 返回的 `assets` 字段判断**素材是否仍有效**——素材已删/失效，前端显示默认占位图。

**前端负责**：进画布时遍历节点，用 `snapshot.assets` 判断节点引用的 assetId 是否有效；无效则显示占位图（占位图 URL 前端硬编码）。

> 注：现有前端 `mapBackendNode` 在素材查不到时是**静默丢弃节点**（`resolveAssetRef` 返回 null → 节点不渲染），没有占位图。方案C要求改成**显示默认占位图**。这是本次前端要改的点。

---

## 1. 进画布判断素材有效性（核心）

### 1.1 现有接口

```
GET /api/projects/:id/snapshot
```

`data.assets` 是一个以 assetId 为 key 的字典：
```json
{
  "526": { "asset_id": "526", "access_url": "https://...", "type": "video" },
  "3688": { "asset_id": "3688", "access_url": "https://...", "type": "image" }
}
```

**当前 `snapshot.assets` 的语义（IKCNLP 改造后）**：该项目可用的素材集合 =
- 本项目 `project_asset` 关联的素材（含跨项目复用、`project_id=0` 全局素材）
- ± `user_assets.project_id=pid` 的直接归属素材（兼容过渡期）
- 同一素材**去重**（一个项目里同一素材只出现一次）

### 1.2 前端判断逻辑

画布节点引用素材（`node.data.assetId` / 顶层 `assetId` / `data.asset_id`）：

```
读取节点 → 取 assetId → 查 snapshot.assets[assetId]
  ├─ 存在（有 access_url）→ 正常渲染素材
  └─ 不存在（该 assetId 不在字典里）→ 素材已删/失效 → 显示默认占位图
```

**关键**：`snapshot.assets` 字典里**查不到**的 assetId，就是「素材已删」。前端据此兜底显示占位图，不再静默丢弃。

> 现有 `resolveAssetRef(node)`（CanvasPage/index.tsx）在返回 null 时应改为返回占位图（而不是丢弃节点）。参考卡 `referenceImages` 里引用的失效素材同理——保留条目但显示占位。

---

## 2. 新增：素材-项目关联接口

画布使用/拖入素材时，前端调用该接口建立「素材↔项目」关联（跨项目复用素材时，让该素材出现在本项目的 snapshot.assets）。

### 2.1 调用

```
POST /api/projects/:projectId/assets/:assetId/link
```

请求（无 body）：
```json
{ }
```
路径参数：`projectId`（目标项目 id）、`assetId`（素材 id）。

响应：
```json
{ "code": 200, "data": { "projectId": "55", "assetId": "526" }, "msg": null }
```

### 2.2 语义

- **幂等**：同一素材重复 link 到同一项目 → 返回 200（`uk_project_asset` 唯一键，不重复建）。
- 触发时机：素材被拖入/加入画布时（前端 `useCanvasDoc` 水合到新素材时，或用户主动添加素材到画布时调用）。
- 效果：link 后该素材进入本项目的 `snapshot.assets`，前端即可正常渲染。

### 2.3 查询素材被项目引用数（IKCZAT）

```
GET /api/assets/:assetId/references
```

响应：
```json
{ "code": 200, "msg": null, "data": { "assetId": "526", "projectCount": 3 } }
```

**语义**：`projectCount` = 引用该素材的项目数（并集去重）——
- 素材表直接归属（`user_assets.project_id` ≠ 0）∪ `project_asset` 关联（`is_delete = 0`）
- **只计存活项目**：已删除项目（`projects.is_delete = 0`）不计
- 同一项目多来源只计一次

**用途**：删除素材前的确认弹窗——「该素材被 N 个项目引用，确认删除？」。只读接口，不拦截删除（删除仍走 `DELETE /api/assets/:assetId`，画布节点不动，见 §4）。

---

## 3. 与上传链路的关系

- **新上传素材**：`/api/agent/assets/uploads/complete` 落库时，若带 `project_id != 0`，后端**自动建 project_asset 关联**——前端无需额外调 link。
- **复用已有素材拖入画布**：前端调 `/api/projects/:pid/assets/:aid/link` 建立关联。
- **上传 md5 去重命中**（见 `asset-upload-dedup.md`）：`dedup` 命中时后端**自动 link** 到项目，前端拿 asset 即可，无需额外调。

---

## 4. 删除素材（后端已处理，前端仅感知变化）

后端删除素材 = 软删 `user_assets` + 软删 `project_asset` 关联，**画布节点不动**。前端删除素材后无需改画布——下次进画布时，被删素材的节点因 `snapshot.assets` 查不到而显示占位图。

> **2026-10-09 增补（ADR-0126）**：若该资产**已入库素材库**（`material_id` 非空），后端会**先删上游素材库里的那条素材**，成功才软删本地；上游删不掉则接口报 400（`code 2013`）且本地一行不动。前端删除前要弹框提示「会一并删除素材库素材，不可恢复」，详见 [`2026-10-09-material-binding-and-delete-cascade-api.md`](./2026-10-09-material-binding-and-delete-cascade-api.md) §2。

**前端删除素材**：仍调用 `DELETE /api/assets/:assetId`（后端软删+清关联），删除成功后前端清理资产库中的该项即可，**不触碰画布数组**。

---

## 5. 对接要点总结  

| 项 | 前端动作 |
|---|---|
| 进画布判断 | 遍历节点，`snapshot.assets[assetId]` 查不到 → 显示默认占位图（替代现有「丢弃节点」）|
| 添加素材到画布 | 调 `POST /projects/:pid/assets/:aid/link`（幂等，拖入/加入画布时）|
| 新上传素材 | 无需额外调（complete 自动建关联）|
| 删除素材 | 只清资产库该项，画布数组不动 |
| 占位图 | 前端硬编码一张默认图 URL，素材失效时显示 |

---

## 6. 相关工单/文档

- IKCNLP 资产删除一致性（后端，已合入 master）
- `asset-upload-dedup.md`：上传 md5 去重（dedup 命中自动 link）
- PRD：IKC3RY 资产删除与引用一致性
