# 素材校验状态本地落表，并在生成采纳处校验

- **状态**：Accepted
- **日期**：2026-09-15
- **决策者**：项目团队（经 `grill-with-docs` 会话确认）
- **关联工单**：`IKFYHJ`（本单，挂技术维护母工单 `IKAZIG`）；需求来源 `IKDE6X`（人像库去分组与上传智能校验，PRD v1.4 待评审）、`IKDGLE`（画布右键操作梳理）、`IKDRFQ`（右键合规校验与角色库入库，前端已 closed）
- **部分推翻**：[ADR-0077](0077-material-library-passthrough-zero-local-state.md) 决策 1「零本地表、不镜像状态」及被否方案「本地映射表」

## 背景

产品的「**合规校验**」在实现上就是**把素材上传进素材库**（虚拟人像库 AIGC 组）：`CreateAsset` 成功后上游异步注册，素材状态 `Processing → Active | Failed`，注册结果即校验结果。PRD 的成功指标是「未通过素材成为视频生成参考的次数 = 0」。

现状有三处缺口，且都不是疏漏而是文档化的设计意图：

1. **后端对状态零感知**。`backend/libs/shared/material/**`、`generation/**`、`packages/core/src` 全仓 grep `Active|Processing|Failed` 零命中。`handle-create-generation-job.ts:1494` 原文：「仅本地 Asset 引用需要查存在性；素材库引用（asset:// 载体）由上游强校验，格式已在前置校验。」
2. **两条绕过路径**：重试路径 `generation-command-repo.ts` 的 `retryJob` 逐字拷贝原 `input`，无任何重校验；本地 `Asset` 已绑 `material_id` 时由 worker 自动转 `asset://<id>`（`worker-java/.../VideoJobProcessor.java:586-600`「本地 Asset 命中素材库关联 → 生成时改走素材库 id」，TS 侧原实现 `video-job-runner.ts:687-752` 已随 ADR-0084 退役），前端物理上无从拦截。

> **勘误（2026-09-15）**：本 ADR 初稿列的缺口 2「前端拿『上传成功』当『校验通过』、没有轮询」**对 0915 树不成立**，已删除。前端同期已由 `03b107d2`（IKFVMQ，mwq，2026-09-15 16:17，「画布合规校验改为轮询 GetAsset」）补齐：`characterLibraryDeposit.ts:67` 在 `CreateAsset` 后 `await waitAssetReady(Id)` 轮询到 `Active`，`CanvasPage/index.tsx:3323` 复用既有 `materialId` 时同样 `await waitComplianceAssetReady`，两者都是**通过后才**置 `compliancePassed: true`，失败走 `failNodeCompliance`。该提交在本 ADR 的基点之前，属初稿读漏，非后续变化。**本 ADR 的动机因此收窄为「后端侧零感知」这一条**——前端已经做到「等到 `Active` 才放行」，缺的一直是后端那道闸；不补后端，用户 A 上传通过的素材被用户 B、或同一用户在重试/本地 Asset 转换路径上绕开校验，前端轮询管不着。

ADR-0077 当时明确否决过「创建生成任务时同步调 `GetAsset` 预检」（理由：预检通过≠执行时仍有效）。本次决策**不与之矛盾**：那条否决的是「用预检**替代**上游强校验」，本次要的是「用前置校验**拒绝**已知不可用的输入」——拦截非法输入与信任上游是两件事。

## 决策

1. **新建 `material_assets` 表镜像素材校验状态**（推翻 ADR-0077 决策 1）。
   表按 `material_id` 唯一，含 `user_id`、`material_group_id`、`status`、`error_code`、`error_message`、`status_checked_at` 与既有生命周期列。**不落 `asset_type`**——类型随请求携带（见 `CONTEXT.md` 素材引用），落库会造出第二个真相源。
   **唯一键只用 `material_id`，不建 `(user_id, material_id)` 组合唯一索引；但所有读写查询都必须带 `user_id` 谓词。** 素材 id 名义全局唯一（本次拍板），实际隔离语义在账号维度（`docs/api/material-library.md:298`）——带 `user_id` 是防跨账号误读的纵深防御，不是唯一性约束。命名取 `material_assets` 而非 `material_asset_status`，是为后续扩展留余地。

