# 上传口素材自动关联与状态闸（Material Auto-Link & Upload Gate）

- **状态**：Accepted（决策已定；实现分落 `IKGQWR` / `IKGQWS`，骨架已由 `!726` 落地）
- **日期**：2026-09-18
- **决策者**：李小强（经 `grill-with-docs` 会话确认）
- **关联工单**：父需求 `IKDE6X`（人像库去分组与上传智能校验）
  - `IKGQWR`【后端】素材上传口自动关联：补状态闸、material_group_id 与覆盖语义
  - `IKGQWS`【前端】人像库素材入画布统一走本地资产：去掉硬编码 Active、接上传口 400
  - `IKGQWW`【测试】素材上传口自动关联与状态闸验收（IKDE6X）
- **上游决策**：[ADR-0087 素材校验状态镜像与生成拦截](0087-material-compliance-status-mirror-and-generation-gate.md)（本 ADR 是它在上传口的延伸）。ADR-0087 与 `material_assets` 表目前在 `release/2026.09.15` 批次分支上，随该批次合入 master；本 ADR 若先于它落到 master，该链接暂时悬空。
- **部分实现**：`!726`（`a8d7d533`，2026-09-18 合入 `release/2026.09.15`）已落地本 ADR 的骨架，**缺口三条见「决策 6」**

## 背景

### 病灶：画布把素材库 id 当成本地资产 id

人像库（虚拟 + 真人）的素材 id 形如 `Asset-...`，本地 `assets` 表的 id 是纯数字。画布节点只认数字 `assetId`（它按 `snapshot.assets[assetId]` 取图），两者的接法一直是**在同一个字段里塞两套 id 空间、靠前缀区分**：

- `web/src/pages/CanvasPage/videoMediaRefs.ts` 的原注释把这件事写成了「不可能」：*「素材库 asset- 前缀 ID 无法落画布节点」*，于是素材库素材只能存在草稿节点 `data.draftMaterialRefs` 里，靠 `isLibraryOnlyVideoRef`（`nodeId === materialId`）与普通连线参考区分删除语义。
- `CanvasPage/index.tsx` 的 `complianceFromAsset` 对素材库条目**仅凭 id 前缀**就短路：

  ```ts
  const fromLibrary = isMaterialLibraryId(id);
  const materialId = fromLibrary ? id : asset.material_id;
  if (asset.material_status !== 'Active' && !fromLibrary) return {};   // ← 前缀即放行
  return { materialId, compliancePassed: true, complianceFailed: false };
  ```

  不止一处，另有帧位注入与草稿物化共四处同样按前缀短路。

后果有两层。表层是画布数据脏：一个节点字段里混着 `Asset-...` 和 `12345`，所有消费方都要写前缀分支。更深的一层是**生成门的边被绕开了**——生成门（ADR-0087）的判据是「引用里带 `material_id` 就查它的校验状态」，它今天只能靠**前端自报**哪个 id 是素材库 id；前端不报，门就看不见。

### 目标形态

**画布上只有本地 Asset。** 素材库素材进画布前先转成一条本地 `assets` 行，把 `assets.material_id` 写上去；此后画布、生成请求、worker 全程只认数字 `asset_id`，素材库状态由后端沿 `assets.material_id` 反查。

这条边一旦补上，生成门就从「信前端前缀」变成「查本地关联」，`docs/api/material-library.md` §5.1 写给前端的警告才真正成立：

> 如果某个本地 Asset 被用户「入库」过，那它身上就带了素材库绑定。此后再拿它做视频参考，走的是同一个门——**前端传的是 `asset_id`，但后端会追到它背后的素材状态**。

### `!726` 已经建好的那一半

| 本 ADR 的条目 | `!726` 落地情况 |
| --- | --- |
| `dedup` / `complete` 接收素材库 id | ✅ 两个 DTO 都加了 `materialId` |
| md5 命中即自动关联 | ✅ `handleDedupAsset` 命中后调 `bindMaterialId` |
| 按素材库 id 反查已有本地资产（免上传复用） | ✅ `handleCompleteAsset` 先走 `findOwnedByMaterialId` |
| 前端取字节 → md5 → dedup → 未命中走三段上传 | ✅ 新增 `web/src/pages/CanvasPage/livenessLibraryImport.ts` |
| 唯一键冲突不报错 | ✅ `bindMaterialId` 吞 P2002 返回 true；`createUploadedAsset` 吞 P2002 回读代表行 |

这一半是**对的**，本 ADR 不推翻。反查折进上传接口（而不是新开一个 GET 端点）也是有意的好设计：`dedup` 本来就是「上传前探测」口，「这个素材在本地有没有对应资产」是同一类问题的第二个答案源。

