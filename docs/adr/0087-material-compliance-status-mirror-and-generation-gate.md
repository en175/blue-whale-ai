# 素材校验状态本地落表，并在生成采纳处校验

- **状态**：Accepted
- **日期**：2026-09-15
- **决策者**：项目团队（经 `grill-with-docs` 会话确认）
- **关联工单**：`IKFYHJ`（本单，挂技术维护母工单 `IKAZIG`）；需求来源 `IKDE6X`（人像库去分组与上传智能校验，PRD v1.4 待评审）、`IKDGLE`（画布右键操作梳理）、`IKDRFQ`（右键合规校验与角色库入库，前端已 closed）
- **部分推翻**：[ADR-0077](0077-material-library-passthrough-zero-local-state.md) 决策 1「零本地表、不镜像状态」及被否方案「本地映射表」

## 背景

产品的「**合规校验**」在实现上就是**把素材上传进素材库**（虚拟人像库 AIGC 组）：`CreateAsset` 成功后上游异步注册，素材状态 `Processing → Active | Failed`，注册结果即校验结果。PRD 的成功指标是「未通过素材成为视频生成参考的次数 = 0」。

现状有三处缺口，且都不是疏漏而是文档化的设计意图：

1. **后端对状态零感知**。`backend/libs/shared/material/**`、`generation/**`、`packages/core/src` 全仓 grep `Active|Processing|Failed` 零命中。`handle-create-generation-job.ts:872` 原文：「仅本地 Asset 引用需要查存在性；素材库引用（asset:// 载体）由上游强校验，格式已在前置校验。」
2. **前端拿「上传成功」当「校验通过」**。`web/src/pages/CanvasPage/characterLibraryDeposit.ts` 只调一次 `CreateAsset` 并取其 `Id` 作为 `materialId`；`CanvasPage/index.tsx:3280-3330` 在拿到 `Id` 的同一刻 toast「校验通过，可用于seedance2.0视频生成」并置 `compliancePassed: true`。**没有轮询、没有等 `Active`**——而 `CreateAsset` 返回时素材还是 `Processing`，校验结果尚不存在。
3. **两条绕过路径**：重试路径 `generation-command-repo.ts:509` 逐字拷贝原 `input`，无任何重校验；本地 `Asset` 已绑 `material_id` 时由 worker 自动转 `asset://<id>`（`video-job-runner.ts:687-752`），前端物理上无从拦截。

ADR-0077 当时明确否决过「创建生成任务时同步调 `GetAsset` 预检」（理由：预检通过≠执行时仍有效）。本次决策**不与之矛盾**：那条否决的是「用预检**替代**上游强校验」，本次要的是「用前置校验**拒绝**已知不可用的输入」——拦截非法输入与信任上游是两件事。

## 决策

1. **新建 `material_asset_status` 表镜像素材校验状态**（推翻 ADR-0077 决策 1）。
   表按 `material_id` 唯一，含 `user_id`、`material_group_id`、`status`、`error_code`、`error_message`、`status_checked_at` 与既有生命周期列。**不落 `asset_type`**——类型随请求携带（见 `CONTEXT.md` 素材引用），落库会造出第二个真相源。

2. **该表是判据，不是缓存。** 生成任务创建期与重试期按它判定素材能否用作视频生成参考：

   | 表内状态 | 处理 |
   | --- | --- |
   | `Active` | **放行** |
   | `Processing` | **实时查上游 `GetAsset`**，用返回值判定并回写 |
   | `Failed` 及其他 | **报错拒绝** |
   | 无记录 | **实时查上游**，用返回值判定并回写 |
   | 压根没有 `material_id` | 放行（从未入过素材库，不在校验范围） |

3. **只放行 `Active`**（Active-only）。这**与 PRD `IKDE6X` §11.2 OD-D1 的推荐项相反**（OD-D1 推荐「校验中不限制，未通过后拦截」），是技术侧的直接取舍，不另找产品确认：上游只在素材就绪后接受它，放行 `Processing` 的后果是「生成任务必然失败」而非「风险素材进了生成」，所以这是 UX 取舍而非安全取舍——让用户等几秒，好过点了生成再白跑一次。**本条是对 PRD 待评审开放决策的单方面落定，验收时若被按 OD-D1 质疑，以本 ADR 为准说明取舍。**