2. **该表是判据，不是缓存。** 生成任务创建期与重试期按它判定素材能否用作视频生成参考：

   | 表内状态 | 处理 |
   | --- | --- |
   | `Active` | **放行** |
   | `Processing` | **实时查上游 `GetAsset`**，用返回值判定并回写 |
   | `Failed` 及其他 | **报错拒绝** |
   | 无记录 | **实时查上游**，用返回值判定并回写 |
   | 压根没有 `material_id` | 放行（从未入过素材库，不在校验范围） |

3. **只放行 `Active`**（Active-only）。这**与 PRD `IKDE6X` §11.2 OD-D1 的推荐项相反**（OD-D1 推荐「校验中不限制，未通过后拦截」），是技术侧的直接取舍，不另找产品确认：上游只在素材就绪后接受它，放行 `Processing` 的后果是「生成任务必然失败」而非「风险素材进了生成」，所以这是 UX 取舍而非安全取舍——让用户等几秒，好过点了生成再白跑一次。**本条是对 PRD 待评审开放决策的单方面落定，验收时若被按 OD-D1 质疑，以本 ADR 为准说明取舍。**

   补充事实（不改变上述判断，但影响验收口径）：**前端已按上游三态展示徽标**（校验中 / 校验通过 / 审核失败，`MediaNode/index.tsx:457-468`），且只在轮询到 `Active` 后才标「校验通过」。所以本次后端 Active-only **不是引入一套新产品行为，而是把前端已有的判定搬到后端补一道闸**——产品验收时的实际观感变化，主要来自「绕过路径被堵住」（用户绕开画布 UI 的重试与本地 Asset 转换）而不是「校验中原来能用、现在不能」。

4. **写入与更新四处**：
   - **定时兜底（主机制）**：在 `worker-java` 每 5 秒扫描 `material_assets` 中 `Processing` 且**创建未满 10 分钟**的行，
     逐行调 `GetAsset` 跟进到终态；超 10 分钟未收敛的**停止跟进，状态保持 `Processing` 不变**（不引入第四态，展示层本就以上游响应为准）。
     它不依赖任何外部流量——「用户点完校验就刷新页面、之后没有请求」是常态而非边角，状态的收敛不能建立在「之后会有人发请求」上。
     放 Java 侧的理由：`worker-java` 已是唯一的后台执行面（TS `generation-worker` 已退役，迁移契约 §7「recovery/asset-GC 留 TS 进程」随之失效），
     `worker-java/.../application/service/RecoveryService.java` 是同类 cron 的现成先例。
     上游调用用**逐行 `GetAsset`**：`ListAssets` 的按组批量需 `Filter.GroupType`，而本表无 `kind`、`material_groups` 的真人组镜像又尚未实现，批量路径走不通。
     **跟进侧失败一律不写库**：网络失败、非 2xx、信封缺 `Result`/`Status` 都按「本轮未知」处理，状态保持 `Processing` 等下轮——不把一次坏响应固化成终态。认不出的 `Status` 值同样收敛成 `Processing`（既不误判为可用，也不误杀）。
   - **定时器按 `userId` 取用户 `sk-`**：素材接口是**用户凭证**的——网关 `blue-whale-api/router/api-router.go` 里
     `/api/material/*` 走 `TokenAuth`（用户 API key）、`/api/materials/*` 走 `UserAuth`（用户登录会话），**两条都要用户身份，网关不提供服务级查询入口**。
     定时器因此读**新表 `user_info`**（键 `user_id`）；该行在**登录成功时**写入
     （`auth.controller.ts` 的 `establishSession` 处，`result.userId` + `result.token` 已经拿在手上）。
     `user_info` 与遗留的 `users` **无任何关系**——它只存网关侧执行凭证，不存任何用户资料。
     **明文存储**，对齐既有先例 `backend/libs/shared/generation/credential.ts`（「修正四：去密封，明文存 `job.input.provider_credential`」）。
     ⚠️ **本节已被推翻（2026-09-29）**：`user_info` 整表退役，`createUserInfoRepo` 与 `model user_info` 一并删除，
     DROP 落在迁移 `20260929000000_drop_user_info`。定时兜底不再按 `userId` 取用户 `sk-`，改读 `system_settings`
     的 upstream 行（ADR-0114 决策 7）。依据见 ADR-0115 决策 1 与 ADR-0117 决策 4。
     **为什么是新表而不是给 `users` 加列**：`users` 是遗留表——其唯一写入点 `auth-repo.upsertUser` 只被 `loginWithCode` 调用，
     而 `loginWithCode` 在 0915 上**无任何调用方**（`backend/libs/shared/auth/` 只有 `handle-send-code.ts`，无 login-with-code 路由），
     `user-repo.findInfoById` 同样零调用方。且 `users.id` 与 `AuthenticatedUser.userId`（`establishSession` 取的是 `NewApiLoginResult.userId`）
     **是两个不同的 id 空间**，加列写不进值。
   - `CreateAsset` 2xx → upsert 一行，`status = 'Processing'`（此时上游必然如此），并记 `error_code`/`error_message`（有值才记）。挂在既有透传旁路上（对齐 `material.controller.ts:99-149` `applyLinkSideEffects`）。
   - 任何 `ListAssets` / `GetAsset` 2xx 响应经过 → 顺带镜像回写。**纯收益，不承担正确性**。
   - 生成拦截点实时查询后回写。

