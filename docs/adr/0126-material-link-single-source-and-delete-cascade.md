# 人像库关联收口：绑定留 assets、删重复的组列、删资产级联删上游素材、素材组列表改本地

素材库（虚拟/真人人像库）的「本地 Asset ↔ 上游素材」关联今天写了两遍——`assets.material_id`/`material_group_id`（IKDJNZ）与 `material_assets.material_id`/`material_group_id`（IKFYHJ）；而素材组列表只有虚拟组读本地，真人组透传上游，用户因此会看到不属于自己的组（2026-10-09 实测：user 66 拿到了 user 38 的两个组）。决定（2026-10-09 `grill-with-docs` 十二节点拍板，基线 `release/2026.09.29`，工单 IKKH81）：**绑定单一化到 `assets.material_id`，删掉真重复的 `assets.material_group_id`；删除本地 Asset 时级联删除上游素材，且上游先行；`ListAssetGroups` 两条路都读本地；`CreateAsset` 加入库前置判断。** 关联**不**搬进 `material_assets`——那张表的行是上游状态的缓存，其完整性按设计就不是权威。

## 决策

**绑定留 `assets` 侧，只删 `assets.material_group_id`。** 两表的 `material_id` **不是重复**：`material_assets.material_id` 是那行镜像的身份（我镜像的是哪个上游素材），`assets.material_id` 是绑定（我这条本地资产绑了哪个素材）——素材可以只被镜像、没被绑定。真重复的只有 group 列（值恒等于 `material_assets[assets.material_id].material_group_id`），而它全仓**唯一**消费者是删组清关联（`asset-repo.ts` 的 `clearMaterialGroupLink`），前端对 `material_group_id` 零消费。判据是读点数量：读「asset→material」的点包含 worker 热路径（`AssetMapper`，与 TS「逐字一致」的投影）、锁表 SQL、生成门；读「material→asset」只有 3 处。绑定留 `assets` 侧，最贵那批读点一行不用改。

**删组清关联改走 `material_assets`，并把调用顺序升为不变量。** `clearMaterialGroupLink` 改为先按 `(user_id, material_group_id)` 取 `material_assets.material_id`，再清 `assets.material_id`。因此 `material.controller.ts` 里（清关联）**必须**先于（硬删状态行）——顺序反了就查不到行、清不掉关联。今天这两行的顺序本来就是对的，本次把它写进测试，从此是约束而不是巧合。

**删除本地 Asset 级联删上游素材，上游先行。** `DELETE /api/assets/:assetId`：`material_id` 非空 → 先调上游 `DeleteAsset`，**2xx 或 `NotFound` 才算成功**；成功才软删本地，且**显式补** `clearMaterialLink` + `clearMaterialStatus`（后端自调不经 `material.controller.ts` 的透传旁路，那两个副作用最容易漏）。失败返回错误、本地一行不动。`NotFound` 视为成功是幂等的必要条件——否则上游已删的素材会让本地资产永远删不掉。

**新增素材列表反查接口，不改透传响应。** `POST /api/assets/library-materials` 内部调上游 `ListAssets`，输出左连本地 `assets`（键 `material_id`），**状态以上游为准**，本地只补 `asset_id`/`url`，未导入过的素材这两列为 `null`。`material-library-client` 的「信封与非 2xx 原样透传」是既有决策，注入自定义键既顶它、又与上游字段空间抢名字。**副作用与透传口同口径**：解析与「状态镜像 + Failed 统一处置」提进 `MaterialService.ingestUpstreamMaterialStatuses`，两个入口共用——否则前端按对接文档改走新端点后，镜像的回写来源就断了。

**`ListAssetGroups` 两条路都读本地，但 `GroupType` 仍分流。** AIGC→`kind="virtual"`、LivenessFace→`kind="real"`，走 `pageByUser(userId, kind, ...)`；缺失/未知 `GroupType` 沿用旧行为（透传）。**不能**理解成「忽略 `GroupType` 返回该用户全部组」——前端两个 tab 都靠它分流，忽略后两个 tab 会返回同一份。「只显示自己的组」只有本地表能保证：上游返回不带归属，而素材库是「共享、单租户」（`GLOSSARY.md`），透传就会串号。