4. **写入与更新四处**：
   - **定时兜底（主机制）**：在 `worker-java` 每 5 秒扫描 `material_asset_status` 中 `Processing` 且**创建未满 10 分钟**的行，
     逐行调 `GetAsset` 跟进到终态；超 10 分钟未收敛的**停止跟进，状态保持 `Processing` 不变**（不引入第四态，展示层本就以上游响应为准）。
     它不依赖任何外部流量——「用户点完校验就刷新页面、之后没有请求」是常态而非边角，状态的收敛不能建立在「之后会有人发请求」上。
     放 Java 侧的理由：`worker-java` 已是唯一的后台执行面（TS `generation-worker` 已退役，迁移契约 §7「recovery/asset-GC 留 TS 进程」随之失效），
     `worker-java/.../application/service/RecoveryService.java` 是同类 cron 的现成先例。
     上游调用用**逐行 `GetAsset`**：`ListAssets` 的按组批量需 `Filter.GroupType`，而本表无 `kind`、`material_groups` 的真人组镜像又尚未实现，批量路径走不通。
   - **定时器按 `userId` 取用户 `sk-`**：素材接口是**用户凭证**的——网关 `blue-whale-api/router/api-router.go` 里
     `/api/material/*` 走 `TokenAuth`（用户 API key）、`/api/materials/*` 走 `UserAuth`（用户登录会话），**两条都要用户身份，网关不提供服务级查询入口**。
     定时器因此读**新表 `user_info`**（键 `user_id`）；该行在**登录成功时**写入
     （`auth.controller.ts` 的 `establishSession` 处，`result.userId` + `result.token` 已经拿在手上）。
     `user_info` 与遗留的 `users` **无任何关系**——它只存网关侧执行凭证，不存任何用户资料。
     **明文存储**，对齐既有先例 `backend/libs/shared/generation/credential.ts`（「修正四：去密封，明文存 `job.input.provider_credential`」）。
     **为什么是新表而不是给 `users` 加列**：`users` 是遗留表——其唯一写入点 `auth-repo.upsertUser` 只被 `loginWithCode` 调用，
     而 `loginWithCode` 在 0915 上**无任何调用方**（`backend/libs/shared/auth/` 只有 `handle-send-code.ts`，无 login-with-code 路由），
     `user-repo.findInfoById` 同样零调用方。且 `users.id` 与 `AuthenticatedUser.userId`（`establishSession` 取的是 `NewApiLoginResult.userId`）
     **是两个不同的 id 空间**，加列写不进值。
   - `CreateAsset` 2xx → upsert 一行，`status = 'Processing'`（此时上游必然如此），并记 `error_code`/`error_message`（有值才记）。挂在既有透传旁路上（对齐 `material.controller.ts:99-149` `applyLinkSideEffects`）。
   - 任何 `ListAssets` / `GetAsset` 2xx 响应经过 → 顺带镜像回写。**纯收益，不承担正确性**。
   - 生成拦截点实时查询后回写。

5. **删除同步清行。** `DeleteAsset` → 删对应行；`DeleteAssetGroup` → 按 `material_group_id` 批量删。**硬删不软删**——本表的行没有独立价值，它是素材的附属状态；软删会让「无记录 → 实时查」这条规则产生歧义。

6. **只说明「未通过」，不解释原因。** `error_code` / `error_message` 落库供内部归因，但不对用户展示，用户侧文案只说「素材未审核通过」。理由：**火山官方没有公开素材库的错误码枚举**——只有状态三值与「失败时返回 `error.code`/`error.message`」的笼统说明（明细挂在 Files API 而非素材库 Asset 上），因此本仓无从判断 `Failed` 究竟源于内容审核、URL 不可达还是物理约束超限。**存原文透传不是退而求其次，就是终态做法**。

7. **拦截点：创建期 + 重试期两处。** worker 提交期不重复校验——状态存在漂移窗口，上游届时本就会拒，在 worker 里加第二次查询只会增加复杂度且给不出更好的错误。

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
- **前端需配合改动**：现状「拿到 `Id` 即宣布校验通过」在 Active-only 下会变成「刚说通过、转头不让用」。**需独立前端工单**（**开发完成后再提，不阻塞后端开工**）：拿到 `Id` 后轮询到 `Active` 才置 `compliancePassed`。
- **`assets.material_id` 的唯一索引 `uq_asset_material_id` 维持不动。** 经核查它在当前全部流程下都是正确的：右键合规校验命中已有 `materialId` 时跳过上传（`CanvasPage/index.tsx:3291`），同类文件走本地 Asset 的 md5 去重落到同一 asset 行，重复上传素材库得到的是不同 `material_id` 且关联为覆盖写。素材↔本地 Asset 确为 1:1，不是缺陷。将来若要「跨项目复用同一素材」才需要动它。
- **存量数据不回填**：已写 `assets.material_id` 但本表无记录的素材，按「无记录 → 实时查上游」处理，行为等价于放行且更准确。
- **定时器依赖用户 `sk-`，且 `sk-` 会轮换。** 网关不提供服务级素材查询入口，定时器只能按 `userId` 取用户凭证。ADR-0062 item 10 保留轮换语义（「凭证泄露后的轮换属于独立管理员安全操作」）；轮换后列内旧值失效 → 定时器对该用户吃 401 → 停止跟进，直到该用户下次登录刷新。**这与 ADR-0062 item 11 既有的退化口径一致**（「管理员轮换导致旧任务凭证失效时任务明确失败并由 User 重新提交」），不是新增故障模式。
- **明文存 `sk-` 不是本次新增的暴露面。** 本仓已在 `generation_jobs.input.provider_credential` 明文存同一凭证（`credential.ts` 修正四）。本次只是把同一做法复制到新表。**若将来要收紧密封，两处必须一起改**，只改一处不构成实际收敛。
- **`users` 表已是遗留物（本次不清理）。** 0915 上它无写入路径、唯一读路径 `findInfoById` 也零调用方；蓝鲸的用户身份完全由 new-api 持有（`establishSession` 取 `NewApiLoginResult.userId`）。**建议另立工单清理 `users` / `verification_codes` / `auth-repo.upsertUser` / `user-repo` 及其死代码**，本次不动以免扩大改动面。
- **多副本部署下的定时器**：`@Interval` 在 N 个副本上会各跑一份 → 上游调用放大 N 倍。`worker-java` 若为多副本，需加分布式租约（对齐 `GenerationJob` 的 `LockedBy`/`LockedUntil` 租约模式）。**部署副本数需在动工前确认。**
- **受阻于外部确认（动工前需问掉）**：上游是否支持素材注册完成的通知/回调。网关 ADR-0005 写「无平台回调确认」是**网关自己的设计决策**，不等于上游不支持。若为「支持」，本 ADR 的镜像与定时机制需重评。
