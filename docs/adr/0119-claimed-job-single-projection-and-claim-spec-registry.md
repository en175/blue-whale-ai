# worker 领取：ClaimedJob 收敛为单一投影，领取差异收进 ClaimSpec 数据注册表，解散家族级转发门面

worker-java 的领取组装层按家族复制：`JobClaimService` 986 行里 18 个 claim 方法体同构、15 个 `Claimed*JobDto` record 字段同形、14 份 `*_LEASE_SECONDS = 420` 常量带近同 javadoc；`JobStateMachineService` 另有 27 个 publish/fail 家族级纯转发方法（段头自述「直通」，方法体为 `return x.y(input)`）。决定（2026-09-28 grilling 十节点拍板，基线 `release/2026.09.29`，工单 IKIWP8）：**ClaimedJob 收敛为一条 record，领取的全部差异收进 `ClaimSpec` 值对象，`JobClaimService` 收敛为对具体家族零知识的策略执行器，并解散转发到服务的家族级门面**。这是让代码向 `CONTEXT.md` 已有的领域定义靠拢，不是改定义。

## 决策

**ClaimedJob 只有一条 record，不按形态分叉**。`CONTEXT.md` 已定义它是「公共核心 + 按媒体类型的 payload 扩展」的单一概念，并明写 `_Avoid_: 按媒体类型把领取投影当独立概念各修一套`；现存 15 个 DTO 就是该 `_Avoid_` 的状态。薄型（同步工具，6 字段）是富型的真子集，合并后不适用的字段留 `null` / `0` / `false`。字段分布实测是**正交特征表而非层次**：「轮询」与「生成」不互斥（`ClaimedVideoJobDto` 两者皆是），「取消」跨三类形态（轮询工具 `video_frame_interpolation`、生成型 image/audio/video）——单继承的树表达不了。判断「这个字段对我无意义」的责任交给写处理器的作者，他是唯一知道自己家族形态的人。

**`ClaimSpec` 是值对象，携带方法引用，不携带家族名**。字段为 type、`IntSupplier` 租约秒、候选查询引用、CAS 引用。租约必须是 `IntSupplier` 而非 `int`——image 租约可被 `IMAGE_JOB_LEASE_SECONDS` env 覆盖，不为此砍路径。**spec 在各处理器里构造**，不放 `domain/contract/*Contract`：`domain/` 层全仓零 `infrastructure/` 依赖，且方法引用是实例级的，静态常量根本承载不了。处理器因此新增 `GenerationJobMapper` 依赖，去掉对 `JobStateMachineService` 的领取依赖。

**「不套 source 白名单」由类型表达，不再靠纪律**。4 个 type-only 专属候选查询的 SQL 逐字同形（仅 type 字面量不同），合并为 `findCandidateByTypeOnly`；`findVideoCandidate` 的「专属」实为硬编码 source 白名单，参数化查询本就能表达，退役。收敛后候选查询只剩 2 种形态，IKHPK9 那个「传空列表 → MyBatis 渲染出 `source IN AND is_delete` 坏 SQL → 任务永久卡 queued」的坑在类型上不再可能存在。

**门面解散的边界是「转发目标」，不是「家族」**。转发给服务（`JobClaimService` / `JobFinalizer`）的 42 个全部解散（claim 15 + publish/fail 27），处理器直呼目标；转发给 mapper 的 cancel / renew / progress 保留——后者是 application 层对 infrastructure 的合理封装，散到处理器才是漏层。只解散 claim 那 15 个会留下「一半直连、一半走门面」的中间态，而中间态会被下一个家族照抄，正是 18 份复制当初的成因。（`JobClaimService` 原有的 18 个 claim 方法里，3 个第 1 类生成型 by-id 归 Q5 的第二步，不在本次解散范围。）

**生成族（image / audio / video by-id）纳入同一概念，实施排第二步**。先收敛工具族 15 个（薄·免费工具 4 = image_enhance / image_erase / image_cutout / image_outpaint；富·轮询 11 = media_extract / audio_mix / audio_video_mux / audio_trim / audio_speed / video_subtitle_erase / video_enhance / vocal_split / video_scene_split / video_matting / video_frame_interpolation），管道成熟后再接生成族——生成族跑的是 `ImageJobProcessor` 核心生成路径（`retry_count` 驱动的瞬态重试、`providerTaskId == null` 的分相判据），风险隔离。但**设计时以它为抽象验收样本**：管道若接不住生成族，说明抽象抽错了。

