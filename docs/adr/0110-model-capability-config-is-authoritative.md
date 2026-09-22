# 模型能力只认配置：能力行在场时任何写死的值都不得生效

**状态**：accepted（2026-09-21，IKHBDO）

规则一句话：**有配置，就读配置；没有配置才读默认值；配置永远第一。**

模型能力与逐模型限制的唯一事实源是 `generation_model_capability` 表（运营在管理后台配置）。程序里不许出现「哪个模型支持什么」；不许为「运营可能配错」加防御/兼容代码；不要求主动加配置字段。

**可判定的形态**：对每一个写死的值问一句：**配置在场时，这个值还会不会生效？** 会 → 就是 bug；只在没配置时生效 → 合法的默认值。

[ADR-0086](0086-model-capability-reference-limits-configurable.md) 把「参考素材分类上限」搬进了能力行；本 ADR 不再重复那条决定，而是把它背后的**通则**写死，并加上一条会红的强制机制——因为同一通则此前在四处独立副本里被违反，每一处都由不同的事故才发现。

## 动因

四处**独立**的违规副本，没有一处是另一处的简单复制粘贴，所以改一处不等于改完：

1. **画布层**（`web/src/pages/CanvasPage/videoMediaRefs.ts`）：`supportsVideoReferenceModel` 按模型名前缀 `seedance-2` / `doubao-seedance-2-0` 判定「是否接受视频素材参考」。前缀特判对 Seedance 2.5 与 2.0 **恰好判反**：2.5 的能力行是 `video_reference=true` 却被误拦，2.0 是 `false` 却被误放，2.5 携带视频/音频参考的草稿在客户端无法提交。现该特判已删除，画布改按**草稿卡绑定模型**（`draftModelId`）的能力行取值（`web/src/pages/CanvasPage/modelCaps.ts`）。
2. **worker 层**（`worker-java/src/main/java/com/bluewhale/worker/application/processor/VideoJobProcessor.java`）：同一道门控 `isSeedance2Model(SEEDANCE2_PATTERN)`，**逐字移植**自已退役的 node worker。与能力行数据相反——给 2.0 放行、把 2.5 拒掉（抛 `unsupported_input`），而 2.5 正是默认选中模型，线上用户真实命中。现该分支已删除，回归钉在 `VideoJobProcessorTest`「IKHBDO 回归：带参考视频的 job 不再按模型名前缀放行」。
3. **TS runtime 层**（`backend/libs/shared/generation-runtime/video-reference-validation.ts`）：同一道门控的 TS 孪生副本。这个文件**今天仍在产**，由 `backend/libs/shared/canvas/canvas.service.ts:281` 与 `backend/libs/shared/generation/prompt-plan-snapshot.ts:107` 调用；它内部那半段模型名特判已删除，改成只读能力位（`video_reference` / `audio_reference`），所以「删副本」必须逐个文件确认，不能按目录猜。
4. **接纳层**（`backend/libs/shared/generation/handle-create-generation-job.ts`）：一张 `VIDEO_MODEL_ALIASES = { "seedance-2": "doubao-seedance-2-0-260128" }` 的旧前端兼容表，在**白名单查询之前**改写 `model_id`。按「配置永远第一」，这是个反例：运营若真配一行 `model_id` 就叫 `seedance-2`，请求会先被改写成 2.0 那行，那一行永远赢不了。现 `resolveModelId` 原样取用，回归钉在「旧别名 seedance-2 不在启用目录 → 400 model_unavailable（不再被改写成 2.0 那行）」。

同一类的其他事故，也全部已修：