5. **删除同步清行。** `DeleteAsset` → 删对应行；`DeleteAssetGroup` → 按 `material_group_id` 批量删。**硬删不软删**——本表的行没有独立价值，它是素材的附属状态；软删会让「无记录 → 实时查」这条规则产生歧义。

6. **只说明「未通过」，不解释原因。** `error_code` / `error_message` 落库供内部归因，但不对用户展示，用户侧文案只说「素材未审核通过」。理由：**火山官方没有公开素材库的错误码枚举**——只有状态三值与「失败时返回 `error.code`/`error.message`」的笼统说明（明细挂在 Files API 而非素材库 Asset 上），因此本仓无从判断 `Failed` 究竟源于内容审核、URL 不可达还是物理约束超限。**存原文透传不是退而求其次，就是终态做法**。

   **唯一的例外是「终局 vs 可重试」这一层**——它不解释原因，只决定用户该不该重试，所以必须分。按上游错误码判（2026-09-15 真网关实测）：

   | 上游情形 | 实测错误码 | 本仓处理 | 用户文案 |
   | --- | --- | --- | --- |
   | 素材被删 / 从未存在 | `NotFound.asset_id` | 终局，收敛 `Failed` | 该素材未审核通过 |
   | 素材 id 格式非法 | `InvalidParameter.AssetID` | 终局，收敛 `Failed` | 该素材未审核通过 |
   | 鉴权失效 | 另一套信封（`{"error":{…}}`，无 `ResponseError`） | 本轮未知 | 素材状态校验失败，请稍后重试 |
   | 限流 / 租户未开通 / 5xx / 网络 | — | 本轮未知 | 素材状态校验失败，请稍后重试 |

   判据必须**窄到只认素材级的码**：如果把 4xx 一律当终局，一次账号级故障（sk- 失效、租户被停）会把该用户所有在途素材误标成 `Failed`，那比现在更糟。实现见 `material-compliance-gate.ts` 的 `isMaterialLevelRejection` 与 `NewApiMaterialClient.asMaterialRejection`。

   这一条是**真实联调逼出来的**：原先非 2xx 一律按「查不到」处理，用户对一张已被删除的素材会拿到「请稍后重试」，然后永远重试不成功、也永远得不到解释。