## Considered Options

- **枚举 + 服务内 switch**（`ClaimSpec` 用枚举描述候选查询种类与 CAS 种类）：服务不再 import 家族 Contract，但家族知识以枚举形式留在服务里，且新增家族要动 switch。枚举是「数据」的假象——一旦要 switch 处理，它就不是数据。否决。
- **`ClaimSpec` 放 `domain/contract/*Contract`**：保住了「家族契约集中一处」，但会让 `domain/` 层出现第一条 `infrastructure/` 依赖（全仓零先例），且静态常量无法持有实例方法引用——技术上也行不通。否决。
- **两条 record（薄 / 富）**：字面满足工单原验收标准「不超过 2 种形态」，且免去宽 record 里恒空字段。但薄 / 富的分界线（有没有上游轮询）是实现细节、会随上游能力演化被跨越，固化它等于把偶然差异升成概念——正是 `CONTEXT.md` 的 `_Avoid_`。否决。
- **sealed interface + 按族或按形态切变体实现**：按族切 = 15 个变体（现状换个名字，复制一个没消）；按形态切 = 上面那张正交特征表逼出中间类爆炸。否决。
- **只解散 claim 那 15 个门面方法**：其余 27 个 publish/fail 转发留着。留下中间态，且下一个家族作者看到「claim 直连、publish 走门面」最省事的做法是照写。否决。
- **拆多个 PR 顺序合入**：中间态会进批次分支；且每个 PR 都要独立跑全量验证，成本不比一次跑省。改为一次 PR、三个 commit（mapper 收敛 → 管道 + DTO → 门面解散），review 一样能分段读。否决。
- **只改签名让既有测试编过、不重构测试面**：`JobStateMachineServiceGoldenMirrorTest` 里 per-family claim 用例（`claimMediaExtract: no candidate → empty` 等）本身与被收敛的生产代码同构地复制，不动等于把复制留在测试里。否决。

## Consequences

- 新增媒体家族的触点变成「新建 Contract + 处理器 + 消费者三个文件」，共享文件零改动；`ClaimSpec` 与 `JobTypeEnum` 趋于一一对应，「新增生成类型 = 注册一套」从一个枚举 + 一处生命周期，收敛到一处表达。
- **数据注册表有类型系统抓不到的盲区**：spec 若把 `candidateLookup` 指向错家族的 mapper 方法，两者都返回 `GenerationJobEntity`，编译期不报错，管道会「正确地产出错的结果」。唯一防线是**spec 排他对口测试**——插一条 `type=X` 的 job 喂给全部 spec，断言只有对应那个能领到（DB 里的 type 是外部事实，不由 spec 自述）。
- 处理器从依赖整个 `JobStateMachineService`（640 行、含续租与取消）变成依赖 `JobClaimService` + `JobFinalizer` + `JobStateMachineService` 三者中它真正需要的。`JobStateMachineService` 只剩取消路由、续租、进度更新与租约常量，回到名副其实。
- `audio_speed`（IKHW5A）的收割缺口随之关闭：它是 9 个轮询族里唯一未实现 `ParentReuseClaim`、处理器无 `tryReuseParentResult` 的，而重试创建不做 type 门控（`generation-command-repo.ts` 复制 `original.type`），被重试的 audio_speed 会重新提交上游、重复消耗上游费用——与 [ADR-0114](0114-mediakit-parent-reuse-harvest.md) 的动机直接冲突。
- Java 侧键名统一为 camelCase 后，与 TS 镜像的「逐字一致」降级为「字段级对应」。这条纪律此前只靠 javadoc 维系——15 个 DTO 无 JSON 序列化点、无跨语言字段名 parity 门禁，且 TS 侧 `claim-ops.ts` 自身就有两套键（`project_id` 与 `projectId` 并存）。`ClaimedMediaExtractJobDto` 为首批上线攒下的 4 个重载构造器一并退役。
- 与 IKIWP7（轮询骨架收敛）同触 worker 应用层，串行：本决策实施合入后 IKIWP7 才开工。
- 编号说明：本 ADR 落于 master，而 0113–0118 当时只存在于 `release/2026.09.29` 批次分支上，故 master 上呈现 0112 → 0119 的临时断号，批次合入后补齐。
