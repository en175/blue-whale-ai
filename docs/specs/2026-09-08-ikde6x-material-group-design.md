# 素材库组落地设计（IKDE6X）

> 需求：IKDE6X 人像库去分组与上传智能校验。本文档只覆盖**后端**素材库组相关设计。
> 版本：**v2（2026-09-11，IKEXX8 修订）**——组查询由「全量走本地」改为**分流**（虚拟组读本地、真人组仍透传上游），撤回真人组镜像；v1（2026-09-08）见 git 历史。
> 前置阅读：[`docs/api/material-library.md`](./material-library.md)（素材库透传镜像、上游信封）、[`docs/api/2026-09-07-material-association-api.md`](./2026-09-07-material-association-api.md)（素材关联改造 IKDJNZ）。

> ⚠️ 排除项：**D2 上传智能校验后端不做**；**角色库弹窗前端逻辑不负责**；「从资产选择复制入库」= 纯前端动作，后端不做、覆盖判断由前端自主决定。

---

## 0. 意图（为什么这么改）

素材库（虚拟人像库 + 真人像库）当前是**上游透传、本地零落表**，组（`group-...`）只存在于上游。产品需要：

1. **虚拟人像库去分组平铺**（D1）：虚拟人像库取消二级文件夹，素材平铺。对前端而言「虚拟组」不可见。
2. **角色库弹窗**（D3）：视频生成选参考时，素材按文件类型（图片/视频/音频）平铺展示；真人人像保留分组。
3. **虚拟组查询提速与可控**（v2 收窄）：**虚拟组**信息落本地表、查询走本地，不每次透传 newapi；**真人组**仍以上游为唯一数据源、查询保持透传（真人组由刷脸认证流程序列生成、产品侧无建组入口，镜像必漂，v1 的真人组双向维护方案作废）。

因此：**写权威恒为上游**；本地表只维护**虚拟组镜像**（上游建组成功后落表），虚拟组读路径走本地。

---

## 1. 数据模型

### 1.1 新表 `material_groups`（素材库组）

```prisma
/// 素材库组（IKDE6X）：虚拟人像库 + 真人像库组落地。本地为组主、上游备份、双向维护。
/// kind：virtual=虚拟人像库组（每用户至多 1 个默认组），real=真人像库组（每用户可多个）。
/// cover_url：封面图（真人组用，虚拟组可空）。
/// material_group_id：上游组 id（group-...）。虚拟组由后端创建（CreateAssetGroup）+ 本地落表；
/// 真人组沿用上游组结构，本地镜像。
model material_groups {
  id                BigInt   @id @default(autoincrement())
  user_id           BigInt
  material_group_id String   @db.VarChar(128)  // 上游组 id（group-...）
  kind              String   @db.VarChar(16)   // virtual | real
  name              String   @db.VarChar(128)
  cover_url         String?  @db.VarChar(512)  // 封面图（真人组用，virtual 可空）
  is_default        Boolean  @default(false)   // 每用户虚拟默认组标记（virtual 至多 1 个）
  status            String   @default("normal") @db.VarChar(32)
  gmt_create        DateTime @default(now()) @db.DateTime(0)
  gmt_modified      DateTime @default(now()) @db.DateTime(0)
  version           Int      @default(0)
  is_delete         Boolean  @default(false)
  deleted_at        DateTime? @db.DateTime(0)

  // 每用户「虚拟默认组」至多 1 个：用 part 唯一键（functional unique 无法在 Prisma 直接表达，
  // 落库用生成列或应用层保证；此处示意），仅对 is_default=true 的 virtual 组生效。
  @@index([user_id, kind], map: "idx_material_group_user_kind")
  @@index([user_id, is_delete], map: "idx_material_group_user_alive")
  @@unique([user_id, material_group_id], map: "uk_material_group_user_upstream")
}
```

**字段说明**：

| 字段 | 说明 |
|---|---|
| `user_id` | 归属用户（用户维度隔离；组是用户自己的） |
| `material_group_id` | 上游组 id（`group-...`），本地 `(user_id, material_group_id)` 唯一——同一上游组不重复落两行 |
| `kind` | `virtual` / `real` |
| `name` | 组名；虚拟默认组名 = `默认分组：<userId>` |
| `cover_url` | **封面图地址**（真人组用，预留；虚拟组可空） |
| `is_default` | 虚拟默认组标记；每用户 `virtual` 至多 1 个 true |
| `status` / `is_delete` / `deleted_at` | 生命周期（`normal` / 软删） |