- `handle-create-generation-job.ts` 的裸 `12` 出现在**拿不到能力行的预检**里（`videoReferenceLimitError` 的 `features` 缺省分支与 `validateVideo` 的预检形态）：预检跑在白名单解析前，写死一个上限就会先于配置生效——对 Seedance 2.5（`max_reference_images=30`）意味着第 13 张参考被永久卡死。现在预检**不判任何参考数量**，数量只由带 capability 的重跑用 `checkReferenceLimits` 判定。
- `backend/libs/contracts/scene-card-generation.ts` 的第三处裸 `12`（zod schema，契约层同样拿不到能力行）。契约层现在不判数量，判定下沉到 `scene-card-generation-repo.checkReferenceCountLimits`（与接纳侧同一份 `checkReferenceLimits`）。
- worker 与 TS runtime 各自写死 9 图 / 3 视频 / 15 秒（现值见下节 `LEGACY_*`）。
- `backend/libs/shared/persistence/scene-card-generation-repo.ts` 手工拼 video job 的 `input`，却**没有冻结 `reference_limits`**——于是**新** job 也走 worker 的迁移兜底 9/3/15，配了 `video_reference_max=5` 的模型第 4 条参考视频会被拒。
- 最破坏数据的一处：`parseModelUpdateBody` 只从请求体推 `channel_parser`，而后台是 **diff 提交**（没改过的字段不在请求体里）。解析器推不出来 ⇒ 整段映射校验被跳过 ⇒ 保存一行 Seedream 会静默清掉它的 `request_mapping` 矩阵，GPT 行可以持久化一张空表。解析器必须回落到**库中那一行**（`backend/libs/shared/model-capability/constants.ts` 的 `parseParserAndMapping`）。

**命名陷阱（已知坑，改名见 IKHEXG）**：`max_reference_images`（图/视频生成的**图**参考上限，缺省 10）与 `image_reference_max`（音频生成的**图**参考上限，缺省 1）名字几乎一样、语义不同，导致一张 P0 工单条目被三次误判。读这两个字段前先看它属于哪个 `capability_type`。

## Considered Options

- **只靠 code review 与注释约定**：通则在会话里说过很多遍、注释也写了，四个副本还是各自长了出来——因为违反它不会触发任何失败。没有会红的检查，约定只是期望，否决（故有 Decision 5）。
- **为「运营可能配错」加防御/兼容代码**：一旦程序替运营兜底，「配错了会怎样」就再也没人验证，能力行退化成建议值；且防御分支自己会成为下一个漂移副本。运营配错由**写侧闸门**（`featuresFieldErr` 拒绝脏类型）+ 后台表单负责，不由运行时兜底，否决。
- **给能力行加一层服务端二级白名单/映射表**：等于在配置之上再造一个「程序说了算」的层，与通则直接冲突，否决。
- **把能力行整体冻结进每个 job 快照、运行时只读快照**：方向正确但只解决了执行期（见 Decision 3），接纳期仍需直接读当前能力行；全量冻结会让配置改动的生效语义整体延后。本 ADR 只冻结**执行期需要而运行时又看不到配置行**的那部分，否决全量。

## Decisions

1. **能力行是唯一事实源。** 具体禁止以下形态（全部是上面事故的命名归纳）：
   - **模型名门控**：按 `model_id` 前缀/子串推断「支持什么」（`seedance-2` 系一律禁止）。
   - **跨层重复的限制常量**：同一个上限在契约层、接纳层、worker 层各写一份。
   - **按旧名改写 id 或归一化**：在配置查找**之前**改写 `model_id`，让某个配置行永远赢不了。
   - **任何「配置在场也照样生效」的写死值**：包括拿不到配置时的预检里的魔数。
   - **为可能的运营误配写防御分支**：不写。
2. **缺省值命名与语义**（`backend/libs/shared/persistence/model-capability-repo.ts` 与 `generation-runtime/video-reference-validation.ts`）：
   - `DEFAULT_*` = **无配置可读时的缺省**，不是「配置的兜底」。该字段本来就没有配置字段（如单视频 200 MB、单边 300–6000、最短 2 秒 `DEFAULT_MIN_REFERENCE_VIDEO_SECONDS` 这类素材平台物理约束），所以无条件生效——这是设计如此。有配置字段的走 `?? DEFAULT_*`：`DEFAULT_MAX_REFERENCE_IMAGES`(10) / `DEFAULT_VIDEO_REFERENCE_MAX`(3) / `DEFAULT_AUDIO_REFERENCE_MAX`(3) / `DEFAULT_IMAGE_REFERENCE_MAX`(1)，命名与 Java 镜像常量一致。
   - `LEGACY_*` = **只服务于迁移**：`VideoJobProcessor` 的 `LEGACY_MAX_REFERENCE_IMAGES`(9) / `LEGACY_MAX_REFERENCE_VIDEOS`(3) / `LEGACY_MAX_REFERENCE_VIDEO_SECONDS`(15)，以及由它们拼出的 `LEGACY_REFERENCE_LIMITS`。它们**只在快照里根本没有 `reference_limits` 时可达**（上线前创建、仍在飞的旧 job），**不是**事实源、不得被新代码作为默认值引用。规则：新 job 一律带冻结快照，`LEGACY_*` 的命中次数应随在飞 job 排空而趋于零。
   - `task_types[*].allowed_durations` 是另一种形态的历史残留（已退役、读侧分支暂留未删），**不要再往数据里配**，见 ADR-0086 修订段。