7. **拦截点：三条视频创建路径——创建期 + 重试期 + 场景卡再生成。** worker 提交期不重复校验——状态存在漂移窗口，上游届时本就会拒，在 worker 里加第二次查询只会增加复杂度且给不出更好的错误。

   **三条都必须接，缺一条就是洞。** 场景卡再生成（`POST /api/projects/:id/scene-cards/:sceneCardId/generate` → `regenerateSceneCard`）是初版漏掉的第三条：它同样产出 `source=scene_card` 的视频 job，冻结 input 同样带 `first_frame_asset_id` / `reference_asset_ids`，worker 执行时照转 `asset://`。漏掉它的后果与决策 3 想避免的完全同形——预设保存之后变成 `Failed` 的素材仍能从这里进生成。

   接线方式与重试期一致：`regenerateSceneCard` 收 `guardInput` 回调，**但位置比重试期更靠前——必须放在该函数那一组「前置检查」里（`flatReferences` 解析之后、任何写入之前）**。原因：这个事务在 `return` 时是正常提交的，而它「先 UPDATE preset 再建 job」；门若放在 preset 更新之后，一次被拒的再生成会把 preset 版本推进却不建任何 job，留下脏状态。重试期没有这个约束（那里建 job 之前没有别的写）。   **门只对 `video` 生效**。素材库绑定只有视频参考会消费（worker 在视频提交时把已绑本地 Asset 转成 `asset://<material_id>`；`AudioJobProcessor` 根本不看 material 绑定）。但音频的 `references` 也带 `asset_id`（`composeInput` 原样冻结），不按类型短路就会拿「不能用于视频生成」去拒一个音频任务——纯误伤。实现上由调用方把任务类型带进 `assertInputUsable`，非 video 直接返回放行、连本地 Asset 解析都不跑。

   重试期的门**必须落在「幂等重放命中之后、建新行之前」**（实现上由 `retryJob` 接收 `guardInput` 回调，在事务内该位置调用）。三个位置的取舍：
   - 提到事务外或调用方 → 拿不到「本次是不是重放」，会把**既有**的重试结果按此刻素材状态改写，破坏幂等；
   - 放到 create 前 → 只有真建新 job 时才查上游，幂等重放零额外往返、零改写。

   门拒绝时返回 `{ kind: "material_blocked", reason }`，handler 映射为 `400 + invalid_reference`（与创建期同款），**不建任何行**。

   实现参数：定时跟进间隔 `MATERIAL_STATUS_POLL_INTERVAL_MS`（默认 5000）、跟进窗口 `MATERIAL_STATUS_POLL_MAX_AGE_MINUTES`（默认 10）、首轮延迟 `MATERIAL_STATUS_POLL_INITIAL_DELAY_MS`（默认 0）、每轮批大小 100。命名与取值对齐既有 `GENERATION_RECOVERY_*` 一族（同样只走 `@Scheduled` 占位符，不写 `application.yml`）。

   两处配套约束，改动时别丢：
   - **`retryJob` 的交互事务须显式放宽超时**（`{ maxWait: 10_000, timeout: 30_000 }`，与 `createJob` 同口径）。门在事务内发 HTTP，Prisma 默认 5s 会把它掐成 P2028/500，而不是设计好的 400。
   - **`worker-java` 的调度线程池须 > 1**（`spring.task.scheduling.pool.size`）。两条 `@Scheduled` 共享 Spring Boot 默认的单线程时，跟进器一轮最多 100 次串行 `GetAsset`（单次 connect 10s / read 15s）能把唯一的调度线程占住几十分钟，`fixedDelay` 紧接着排下一轮 → `RecoveryService` 被饿死，表现为「不相干用户的卡死任务再也不被重投」。一个素材状态功能不该能拖垮作业恢复。