**真人组镜像只在领组时落行，存量不补偿。** 领组成功（`GetVisualValidateResult` 返回非空 `GroupId`）后**补一次 `ListAssetGroups(GroupType="LivenessFace")` 并按 `Id` 命中取组名**，落 `kind="real"` 行；命中不到就回落成组 id（不丢行）。**不用 `GetAssetGroup` 取名字**——2026-10-10 实测上游对该接口回 `"Name": ""`（空串），真名字只在 `ListAssetGroups` 里（同一批组它回 `"Name":"1"`）。上游也**没有封面字段**，故 `cover_url` 恒为 null。存量真人组用户重走 H5 认证——代价是重新刷脸 + 重新上传素材，旧组留在上游。

**`CreateAsset` 加前置判断：同一个资产重复入库不再重复建。** 带 `SourceAssetId` 且该资产已有绑定时，先判一次绑定素材此刻的状态：**就绪 → 幂等短路**（返回上游同款信封，`Result.Id` = 既有素材 id，多一个 `AlreadyLinked: true`，**不打上游、不改绑定**——状态判定复用上传口的素材闸，本地行不在终态时可能顺带刷新一次状态镜像）；**判失败 → 清掉历史的**（上游 + 本地）后放行，让这次重新入库；**上游不可达 → 放行**（判不了就不拦）。失败分类按闸的 `reason` 判别位分流（**不按文案字符串**），未知分支一律走「放行不清」的安全向。放后端而不是前端，是因为**本地资产只能指向一条库素材**（`uq_asset_material_id` 单列唯一 + 覆盖写）：重复入库会把上一条素材在本地变成无人指向的孤儿，只有拦在调用上游之前才堵得死。前置判断**必须排在 `ensureVirtualDefaultGroup` 之前**——建组是上游写 + 落本地行，晚于它就会在短路之前先留下一次建组。

## Considered Options

- **把关联搬进 `material_assets`（加 `asset_id`）**：最初提案，省一张表的表数量。但绑定是本仓**自有事实**、镜像行是**上游缓存**，搬过去等于让自有事实的存在性依赖一个设计上就不完整的行集（存量不回填、`mirrorStatus` 明写「不得凭空造行」），且要动 worker 热路径、跨语言逐字一致的投影与锁表 SQL。否决。
- **另立独立绑定表**：职责最清晰，只在关联可能变 1:N 时才值。1:1 已由 `uq_asset_material_id` 与 `uk_material_assets_material` 双侧保证，ADR-0087 论证过维持 1:1。否决。
- **回填存量**：删的是列不是值，`material_id` 原样保留，回填没有收益；而「有 `material_id` 没 `material_group_id`」的老行本就不受删组清关联覆盖，**零回归**。否决。
- **删除级联走 best-effort**（先软删本地、上游删除不 await）：`handleUpstreamMaterialFailure` 那条口径的理由是「不拖挂一个正在被拒绝的请求」，在这里不成立——本次请求本身就是删除；且素材库列表以上游为准，「没删掉」会变成用户看得见却查不明白的现象，也没有任何东西会重试。否决。
- **改 `ListAssets` 透传响应注入 `asset_id`/`url`**：前端少一次调用，但顶掉原样透传决策。否决。
- **弹框区分真人/虚拟**：要 `material_assets.kind`，而 `GroupType` 只有 `GetAssetGroup` 拿得到，每次上传多一次上游往返，只换一句话的文案。否决。
- **存量真人组靠 `CreateAsset` 的 `GroupId` 自然收敛 / 靠拉一次上游 `ListAssetGroups` 全量落行**：前者证明不了归属（素材库单租户共享，「我用过」≠「它归我」）；后者会把别人的组落成自己的行，正好制造本 ADR 要治的问题。否决。
- **素材判失败时把 `material_assets` 状态行一起删掉**（2026-10-09 复核后维持现状）：动机是「有行无主」的孤立记录。否决，两条理由：① ADR-0087 决策 8 留 `Failed` 行是**有意的**，它让拦截点凭本地就能拒、不必每次实时打上游；② 「用户重走关联逻辑」不依赖删行——失败处置已经清掉 `assets.material_id`，下次上传走的是新的 `CreateAsset`。孤立行留着不影响任何行为。