3. **跨进程：接纳侧冻结，运行时只读快照。** 运行层（worker）看不到能力行，也**不得**含任何模型知识。接纳侧（`handle-create-generation-job` 的 `videoStrategy.composeInput`、`scene-card-generation-repo`）把执行期要用到的值**冻结进 `job.input.reference_limits`**（`freezeReferenceLimits`，只拷读得到的字段，读不到的宁可不写）。worker 只按 `input.reference_limits` 判定，本文件里不再出现「哪个模型支持什么」。口径先例是更早的 `generate_audio`：能力位 `features.audio` 为 true 时才把用户选择冻结进 `input.generate_audio`，worker 据此下发。
   - 快照的字段集是**有意收窄**的：只冻结 worker 判定要用的上限（`max_reference_images` / `video_reference_max` / `audio_reference_max` / `max_reference_duration_sec`）。**支持位**（`video_reference` / `audio_reference`）不入快照——接纳侧已是唯一闸门，worker 再判一遍只会多一份会漂移的副本。
   - 冻结值必须经 `toFeatures` 归一后再拷（`scene-card-generation-repo` 的 `capability.features` 是**库中原始 JSON**，历史行可能是 camelCase）；少了这一步，camelCase 行冻结不出任何字段，worker 回落 `LEGACY_*`，配置再次输给写死的缺省。
4. **部署顺序。** 新增一个冻结字段是双向兼容的：老 worker 忽略未知字段，新 worker 在字段缺失时回落 `LEGACY_*`。但**worker 应先于或同时于 backend 上线**——反过来的话，backend 已按（可能已调高的）配置放行，旧 worker 仍按 `LEGACY_*` 判定，会出现「接纳侧收下、执行期被拒」。
5. **强制执行：能力行字段裁决表测试。** 规则本身靠 code review，但「新增能力字段」必须被机械拦住：`toFeatures` 恒返回全字段对象，因此 `Object.keys(toFeatures({}))` 就是当前已知的全部能力字段集；测试断言这个集合与一张**逐字段裁决表**精确相等。新增字段而没留下裁决（消费方 / 缺省值 / 证明配置赢的测试 / 是否根本不驱动行为）→ 红。表本体与逐行内容见 `backend/libs/shared/persistence/model-capability-field-rulings.test.ts` 的 `RULINGS`（表在测试里而不是在文档里，改字段与改表必须同一次提交）。

## Consequences

- 强制机制落在 `backend/libs/shared/persistence/model-capability-field-rulings.test.ts`：五条断言分别管「新字段没裁决 → 红」「表里留了已删字段 → 红」「裁决指向的测试文件不存在 → 红」「缺证明又没登记缺口 → 红」「归一器之外的字段清单与 `toFeatures` 产出重叠 → 红」。表里 `configWinsTest: null` 的行是**显式登记的缺口**（配 `gapReason`），不是省略；`inert` 行则写明它为何不驱动行为（当前是 `watermark` / `stream` / `tools` / `sequential_image_generation` 四个只做目录透出的键，以及 `image_protocol` 这个不走 `toFeatures`、只被 worker 直接读的键）。
- 新增模型只要在后台配能力行即生效，前端 / 服务端 / worker 无需改码；反之，任何「改代码才能支持新模型」的改动都应先问是不是少了配置字段。
- 排查「配了不生效」类问题的固定顺序：①该值是不是在拿不到能力行的预检里写死了（Decision 1 最后一类）；②有没有在配置查找前被改写/归一（第 3 类）；③worker 读没读到冻结快照（`input.reference_limits` 是否被拼 `input` 的那段漏掉）。
- 本 ADR 只登记规则与机制，不新增任何配置字段、兼容层或防御分支。执行期物理约束（字节/像素/比例/时长下限）继续是无配置字段的 `DEFAULT_*`，不因本 ADR 变成可配项。