### 还差的三条

1. **上传口没有状态闸。** `!726` 的整个 diff 里没有一处读 `material_assets`。素材还在 `Processing`、或已被判 `Failed`、或在上游已不存在时，上传照常返回成功并写关联。
2. **`material_group_id` 没写。** `bindMaterialId` 与 `createUploadedAsset` 都只写 `material_id`。这一列不是装饰：ADR-0087 决策 8 的清关联是**两列一起清**（只清 `material_id` 会留下悬空组关联），删除素材组走的 `clearMaterialGroupLink` 也按它匹配。少了它，这批素材在删组/删素材旁路上是漏的。
3. **冲突策略是「保留」而非「覆盖」。** `bindMaterialId` 的首行是 `if (owned.material_id) return true;`——已有的关联原样保留。本 ADR 改为覆盖（决策 5）。

另有一处不在接口契约内、但后果更直接的问题：`livenessLibraryImport.ts` 的 `toLocalAssetRecord` **硬编码 `material_status: 'Active'`**。这个值会喂给 `complianceFromAsset` 的 `if (asset.material_status !== 'Active') return {}`，于是节点被打上 `compliancePassed: true`——**前端在没有任何服务端校验的情况下自称合规**，正是 ADR-0087 要堵的那个洞，只是换了个入口。

## 决策

### 1. 接口形状

`POST /api/agent/assets/uploads/dedup` 与 `POST /api/agent/assets/uploads/complete` 各接收可选字段 **`materialId`**（素材库素材 id，`Asset-` 前缀，大小写不敏感）。

字段名沿用 `!726` 已合入的 `materialId`（camelCase）。它与同 DTO 内其余字段（`storage_key`、`project_id`）的命名风格不一致，是既成事实；**本次不改**——改名是破坏性 churn，而收益只是命名一致。**记为已知不一致**，下一个同类字段仍按 snake_case 走。

非法值（非字符串 / 不匹配 `^asset-.{1,128}$`）**忽略并跳过关联，不阻断上传**——与 `!726` 一致。

### 2. 判定顺序

**带 `materialId` 时**先跑状态闸（决策 3），闸不过则不写关联（决策 4）。

`dedup`：

1. 跑状态闸
2. 找可复用资产：**md5 命中该用户未删资产**，或 **按 `assets.material_id` 反查命中**
3. 命中 → 覆盖写关联（决策 5）→ 返回 `{dedup:true, asset}`
4. 都没命中 → `{dedup:false}`，前端走 presign → PUT → `complete`

`complete`：

1. 跑状态闸
2. 按 `assets.material_id` 反查命中 → 复用该资产并建项目关联，**不消费字节**（`!726` 已有）
3. `findCommittedUpload` 幂等命中 → 复用并写关联
4. 建新行 → 写 `material_id` + `material_group_id`

### 3. 状态闸

查 `material_assets`（带 `user_id` 谓词，对齐 ADR-0087 决策 1 的纵深防御）：

| 表内状态 | 处理 |
| --- | --- |
| `Active` | **放行**，继续写关联 |
| `Failed` | **拒绝** |
| `Processing` | 实时查上游 `GetAsset` → 回写行 → 按返回值判 |
| **无记录** | 实时查上游 `GetAsset` → **补建行** → 按返回值判 |
| 上游不可达（网络 / 超时 / 鉴权 / 限流 / 5xx） | **拒绝**，可重试文案 |

**「无记录 → 补建行」是本 ADR 相对 ADR-0087 的唯一增强，也是上传口独有的一次机会。** ADR-0087 的生成门在无记录时只能每次实时查上游，它自己的注释承认了这点：*「无记录的素材因此每次都会实时查一次上游——正确性不打折，只多一次往返」*，原因是**造行需要 `material_group_id`，而只有 `CreateAsset` 拿得到**。上传口恰恰是第二个拿得到的位置：上游 `GetAsset` 的返回体里有 `GroupId`。补一次行，存量素材从此不必每次回查。

这条同时解决了「H5 真人流的素材 / IKFYHJ 之前的存量素材一律被拒」——它们都没有本地行。

**判定与文案复用生成门，不写第二份**：`backend/libs/shared/generation/material-compliance-gate.ts` 的 `isMaterialLevelRejection`（`/^(?:NotFound|InvalidParameter)\.asset/i`）与两个常量 `MATERIAL_NOT_APPROVED_MESSAGE` / `MATERIAL_STATUS_UNAVAILABLE_MESSAGE`。ADR-0087 决策 6 那张错误码表是 2026-09-15 真网关实测逼出来的，在上传口重造一遍判断必然重犯它踩过的坑。