## Consequences

- `assets` 少一列一索引；`bindMaterialId`/`clearMaterialLink` 的写入从「两列一起清」退化成单列，覆盖语义简化。删列后 `materialGroupId` 在上传链路上没有消费者，整条穿透链（上传闸返回值、`upload.ts` 调用点、`assets.service` 包装）一并摘掉——留它会是一个「传了但没人用」的哑参数。`material_assets` 的结构与 `NOT NULL` 约束**不动**。
- `GET /api/assets` 与项目快照的响应里不再有 `material_group_id`。前端零消费，但 `docs/api/` 下的契约文档要同步。
- **删组清关联改走 `material_assets` 后，存量「有 `material_id` 但无状态行」那批在删组旁路上清不掉**——它按 `material_assets.material_group_id` 反查，而那批没有行。**零回归**：改动前同样清不掉（那时按 `assets.material_group_id` 匹配，而那批该列是 NULL）。
- **入库前置判断的「清历史」是单向的**：清了旧素材之后这次 `CreateAsset` 若仍失败，用户就处在「旧绑定没了、新素材没建」的状态。可接受（被清的本来已 `Failed`、不可用，重传即走全新流程），但要当成明文而不是意外。清上游那半步是 best-effort（不 await，与 `handleUpstreamMaterialFailure` ③ 同口径）。
- **「组可见」与「素材可见」不同源**：组列表读本地、素材列表仍透传上游，而本地行会**领先于上游删除**（实测：本地那条 `real` 组在上游 `GetAssetGroup`/`ListAssets` 都 404）→ 用户能进组、却看不到素材。只可能来自「存量 + 上游侧删除」；正常路径（先领组落行 → 立刻上传素材）两边都有。
- **上游凭证形态在批次线上已变**：不再是调用方的 Bearer，而是项目级唯一的一把（`system_settings` 表 `upstream` 行，由 `SYSTEM_SETTINGS_SECRET` 解密）。因此级联删除与前置判断**不需要** `authorization` 形参。上游可见范围随之改变（同一调用方凭证能查到的组，未必仍能被项目 key 查到）。
- **并发仍是残余窗口**：前置判断是 check-then-act。两条**同时**到达的 `CreateAsset`（双击）在素材尚 `Processing` 时都会放行，各建一条、后者覆盖 `material_id`——本决策治的是顺序重复，不是并发重复。与 `ensureVirtualDefaultGroup` 的同类 tradeoff。
- 上游删除不可逆，本地删除是软删——不对称是有意的。
- **破坏性 DDL 的上线顺序**：镜像不做 `migrate deploy`，必须先上不再引用该列的两个镜像（TS backend 与 `server/blue-whale-worker`），再迁库。反了 =「新库 + 旧镜像」全站挂。
- 真人组存量用户要重走 H5 认证；旧组在上游残留。前期用户少，接受。
- 与 [ADR-0093](0093-material-autolink-and-upload-gate.md) 的关系：**推翻其布局的一半**（它把 `material_group_id` 与 `material_id` 成对写在 `assets` 上，并论证「这一列不是装饰」），保留其上传口自动关联与状态闸。
- 上游凭证形态在批次线上已变：不再是调用方的 Bearer，而是项目级唯一的一把（`system_settings` 表 `upstream` 行，由 `SYSTEM_SETTINGS_SECRET` 解密）。因此级联删除与前置判断**不需要** `authorization` 形参。