**迁移**：一次 Prisma migration + 双轨 SQL（`packages/persistence/schema/NNN_*.sql`）+ `docs/sql/` 快照（ADR-0061 / git-workflow 强制）。

---

## 2. 虚拟组：每用户 1 个默认组

### 2.1 语义

- 每用户**至多 1 个**虚拟默认组（`kind=virtual, is_default=true`）。
- 前端**不感知**组存在、不传 `GroupId`。
- 首次向虚拟人像上传素材时，后端**自动建组**。

### 2.2 自动建组触发点（唯一入口）

`backend/apps/blue-whale/src/api/material/material.controller.ts` 的 `CreateAsset` 分支：

1. 进入 `CreateAsset`，先查本地当前用户有无 `virtual` 且 `is_default=true` 的组。
2. **无** → 调上游 `CreateAssetGroup`（组名 `默认分组：<userId>`）创建虚拟组 → 本地落 `material_groups`（`kind=virtual, is_default=true, material_group_id=<上游返回 group id>`）。
3. **有** → 复用该组。
4. 用该组的 `material_group_id` **强制替换**请求体 `GroupId`，走正常 `CreateAsset` + 既有关联旁路（IKDJNZ `linkAssetToMaterial`）。

> 事务性：建组（上游 CreateAssetGroup）+ 本地落表必须原子——上游成功但本地落表失败要能回滚/补偿；上游失败则本次 CreateAsset 失败（避免落到不存在的组）。

### 2.3 默认组名

`默认分组：<userId>`（动态拼接用户 id，每用户一个）。

---

## 3. 真人组：不落本地表（v2 修订，原「本地镜像」方案撤回）

- 每用户可有**多个**真人组，保留分组结构——但数据源**只有上游**。
- 真人组由刷脸认证流程在上游生成（`GetVisualValidateResult` 出 `GroupId`），产品侧无建组入口；v1 计划的真人组镜像没有可靠的写入钩子，镜像必漂，**撤回**。
- 本地表 `kind=real` 列与 `cover_url` 保留（schema 不回滚），但当前无写入方；真人组查询走透传（见 §5）。

---

## 4. 组操作双向维护

| 动作 | 上游 | 本地 | 说明 |
|---|---|---|---|
| 建组（虚拟默认） | `CreateAssetGroup`（带 `GroupType:"AIGC"`） | 写 `material_groups`（virtual, is_default=1） | 见 §2.2；本地落表失败补偿删上游组 |
| 删除组 | `DeleteAssetGroup`（先远程） | 软删 `material_groups`（is_delete=1，仅虚拟行有实体，真人=空操作） | 上游成功后本地同步删除 |
| 建组（真人）/ 改组名 | 仅上游 | **不落/不同步（v2 撤回）** | 真人组不镜像；产品不支持改名，`UpdateAssetGroup` 不接 |

**一致性原则（v2）**：**写权威=上游，虚拟组读权威=本地**。上游 2xx → 本地同步；本地同步失败仅告警、不阻断透传（半程失败容忍，接受短暂漂移，不做分布式事务）。

---

## 5. 组查询分流（v2 重写：原「全量走本地」改为按类型分流）

全部复用 `POST /api/material/{Action}` 透传入口，**零新增路由**，请求/响应形状与上游完全一致（前端无感）：