**错误码形状照抄生成门**：**一个新码 + 两条 `msg`**，前端按 `msg` 分流（终局 → 引导重走合规校验；暂时故障 → 给重试按钮）。不用两个码，否则前端要维护两套分流规则。数值码落在 `ASSET_ERROR_SPECS`（现有 2001–2012）的段位里。

### 4. 状态闸只决定「写不写关联」，不决定「建不建资产行」

`Active` → 建行/复用 + 写 `material_id` + `material_group_id`。
非 `Active` → 建行/复用，**不写关联**，按决策 3 返回错误。

两条理由：

- `complete` 路径上字节**已经** PUT 到 TOS 了（`backend/libs/shared/assets/upload.ts` 的注释原话：「字节比这道门先落地……`complete` 是它第一次有机会看见文件」）。拒绝时把一份用户真实上传的文件删掉，是拿一次合规失败额外罚一次文件。
- 它与 ADR-0087 决策 8 步骤②「判 `Failed` 时清空关联」**收敛到同一个终态**：素材在库里 `Failed`，本地是一张未关联的普通 asset。两条路走出来的世界是同一个。

### 5. 冲突：覆盖，但双向

同一个 `material_id` 在新旧两条本地行之间竞争时，**以新上传者为准**（覆盖）。素材的字节由 md5 定义，md5 相同即同一张图，改嫁不改变任何事实。

`uq_asset_material_id` 是**全库唯一**（ADR-0087 影响节已论证维持不动）。因此覆盖必须是**同一个事务里的两步**：

```sql
UPDATE assets SET material_id = NULL, material_group_id = NULL
  WHERE material_id = ? AND user_id = ?;      -- 先把旧主摘下来
UPDATE assets SET material_id = ?, material_group_id = ?
  WHERE id = ?;                                -- 再写到新行
```

只做第二步会撞唯一索引 P2002 → 500。**这是崩溃路径，不是策略分歧**，实现时不能省第一步。

### 6. `!726` 三条缺口的落点

1. 状态闸 → 在 `handleDedupAsset` 与 `handleCompleteAsset` 的状态闸处接入（`backend/libs/shared/assets/upload.ts`），依赖 `material_assets` 的读 + 上游 `GetAsset` + 补行。
2. `material_group_id` → `bindMaterialId` 与 `createUploadedAsset` 的写入同时补列（`backend/libs/shared/persistence/asset-repo.ts`）。
3. 冲突策略 → `bindMaterialId` 去掉 `if (owned.material_id) return true;` 的保留语义，改为决策 5 的双向覆盖；`createUploadedAsset` 的 P2002 兜底（回读代表行）保留，作为并发下的安全网。

前端同步去掉 `toLocalAssetRecord` 里硬编码的 `material_status: 'Active'`，改由服务端返回值决定；并处理上传口新出现的 400（按 `msg` 分流）。

### 7. 范围与覆盖

- **只做后端接口契约；前端改动独立工单。** 理由见「影响」末条。
- **虚拟人像库与真人人像库都覆盖。** 后端状态闸与库类型无关，两条路完全同构；只做一条会让前端再走第二遍。

## 被否方案

- **反查单独开一个 `GET /api/assets?material_id=X`。** 可行且更「REST」，但会让前端必须记住「先 GET 反查、再 POST dedup」这个顺序。折进 `dedup` 之后规则只有一句：*带着 `materialId` 调 dedup，永远返回「能不能复用已有资产」。*
- **后端服务端下载素材字节 → 写 TOS → 建行。** 把一次可达 200MB 的搬运塞进请求路径，且要新增一套「后端代传」能力与限流。`!726` 已选前端取字节，是对的。
- **`complete` 从素材 URL 解析出 `storage_key` 直接复用（零字节搬运）。** 只对「本用户经本仓 UI 上传过」的素材成立；H5 真人素材的 URL 在上游桶里，会被 `storage_key.startsWith('uploads/{userId}/{type}/')` 归属门当场拒掉——而那恰是最需要走这条路的一类。
- **在 `assets` 上加 `material_status` 列。** ADR-0087 已否决过（账号维度事实不能塞进项目维度表，且素材可以完全没有本地 Asset）。本次不重启。
- **把 `uq_asset_material_id` 改成 `(user_id, material_id)`。** ADR-0087 已论证 1:1 成立且其理由**已经把 md5 去重算进去了**（「同类文件走本地 Asset 的 md5 去重落到同一 asset 行」）。只改 `assets` 那张会让两张表的唯一性语义分叉；`material_assets` 的唯一键同样只有 `material_id`。
- **补 `material_groups` 的真人组镜像。** 与本次正交（本改造要的 `material_group_id` 是 `assets` 上的字符串列，来源是 `material_assets` 或上游 `GetAsset`，不经过 `material_groups`）。且 v2 契约撤回它的理由是「没有可靠的写入钩子，镜像必漂」，而 `kind` 只能从 `GetAssetGroup` 拿（`CreateAsset` 请求体与 `GetAsset` 返回体都不带 `GroupType`）——要么每次上传多一次上游往返，要么用启发式。**独立立项**。
- **状态闸失败时删掉已 PUT 的字节（对齐 `rejectUploadedObject`）。** 见决策 4。
- **`materialId` 改名为 `material_id`。** 纯破坏性 churn，收益只是命名一致。