8. **查上游查到 `Failed` 就走三步，且 `GetAsset` 优先答本地。** 这是「失败」这条路上的收口，无论哪条路径发现的（透传镜像 / 生成拦截点 / worker 跟进器），都调同一个口子，不因发现路径不同而行为分叉：

   ① 本地状态行留 `Failed`（**不删**——留痕，且拦截点据此直接拒绝、不必再问上游）；
   ② 清空 `assets` 表的素材关联（`material_id` 与 `material_group_id` **一起清**，只清前者会留下悬空的组关联，前端仍能渲染「已入库」角标、生成链路仍会把它当素材库引用转 `asset://`）；
   ③ 删掉上游素材（死素材不留在人家库里）。

   ①② 同步做——紧接着的请求必须立刻看到一致状态。③ 在 **backend 侧刻意不 await**：它跑在请求路径上（重试路径更是在 Prisma 交互事务内），一次清理往返不该拖慢或拖挂一个正在被拒绝的请求；删不掉也无妨，本地已是 `Failed`，拦截点照样拒。**worker 侧是后台循环、没有请求要拖慢，所以同步做完**——差异是有意的。

   配套（**必须成对，拆开会自相矛盾**）：**本地已判 `Failed` 的素材，`GetAsset` 直接回本地结论，不打上游**。因为 ③ 已经把那张素材删了，再问上游只会拿到 `NotFound.asset_id`，前端看到的是「素材不存在」而不是「未通过」——一个既解释不通、又没法引导用户重传的答案。只短接 `Failed`：`Active` / `Processing` 仍透传上游，那两个状态以上游为准，本地行可能陈旧（只跟进创建后 10 分钟），拿本地答会答错。

   实测证据（2026-09-15，本地栈 + 真/桩网关）：backend 生成门路径 → 本地行 `Failed`、`assets` 关联两列清空、桩收到 `DeleteAsset`；worker-java 跟进器路径 → 日志依次打出「收敛 Failed」「已清 1 条本地资产关联」「已清理上游失败素材」，DB 同步可见；`GetAsset` 对本地 `Failed` 素材 **零上游请求**（桩日志无记录）。

## 已知缺口（本期不修，单独跟进）

1. **步骤②（清关联）会让「被拒」变成「下次能过」——按设计如此，但值得写明白。** 清空 `assets.material_id` 后，同一张本地 Asset 再进生成时不再被识别为素材库引用（门的规则是「没有 `material_id` → 放行」），worker 也退回本地 url。也就是说：**判定失败的素材不会再被这道门拦，而是以「普通本地素材」的身份继续可用。**
   这是「清关联」这个要求的直接推论，不是实现偏差；若要连本地 url 也拒，得给 `assets` 加一个独立的封禁标记（另一件事）。PRD 的成功指标口径（「未通过素材成为视频生成参考的次数 = 0」）在这一条上要按「素材库引用」而非「本地素材」解释。

## 被否方案

- **不加表，拦截点每次实时并行查上游 `GetAsset`。** 可行性成立（≤14 个引用并行约 300ms），但每次生成都打上游，且 `Error.Code`/`Error.Message` 原文无处留存。
- **表作纯缓存，拦截点一律实时查上游。** 能绕开「之后会不会有请求」的依赖，但表就只剩归因价值，等于白建。
- **在 `assets` 表加 `material_status` 列。** 否决：素材库素材是**账号维度**外部目录，本地 `Asset` 是**项目维度**（ADR-0077 影响节原文），把账号维度事实塞进项目维度表是层次错位；且**素材可以完全没有本地 `Asset`**——`SourceAssetId` 是绑定唯一入口，漏传则不绑定（`docs/api/2026-09-07-material-association-api.md:207`），此时加列无处可挂。
- **在 `CreateAsset` 请求内同步轮询到终态再返回。** 否决：破坏素材库「透传镜像」契约（`docs/api/material-library.md:5` 明写勿套用常规信封），且把接口变成阻塞几十秒到几分钟，前端/网关/LB 三层都可能超时；前端本来就要自己轮询。
- **给 `users` 表加 `provider_credential` 列。** 否决：该表无写入路径（见影响节），且 `users.id` 与 `AuthenticatedUser.userId` 不是同一 id 空间，列永远填不上值。
- **定时器从 Redis 会话读 `sk-`。** 否决：后台定时任务依赖用户**浏览器登录会话**是主客颠倒——系统的状态收敛不该取决于「用户此刻在不在线」。会话有 7 天 TTL、登出即吊销，会让定时器随用户上下线断续工作。
- **定时器放 TS 的 `generation-worker`。** 否决：该进程已随 ADR-0084 迁移退役，0915 上 `backend/apps/` 只剩 `blue-whale`。
- **投 MQ 异步补齐状态。** 否决：轮询是周期性、无界的跟进，MQ 是一次性投递，表达不了「每 5 秒看一遍所有在途素材」。
- **把状态收敛只交给前端轮询经过后端时的镜像。** 否决：正确性不能建立在「之后会有人发请求」上。