- `ListAssetGroups`：`Filter.GroupType==="AIGC"` → 读本地 `material_groups`（`kind=virtual` 未删，`user_id` 隔离，`gmt_create desc, id desc`，`PageNumber/PageSize` 分页 + `TotalCount`）；**其余一律透传上游**（无 Filter / `LivenessFace` / 陌生值，保守兜底）。
- `GetAssetGroup`：`Id` 命中本地虚拟组 → 本地返回；未命中（真人组等）→ 透传上游。
- 本地合成信封对齐上游实测形状（2026-09-11 样例）：`Result.Items[] = { Id, Name, GroupType:"AIGC", CreateTime, UpdateTime }`（时间 ISO8601 秒精度 Z）；`ResponseMetadata.RequestId` 本地造 `req_<uuid>`。
- 存量：上游已有、本地无行的历史虚拟组**不回填**（用户裁定，2026-09-11）；真人组因透传上游天然无存量问题。
- 素材读路径（同单扩展）：`/api/assets` 列表、单资产详情、`GET /api/projects/:id/snapshot` 的 assets 均成对返回 `material_id`/`material_group_id`（snake_case，未关联为 null）；access/content 与 Agent resolve 内部投影不加。

---

## 6. 相关现状（改造基线）

- 素材库透传镜像：`backend/libs/shared/material/material.service.ts`（白名单 12 个 Action，含 `CreateAssetGroup/ListAssetGroups/GetAssetGroup/DeleteAssetGroup/UpdateAssetGroup`）。
- 关联旁路：`material.controller.ts`（`CreateAsset` 剥离 `SourceAssetId` + 成功回写 `material_id/material_group_id`；`DeleteAsset`/`DeleteAssetGroup` 清关联）。
- `assets` 表已含 `material_id`/`material_group_id`（IKDJNZ），无校验状态列。
- 虚拟/真人像库数据：上游（material 透传零表），本地无落表（除 `assets.material_id/group_id` 镜像）。

---

## 7. 后端验收要点

1. 首次向虚拟人像上传 → 本地自动建虚拟默认组（选本地查询不到才建）+ 上游 `CreateAssetGroup` 成功 + 本地落表成功，三者一致才提交成功。
2. 再次上传同用户 → 复用已建虚拟默认组，不重复建。
3. 上传到虚拟人像：请求体 `GroupId` 被后端强制替换为虚拟默认组，前端传的 GroupId 不生效。
4. 虚拟默认组名 = `默认分组：<userId>`。
5. 真人组（v2）：不落本地表，查询透传上游行为与改造前一致。
6. 组查询分流（v2）：`ListAssetGroups(AIGC)` 与 `GetAssetGroup` 本地命中不触发 newapi 调用、信封与上游实测样例一致；无 Filter / `LivenessFace` 透传行为与改造前 diff 一致。
7. 删除组（上游成功）→ 本地软删 `material_groups`（真人组无行=空操作）；本地失败仅告警不阻断。
8. 字段命名统一 snake_case，跟 `assets`/`shared_assets` 等表一致。

---

## 8. 实现范围（重要）

本契约 v1 对素材库组做了**较完整**的设计（组表落地、虚拟组自动建组、组查询走本地、真人组镜像、双维护）；v2（IKEXX8）撤回真人镜像、组查询改分流。IKE0OH（表落地）交付：

- **组表落地**（`material_groups`，schema + migration + 双轨 + 快照）；
- **虚拟组自动建组**（`MaterialService.ensureVirtualDefaultGroup` + controller `CreateAsset` 未传 GroupId 时兜底替换）；
- **组表 repo**（upsert / findVirtualDefault / listByUser / findByUserAndUpstream / softDelete）。

**IKEXX8（v2）接线**：

| 契约条目 | 状态 |
|---|---|
| §5 组查询分流 | ✅ 已接：`MaterialService.tryServeLocalGroupAction` + controller 特判（AIGC 本地 / 其余透传；GetAssetGroup 命中分流）；`listLocalGroups` 被 `pageByUser` 分流取代删除 |
| §3 真人组镜像 | ❌ 撤回（v2）：无可靠写入钩子，真人组保持透传 |
| §4 建组补 GroupType / 删组本地软删 | ✅ 已接：`ensureVirtualDefaultGroup` 显式 `GroupType:"AIGC"`；`DeleteAssetGroup` 2xx 旁路 `softDeleteLocalGroup`（失败仅告警） |
| 素材读路径 `material_id`/`material_group_id`（§5 末条） | ✅ 已接：`AssetView`（列表+单详情+insertCopy）与 snapshot `SnapshotAssetSummary` 成对吐出 |

> 结论：契约 v2 全部范围已由 IKE0OH + IKEXX8 两单闭环；验收要点（§7）按 v2 口径逐条满足。