## 影响

- **`dedup` 上的闸是提前量，`complete` 才是防线。** `web/src/utils/upload.ts` 的 `uploadAssetFile` 是 `await dedupUpload({...}).catch(() => undefined)`——前端会**静默吞掉 `dedup` 的任何错误**然后照常走三段上传。所以只加在 `dedup` 上的闸今天不拦任何东西。本次不改前端这条 catch（前端独立工单），但**必须知道真正生效的拦截点在 `complete`**。
- **非 `Active` 也建资产行 ⇒ 那张图会以普通本地素材身份继续可用。** 生成门查 `assets.material_id` 为 null 即放行。这正是 ADR-0087「已知缺口 1」原文承认过的行为（「判定失败的素材不会再被这道门拦，而是以『普通本地素材』的身份继续可用」），**本改造给它多开了一条入口**。PRD 的成功指标（「未通过素材成为视频生成参考的次数 = 0」）在这一条上要按「素材库引用」而非「本地素材」解释。
- **本改造的真正价值是给生成门补一条它看不见的边。** 前端改发 `asset_id` 之后，门只能靠 `assets.material_id` 反查才追得到素材状态；这一列写不上，`docs/api/material-library.md` §5.1 那条警告就不成立。评估收益时按这条算，不要按「画布数据变干净」算。
- **`material_assets` 的写入口从 1 处变 2 处。** 原本只有 `CreateAsset` 2xx 落行；现在上传口也能补行。「无记录 → 实时查上游」这条规则的成本随之下降，但两条写入路径对同一行的并发语义要一起看（repo 的 `version` 列只递增、不参与比较，last-writer-wins 是有意的）。
- **存量数据不回填。** 已有的 `assets.material_id` 缺 `material_group_id` 的行**不批量补**——补它需要逐行查上游。这些行在删组旁路上是漏的，属已知残留；下次它们经过上传口或生成门时自然收敛。

## 已知缺口（本期不修，单独跟进）

1. **前端吞错。** `uploadAssetFile` 的 `.catch(() => undefined)` 让 `dedup` 的拒绝静默失效（见「影响」）。前端工单修。
2. **`material_groups` 真人组无镜像**，本地因此分不出真人 / 虚拟，进而卡住 ADR-0087 决策 4 的批量跟进（只能逐行 `GetAsset`）。ADR-0087 把这条瓶颈的理由写成「`material_groups` 的真人组镜像又尚未实现」，读起来像真人素材完全没镜像——**但 `material_assets` 恰恰是有行的**（`applyLinkSideEffects` 只看 id 格式、不看组类型）。这条 ADR 的措辞需要一次勘误。
3. **`material_assets` 无 `kind` 列**，是缺口 2 的同一件事的另一面。

## 验收

1. 带合法 `materialId` 调 `dedup`，md5 命中已有资产 → 该行 `material_id` 与 `material_group_id` 两列都被写入。
2. 带 `materialId` 调 `dedup` / `complete`，素材在 `material_assets` 为 `Failed` → 400，文案为「该素材未审核通过…」，**不写关联**。
3. 同上但素材无本地行 → 后端实时查上游并**补建 `material_assets` 行**；上游回 `Active` 则放行。
4. 上游不可达（断网 / 401 / 5xx）→ 400，文案为「素材状态校验失败，请稍后重试…」，不写关联。
5. 同一个 `material_id` 已被另一条本地行占用 → 覆盖为当前行，且**不出现 500**（事务内先清旧主）。
6. `complete` 时素材非 `Active` → 资产行照常建立、`material_id` 为空；该资产随后作为普通本地素材可正常用于生成。
7. 虚拟人像库与真人人像库两条路行为一致。
8. 不带 `materialId` 的既有上传路径**行为逐字节不变**（回归）。