## 影响

- `CONTEXT.md` 的「素材状态」「素材库」「素材引用」三条修订：**「本地不镜像状态」正式作废**。「合规校验」「素材校验状态」两条新增为术语。
- **显式假设（未验证）：`Active` 是终态，上游判定后不会再漂回 `Failed`。** 本次设计的三分支规则依赖它。本仓与网关仓均无证据支持或反对。本 ADR 落定后据此设计，将来若出现 `Active` 漂移，第一处该复查的就是本条。
- **前端需配合改动（远小于初稿判断）**：前端**已经**做到「轮询到 `Active` 才置 `compliancePassed`」（IKFVMQ，见上文勘误），不需要再加轮询。真正剩下的是**处理生成侧新出现的 400**：用户在素材通过后又把它用在一张已 `Failed` 的原卡上重试、或素材状态漂移时，创建/重试会返回 `400 + invalid_reference`，需按 `msg` 分流提示（「未审核通过」引导重走校验 / 「校验失败请稍后重试」给重试按钮）。对接细节见 `docs/api/material-library.md` **v2**（§3.1 / §3.3 / §5.1 / §5.2 / §7 / §8 / §9）。
- **`assets.material_id` 的唯一索引 `uq_asset_material_id` 维持不动。** 经核查它在当前全部流程下都是正确的：右键合规校验命中已有 `materialId` 时跳过上传（`CanvasPage/index.tsx:3291`），同类文件走本地 Asset 的 md5 去重落到同一 asset 行，重复上传素材库得到的是不同 `material_id` 且关联为覆盖写。素材↔本地 Asset 确为 1:1，不是缺陷。将来若要「跨项目复用同一素材」才需要动它。
- **存量数据不回填**：已写 `assets.material_id` 但本表无记录的素材，按「无记录 → 实时查上游」处理，行为等价于放行且更准确。
- **定时器依赖用户 `sk-`，且 `sk-` 会轮换。** 网关不提供服务级素材查询入口，定时器只能按 `userId` 取用户凭证。ADR-0062 item 10 保留轮换语义（「凭证泄露后的轮换属于独立管理员安全操作」）；轮换后列内旧值失效 → 定时器对该用户吃 401 → 停止跟进，直到该用户下次登录刷新。**这与 ADR-0062 item 11 既有的退化口径一致**（「管理员轮换导致旧任务凭证失效时任务明确失败并由 User 重新提交」），不是新增故障模式。
- **明文存 `sk-` 不是本次新增的暴露面。** 本仓已在 `generation_jobs.input.provider_credential` 明文存同一凭证（`credential.ts` 修正四）。本次只是把同一做法复制到新表。**若将来要收紧密封，两处必须一起改**，只改一处不构成实际收敛。
- **`users` 表已是遗留物（本次不清理）。** 0915 上它无写入路径、唯一读路径 `findInfoById` 也零调用方；蓝鲸的用户身份完全由 new-api 持有（`establishSession` 取 `NewApiLoginResult.userId`）。**建议另立工单清理 `users` / `verification_codes` / `auth-repo.upsertUser` / `user-repo` 及其死代码**，本次不动以免扩大改动面。
- **多副本部署下的定时器**：`@Interval` 在 N 个副本上会各跑一份 → 上游调用放大 N 倍。`worker-java` 若为多副本，需加分布式租约（对齐 `GenerationJob` 的 `LockedBy`/`LockedUntil` 租约模式）。**部署副本数需在动工前确认。**
- **受阻于外部确认（动工前需问掉）**：上游是否支持素材注册完成的通知/回调。网关 ADR-0005 写「无平台回调确认」是**网关自己的设计决策**，不等于上游不支持。若为「支持」，本 ADR 的镜像与定时机制需重评。
