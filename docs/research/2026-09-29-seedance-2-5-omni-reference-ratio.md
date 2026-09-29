# Seedance 2.5 全模态参考（omni reference）ratio 参数官方口径核验

> 核验日期：2026-09-29  
> 范围：火山方舟（Volcano Ark）Seedance 2.5（`doubao-seedance-2-5-260628`）在「全模态参考生视频」（官方现名，旧文档称「多模态参考」，本仓口径「全能参考 / omni reference」）及各任务类型下，`ratio` / `omni_reference_task_type` / `duration` 参数的官方取值与约束；并对照本仓能力目录配置（`backend/prisma/schema/002_seed.sql` 的 Seedance 2.5 行与 `backend/libs/contracts/capability-param-validation.ts` 的任务类型判定）评估一致性。  
> 来源边界：只使用火山引擎官方文档站一手页面（三个页面最近更新时间分别为 2026.09.22、2026.09.23→09.29、2026.09.18）。因文档站为 JS 渲染，正文经只读代理抓取官方 URL 获得，内容以官方页面为准；未发起付费生成请求。

## 结论

1. **Seedance 2.5 的 ratio 取值集合与本仓基础列表完全一致**：`16:9、4:3、1:1、3:4、9:16、21:9、adaptive` 共 7 个。官方三个页面（API 参考、教程、2.0 系列对比）口径统一。  
   来源：[创建视频生成任务 API—ratio 参数](https://www.volcengine.com/docs/82379/1520757)、[Doubao Seedance 2.5 教程—宽高比](https://www.volcengine.com/docs/ark/seedance-2-5)。
2. **官方没有 `default` 这个 `omni_reference_task_type` 取值**。参数取值为 `auto`（默认）/ `reference` / `edit` / `extend`，模型支持仅 Seedance 2.5。本仓任务类型枚举 `default` 对应官方的 `reference`（普通参考生视频）；若后续要向上游显式传该参数，映射必须是 `default → reference`、`prolong → extend`。  
   来源：[创建视频生成任务 API—omni_reference_task_type](https://www.volcengine.com/docs/82379/1520757)。
3. **普通全模态参考（reference，即本仓 default）可以指定 9:16 等固定比例**，官方三处明文：参数说明「设置 reference 时，ratio 或 duration 无特殊限制」；取值限制表「参考生视频：支持在可选宽高比中自行设置……支持 adaptive 或指定宽高比」；官方 50 素材示例同时传 `omni_reference_task_type: "reference"` + `ratio: "16:9"` + `duration: 15`。提示词指南「无锁定」章节也说明参考类任务「用户可以指定输出视频的宽高/时长属性」。本仓 default 放开全部 7 种比例与官方一致。  
   来源：[创建视频生成任务 API](https://www.volcengine.com/docs/82379/1520757)、[Seedance 2.5 教程—50 个全模态参考素材输入示例](https://www.volcengine.com/docs/ark/seedance-2-5)、[Seedance 2.5 提示词指南—任务使用说明](https://www.volcengine.com/docs/ark/seedance-2-5-prompt-guide)。
4. **首帧/首尾帧：官方明文「ratio 必须为 adaptive」，且是「默认且仅支持 adaptive，不可指定具体宽高比」**——输出宽高比严格对齐 `first_frame` 首帧图；尾帧与首帧画幅不一致时「尾帧会被拉伸」。本仓仅允许 adaptive 的配置一致。  
   来源：[Seedance 2.5 教程—任务类型与限制](https://www.volcengine.com/docs/ark/seedance-2-5)、[创建视频生成任务 API—不同模型的取值限制表](https://www.volcengine.com/docs/82379/1520757)、[提示词指南—首帧/首尾帧](https://www.volcengine.com/docs/ark/seedance-2-5-prompt-guide)。
5. **视频编辑（edit）：`ratio 必须为 adaptive`、`duration 必须为 -1`，二者都写在 API 文档 `omni_reference_task_type` 参数的 edit 取值说明下**（教程任务类型表同样写明）；且 edit 还要求「content 中必须至少包含一个 reference_video，且视频时长必须为 4–30 秒」。本仓 edit 仅允许 adaptive 一致。  
   来源：[创建视频生成任务 API—omni_reference_task_type](https://www.volcengine.com/docs/82379/1520757)、[Seedance 2.5 教程—任务类型与限制](https://www.volcengine.com/docs/ark/seedance-2-5)。
6. **视频延长（extend）：只锁比例不锁时长**——「设置 extend 时，content 中必须至少包含一个 reference_video；ratio 必须为 adaptive」，官方对 extend 的 duration 无 `-1` 要求（教程写 duration 支持配置为 [4, 30] 或 -1）。本仓 prolong 仅允许 adaptive 一致；但仓内能力目录未表达「prolong 的 duration 可自选、edit 的 duration 必须 -1」这一差异（见 §4）。  
   来源：[创建视频生成任务 API—omni_reference_task_type](https://www.volcengine.com/docs/82379/1520757)、[Seedance 2.5 教程—使用示例-视频延长](https://www.volcengine.com/docs/ark/seedance-2-5)。
7. **「不同模型的取值限制和 adaptive 适配规则」表核实为真**：视频编辑/视频延长一行，Seedance 2.0 系列 =「支持在可选宽高比中自行设置，或由模型根据待编辑视频或待延长视频在可选宽高比中自动选择（支持 adaptive 或指定宽高比）」，Seedance 2.5 =「自动保持输出视频宽高比和待编辑视频或待延长视频一致，不支持另行设置（默认且仅支持 adaptive）」。仓内注释「别把 2.5 的约束套推到 2.0」的依据成立。  
   来源：[创建视频生成任务 API—不同模型的取值限制和 adaptive 适配规则](https://www.volcengine.com/docs/82379/1520757)。
8. **关键词闭集核实为真**：编辑任务「提示词触发关键词，包含其一即可：编辑视频、增加/加上、删除/去掉、修改/替换/改成」；延长任务「包含其一即可：向前/向后延长、延续、续写」。与 `capability-param-validation.ts` 的 `EDIT_INTENT_KEYWORDS` / `PROLONG_INTENT_KEYWORDS` 逐字一致。  
   来源：[Seedance 2.5 提示词指南—任务使用说明](https://www.volcengine.com/docs/ark/seedance-2-5-prompt-guide)。
9. **多素材（图 + 视频混合）比例如何取舍，Seedance 2.5 当前官方文档没有明文规则**。adaptive 时参考生视频是「根据提示词选择可选宽高比中最合适的宽高比」（按提示词语义，不是按素材顺序）；编辑/延长在多个输入视频中「由模型根据提示词意图判定待编辑/待延长视频」。旧版 2.0 文档曾有「以传入的第一个媒体文件为准（优先性：视频＞图片）」的表述（2026-07-29 调研时页面存在），2026-09-22 更新后的当前版 API 文档已删除该句、改为按任务类型分列。此项对本仓无直接约束力，见 §4。

## 1. 调查问题

1. Seedance 2.5 全模态参考模式下 `ratio` 的完整取值集合是什么？是否接受显式宽高比（如 9:16、16:9）？
2. `omni_reference_task_type` 的官方语义：有哪些取值？各取值对 ratio 和 duration 的约束原文是什么？「必须为 adaptive / -1」写在哪个参数、哪个任务类型下？
3. 普通全模态参考（不带编辑/延长意图）在 Seedance 2.5 上能否指定固定比例？官方是否明确「default 任务可指定比例」？
4. 首帧/首尾帧任务在 Seedance 2.5 上的 ratio 约束原文是什么？
5. 「不同模型的取值限制和 adaptive 适配规则」表的完整内容？
6. adaptive 的官方定义：输出比例如何确定？多素材比例不一致时怎么办？
7. 多素材混合（视频 + 图片）参考时比例如何取舍？

## 2. 官方原文证据

### 2.1 来源清单

| 页面 | URL | 最近更新时间 |
| --- | --- | --- |
| 创建视频生成任务 API（82379 文档库；页面标题仍写「Seedance 2.0 API 参考官方文档」但正文已覆盖全系列并含 2.5 专属参数） | <https://www.volcengine.com/docs/82379/1520757> | 2026.09.22 18:00 |
| Doubao Seedance 2.5 教程（任务类型与限制、配置方法、宽高比/时长章节、50 素材示例） | <https://www.volcengine.com/docs/ark/seedance-2-5> | 2026.09.29 14:30 |
| Doubao Seedance 2.5 提示词指南（任务使用说明：有锁定/无锁定、关键词闭集） | <https://www.volcengine.com/docs/ark/seedance-2-5-prompt-guide> | 2026.09.18 18:42 |

引用说明：文档站页面为 JS 渲染，正文经只读代理对上述官方 URL 抓取全文；下引文字均为官方原文（去脚注与排版符号）。

### 2.2 `omni_reference_task_type` 参数（API 文档，标注 new，默认值 auto，模型支持：仅 Seedance 2.5）

> 「任务类型引导。Seedance 2.5 全模态参考生视频任务包括参考生视频、视频编辑和视频延长 3 类子任务。不同任务类型对参数有特殊限制，为减少任务创建后异步报错的情况，可通过本参数指定子任务类型，以提前校验对应限制。
> 默认情况下，即 omni_reference_task_type=auto：模型根据输入素材和提示词自动判定任务类型，再校验参数取值。如果参数与实际任务类型不兼容，任务将触发异步报错（错误码：InvalidParameter.TaskTypeConstraint）。
> 显式指定任务类型，即 omni_reference_task_type 为 reference、edit 或 extend：接口在提交任务时提前校验对应任务的特殊参数限制。不符合要求时，接口立即报错，任务不会创建。
> 注意：实际处理任务时，模型仍会进一步结合提示词判断任务类型。若实际判定的任务类型和指定的不一致，仍会触发异步报错（错误码：InvalidParameter.TaskTypeMismatch）。
> 可选值：
> - auto：由模型根据输入素材和提示词自动判定任务类型。
> - reference：参考生视频任务，即基于参考图片、参考视频或参考音频生成新视频。**设置 reference 时，ratio 或 duration 无特殊限制。**
> - edit：视频编辑任务，即对原视频的画面或音频进行编辑操作。**设置 edit 时，content 中必须至少包含一个 reference_video，且视频时长必须为 4–30 秒；ratio 必须为 adaptive；duration 必须为 -1。**
> - extend：视频延长任务，即对原视频向前或向后延长。**设置 extend 时，content 中必须至少包含一个 reference_video；ratio 必须为 adaptive。**」

来源：[创建视频生成任务 API—omni_reference_task_type](https://www.volcengine.com/docs/82379/1520757)。

要点：「ratio 必须为 adaptive / duration 必须为 -1」这两句原文写在 **`omni_reference_task_type` 参数的 edit 取值**下；extend 取值下只有「ratio 必须为 adaptive」，无 duration 约束。仓内注释对出处的引用属实。

### 2.3 `ratio` 参数（API 文档）

> 「视频宽高比。生成视频的宽高比例。可选值：16:9、4:3、1:1、3:4、9:16、21:9、adaptive（根据任务类型和输入内容自动适配宽高比）。
> 注意：Seedance 2.5 模型在视频编辑、视频延长、首帧 / 首尾帧生视频任务（详见任务类型与判定条件）存在特殊限制：
> - 仅支持配置 ratio 为 adaptive，不支持指定具体宽高比。
> - 视频编辑 / 视频延长任务中，模型根据提示词意图选定待编辑视频或待延长视频，并自动保持输出视频宽高比和待编辑视频或待延长视频一致。
> - 首帧 / 首尾帧生视频任务中，模型自动保持输出视频宽高比和 first_frame 指定的首帧图片一致。
> 模型支持：Seedance 2.5：默认值 adaptive；Seedance 2.0 系列：默认值 adaptive；Seedance 1.0 pro（fast）：文生视频默认 16:9，图生视频默认 adaptive。」

来源：[创建视频生成任务 API—ratio](https://www.volcengine.com/docs/82379/1520757)。

教程页「宽高比」章节同一口径，并补充 adaptive 适配规则：

> 「默认值：adaptive：即模型根据输入的提示词和参考素材，自动适配视频宽高比。可选值：16:9、4:3、1:1、3:4、9:16、21:9、adaptive。
> adaptive 适配规则：
> - 视频编辑 / 视频延长：模型根据提示词意图选定待编辑视频或待延长视频，并自动保持输出视频宽高比和待编辑视频或待延长视频一致。
> - 首帧 / 首尾帧生视频：保持输出视频宽高比和 first_frame 指定的首帧图片一致。
> - 文生视频 / 参考生视频：根据提示词选择可选宽高比中（16:9、4:3、1:1、3:4、9:16、21:9）最合适的宽高比。
> 注意：Seedance 2.5 在视频编辑、视频延长、首帧 / 首尾帧生视频任务中，仅支持配置 ratio 为 adaptive，不可指定具体宽高比。」

来源：[Doubao Seedance 2.5 教程—自定义视频输出规格-宽高比](https://www.volcengine.com/docs/ark/seedance-2-5)。

### 2.4 「不同模型的取值限制和 adaptive 适配规则」表（API 文档，ratio 维度）

| 任务类型 | Seedance 2.5 | Seedance 2.0 系列 | Seedance 1.0 系列 |
| --- | --- | --- | --- |
| 文生视频 | 支持在可选宽高比中自行设置，或由模型根据提示词在可选宽高比中自动选择（支持 adaptive 或指定宽高比） | 同左 | 仅支持在可选宽高比中自行设置，不支持 adaptive |
| 首帧或首尾帧生视频 | 自动保持输出视频宽高比和 first_frame 指定的首帧图片一致（**默认且仅支持 adaptive**） | 支持在可选宽高比中自行设置，或由模型根据首帧图在可选宽高比中自动选择（支持 adaptive 或指定宽高比） | 同 2.0 |
| 全模态参考-视频编辑 / 视频延长 | 模型根据提示词意图选定待编辑视频或待延长视频，并自动保持输出视频宽高比和待编辑视频或待延长视频一致，不支持另行设置（**默认且仅支持 adaptive**） | 支持在可选宽高比中自行设置，或由模型根据待编辑视频或待延长视频在可选宽高比中自动选择（**支持 adaptive 或指定宽高比**） | —（不支持该任务） |
| 全模态参考-参考生视频 | 支持在可选宽高比中自行设置，或由模型根据提示词在可选宽高比中自动选择（支持 adaptive 或指定宽高比） | 同左 | —（不支持该任务） |

来源：[创建视频生成任务 API—不同模型的取值限制和 adaptive 适配规则](https://www.volcengine.com/docs/82379/1520757)。

仓内注释所引「视频编辑/视频延长一行，Seedance 2.0 系列 =『支持 adaptive 或指定宽高比』，2.5 =『默认且仅支持 adaptive』」与表格原文一致，引用属实。同页另有「不同宽高比对应的宽高像素值」表（如 Seedance 2.5 480p 16:9 = 854×480、720p 16:9 = 1280×720、21:9 = 1470×630；4K 仅 2.0 系列支持），确认 21:9 为 2.5 合法输出比例。

### 2.5 `duration` 参数与 `duration = -1` 适配规则（API 文档）

> 「Seedance 2.5：默认值 -1；取值范围 [4, 30]；或设置为 -1（智能选择）。Seedance 2.0 系列：取值范围 [4, 15]；或设置为 -1（智能选择）。……Seedance 2.5 模型在视频编辑任务存在特殊限制：仅支持配置 duration 为 -1，不支持指定具体输出时长。传入的待编辑视频时长需在 [4, 30]s 内，否则将触发报错。」

`duration = -1` 取值规则表：

| 模型 / 任务 | duration = -1 取值规则 |
| --- | --- |
| Seedance 2.0 系列 | 模型在 duration 的有效取值范围内，自主选择合适的视频长度（整数秒） |
| Seedance 2.5（视频编辑任务） | 模型根据提示词意图选定待编辑视频，并自动保持输出视频时长和待编辑视频基本一致，不支持另行设置。输出时长可能为非整数秒；输出时长可能略短于待编辑视频，误差约 0.4 秒 |
| Seedance 2.5（其他任务类型） | 模型在 duration 的有效取值范围内，自主选择合适的视频长度（整数秒） |

来源：[创建视频生成任务 API—duration](https://www.volcengine.com/docs/82379/1520757)。

教程页「使用示例」同口径：视频编辑「参数 ratio 默认且仅支持配置为 adaptive，参数 duration 默认且仅支持配置为 -1，均不支持另行设置」；视频延长「参数 ratio 默认且仅支持配置为 adaptive……参数 duration 支持配置为 [4, 30] 或 -1」；首帧/首尾帧「参数 ratio 默认且仅支持配置为 adaptive……duration 支持配置为 [4, 30] 或 -1」。来源：[Seedance 2.5 教程—更智能的时长和宽高比控制](https://www.volcengine.com/docs/ark/seedance-2-5)。

### 2.6 教程「任务类型与限制」表与报错机制

任务类型由「输入素材 + 提示词意图」判定，全模态参考分三类子任务：

| 任务类型 | 触发条件 | 特殊限制 |
| --- | --- | --- |
| 文生视频 | 仅传入文本提示词 | ratio / duration 无特殊限制 |
| 首帧/首尾帧生视频 | content.role 设置为 first_frame / last_frame | **ratio 必须为 adaptive**；模型自动保持输出视频宽高比和 first_frame 指定的首帧图片一致 |
| 全模态-参考生视频 | content 中至少包含一个 role 为 reference_image、reference_video 或 reference_audio 的参考素材 | **ratio / duration 无特殊限制** |
| 全模态-视频编辑 | content 中至少包含一个 role 为 reference_video 的参考视频，并通过提示词表达编辑意图 | **ratio 必须为 adaptive、duration 必须为 -1**；模型根据提示词意图选定待编辑视频，并自动保持输出视频宽高比、时长和待编辑视频一致；参考视频时长必须为 4-30 秒 |
| 全模态-视频延长 | content 中至少包含一个 role 为 reference_video 的参考视频，并通过提示词表达延长意图 | **ratio 必须为 adaptive**；模型根据提示词意图选定待延长视频，并自动保持输出视频宽高比和待延长视频一致 |

> 「omni_reference_task_type 设置为 auto 时，模型根据提示词意图，可能将任务判定为参考生视频、视频编辑、视频延长任务。其中视频编辑、视频延长任务对配置参数有特殊限制。按推荐方式配置（推荐将 ratio 设置为 adaptive、duration 设置为 -1），可以兼容这些限制，减少任务创建后触发异步报错。」

来源：[Doubao Seedance 2.5 教程—任务类型与限制、配置方法](https://www.volcengine.com/docs/ark/seedance-2-5)。

### 2.7 提示词指南「任务使用说明」：锁定分类与关键词闭集

> 「Seedance 2.5 从传入素材最终是否会锁定输出视频的属性，把任务区分为两类（Seedance 2.0 没有这个区分）：有锁定：素材会严格成为输出视频时间轴上的一段，是模型输出去适应传入的素材，因此会锁定输出视频的宽高比、甚至时长。无锁定：仅对素材进行语义上的参考，因此用户可以指定输出视频的宽高/时长属性。」

有锁定三类（编辑/首尾帧/延长）的触发条件原文：

| 任务类型 | 任务触发条件 |
| --- | --- |
| 视频编辑 | 参数 content.role 需设置为 reference_image / reference_video / reference_audio；**提示词触发关键词，包含其一即可：编辑视频、增加/加上、删除/去掉、修改/替换/改成** |
| 首帧/首尾帧 | 参数 content.role 需设置为 first_frame / last_frame（锁定宽高比严格对齐首帧图，ratio 必须等于 adaptive；时长支持用户自定义） |
| 视频延长 | 参数 content.role 需设置为 reference_image / reference_video / reference_audio；**提示词触发关键词，包含其一即可：向前/向后延长、延续、续写** |

「无锁定：参考任务/多宫格分镜/关键帧」章节：

> 「参考类任务对于输出视频的宽高比和时长没有来自输入素材的锁定，特别注意以下两类任务也是没有锁定的：R2V 能力……多宫格分镜/故事板……关键帧……」

来源：[Doubao Seedance 2.5 提示词指南—任务使用说明](https://www.volcengine.com/docs/ark/seedance-2-5-prompt-guide)。

### 2.8 官方示例：reference 任务显式指定 16:9

教程页「50 个全模态参考素材输入」示例（含多图 + 多视频 + 音频）的请求体节选：

```json
{
    "content": [ ... { "type": "video_url", "video_url": { "url": "https://arkdocs.tos-cn-beijing.volces.com/videos/...mp4" }, "role": "reference_video" } ],
    "generate_audio": true,
    "ratio": "16:9",
    "duration": 15,
    "omni_reference_task_type": "reference",
    "output_format": "mov"
}
```

来源：[Doubao Seedance 2.5 教程—50 个全模态参考素材输入](https://www.volcengine.com/docs/ark/seedance-2-5)。这是「普通参考生视频任务可以指定固定比例」的最直接官方示例。

### 2.9 输入限制（与比例间接相关，顺带核实）

教程「使用限制」：图片数量「全模态参考生视频：1~30 张」；「非视频编辑任务：单个视频时长 [2, 30] s。视频编辑任务：单个视频时长 [4, 30] s。最多传入 10 个参考视频，所有视频总时长不超过 30 s」；「Seedance 2.5 单次输入素材上限提升至 50 个（30 张图片 + 10 段视频 + 10 段音频）」。来源：[Doubao Seedance 2.5 教程—使用限制](https://www.volcengine.com/docs/ark/seedance-2-5)。

## 3. 逐问题结论

| # | 问题 | 结论 |
| --- | --- | --- |
| Q1 | 全模态参考模式下 ratio 的完整取值集合；是否接受显式宽高比 | 集合为 `16:9、4:3、1:1、3:4、9:16、21:9、adaptive`。是否接受显式宽高比**按子任务分叉**：参考生视频（reference）接受；视频编辑/视频延长（edit/extend）不接受（仅 adaptive）；首帧/首尾帧不接受（仅 adaptive）。 |
| Q2 | omni_reference_task_type 官方语义 | 取值 `auto`（默认）/ `reference` / `edit` / `extend`，**没有 `default`**；模型支持仅 Seedance 2.5。约束原文见 §2.2：「ratio 必须为 adaptive、duration 必须为 -1」写在 **edit** 取值下；extend 下仅「ratio 必须为 adaptive」（duration 无 -1 要求）；reference 下「ratio 或 duration 无特殊限制」。 |
| Q3 | 普通全模态参考能否指定 9:16 等固定比例 | **能**。官方三处明文：reference「ratio 或 duration 无特殊限制」（API 参数说明）；「参考生视频：支持 adaptive 或指定宽高比」（取值限制表）；官方示例 `omni_reference_task_type: "reference"` + `ratio: "16:9"`。提示词指南「无锁定」分类亦确认参考类任务可自定义宽高/时长。官方没有「default 可指定比例」这个措辞——官方对应词是 **reference**。 |
| Q4 | 首帧/首尾帧的 ratio 约束原文 | 「首帧/首尾帧生视频：ratio 必须为 adaptive」「模型自动保持输出视频宽高比和 first_frame 指定的首帧图片一致」「默认且仅支持 adaptive，不可指定具体宽高比」；首尾帧画幅不一致时「尾帧会被拉伸，因此建议输入画幅一致的首帧和尾帧」。仓内仅 adaptive 属实。 |
| Q5 | 取值限制表完整内容 | 见 §2.4（ratio 维度全表）与 §2.5（duration 维度）。关键差异：编辑/延长一行 2.5 = 默认且仅支持 adaptive，2.0 系列 = 支持 adaptive 或指定宽高比；首帧/首尾帧一行 2.5 = 仅 adaptive，2.0 = 支持自适应或指定；文生视频与参考生视频三代模型均可指定比例（1.0 文生不支持 adaptive）。 |
| Q6 | adaptive 的官方定义 | ratio=adaptive 按**任务类型**适配：编辑/延长 → 跟随「模型根据提示词意图选定的」待编辑/待延长视频；首帧/首尾帧 → 跟随 first_frame 首帧图；文生/参考生视频 → 「根据提示词选择可选宽高比中最合适的宽高比」。duration=-1：视频编辑 → 与待编辑视频基本一致（可能非整数秒、可能略短约 0.4 秒）；其他任务 → 模型在 [4,30] 内自选整数秒。 |
| Q7 | 多素材混合时比例如何取舍 | **官方当前文档未写明**。2.5 无「跟随第一个素材」类规则：参考生视频的 adaptive 是按提示词语义在 6 个固定比例中选择；编辑/延长是「存在多个输入视频时，由模型根据提示词意图判定待编辑/待延长视频」；首尾帧是跟随首帧图。旧版 2.0 文档（2026-07 调研时版本）曾有「以传入的第一个媒体文件为准（优先性：视频＞图片）」一句，2026-09-22 当前版已删除、改为按任务类型分列表述，不能再用旧句当 2.5 依据。 |

## 4. 仓内配置与官方口径对照

仓内依据：[`002_seed.sql`](../../backend/prisma/schema/002_seed.sql)（`doubao-seedance-2-5-260628` 行）、[`capability-param-validation.ts`](../../backend/libs/contracts/capability-param-validation.ts)（`resolveVideoTaskType` / `taskTypeAllowedRatios`）。

| 配置项 | 仓内值 | 官方口径 | 对照 |
| --- | --- | --- | --- |
| 基础 supported_aspect_ratios | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, adaptive | 可选值 16:9、4:3、1:1、3:4、9:16、21:9、adaptive | 一致 |
| task_types.default 允许比例 | 全部 7 种（含 adaptive） | reference：ratio 无特殊限制；支持 adaptive 或指定宽高比 | 一致 |
| task_types.first_frame | 仅 adaptive | 首帧：ratio 必须为 adaptive（默认且仅支持） | 一致 |
| task_types.first_last_frame | 仅 adaptive | 首尾帧：ratio 必须为 adaptive（默认且仅支持） | 一致 |
| task_types.edit | 仅 adaptive | edit：ratio 必须为 adaptive | 一致 |
| task_types.prolong | 仅 adaptive | extend：ratio 必须为 adaptive | 一致 |
| supported_durations | min 4 / max 30 / step 1 | [4, 30] 或 -1 | 一致（step=1 表示整数秒档；-1 是特殊值非档位，见下） |
| image_reference_max | 30 | 全模态参考生视频 1~30 张 | 一致 |
| video_reference_max | 10 | 最多 10 个参考视频，总时长 ≤30s | 一致 |
| max_reference_duration_sec | 30 | 非编辑任务单个视频 [2,30]s；编辑任务 [4,30]s | 基本一致（单视频上限 30s 对；编辑任务的 4s 下限仓内未表达，且总时长 ≤30s 限制未表达） |
| 编辑关键词（EDIT_INTENT_KEYWORDS） | 编辑视频、增加、加上、删除、去掉、修改、替换、改成 | 「包含其一即可：编辑视频、增加/加上、删除/去掉、修改/替换/改成」 | 一致（斜杠同义项展开正确） |
| 延长关键词（PROLONG_INTENT_KEYWORDS） | 向前延长、向后延长、延续、续写 | 「包含其一即可：向前/向后延长、延续、续写」 | 一致 |
| edit 判定需参考视频 | `resolveVideoTaskType` 要求 role=reference 的视频素材才判 edit | 「设置 edit 时，content 中必须至少包含一个 reference_video」；触发条件「至少包含一个 reference_video + 提示词表达编辑意图」 | 一致（官方 auto 模式的模型判定同样以「参考视频 + 编辑意图」为前提） |

仓内注释引用逐条核实：

| 仓内注释断言 | 核实结果 |
| --- | --- |
| 「设置 edit 时，content 中必须至少包含一个 reference_video」「设置 extend 时……必须至少包含一个 reference_video」 | 属实，原文一致（§2.2） |
| 「ratio 必须为 adaptive / duration 必须为 -1 写在 omni_reference_task_type 下」 | 属实，具体在 **edit 取值**下；extend 下只有 ratio 约束 |
| 「该参数的模型支持只有 Seedance 2.5」 | 属实 |
| 编辑/延长关键词闭集 | 属实，逐字一致（§2.7） |
| 「不同模型的取值限制」表：编辑/延长一行 2.0 系列 = 支持 adaptive 或指定宽高比、2.5 = 默认且仅支持 adaptive | 属实（§2.4） |

## 5. 评估：当前设定是否合理

**总体判断：仓内 Seedance 2.5 的比例配置与官方口径一致，且是最优的产品化收窄方向。**逐点：

1. **default 放开 7 种比例是官方明确支持的**，不是「灰色地带」——API 参数说明、取值限制表、官方示例三处背书。把 default 收窄到仅 adaptive 反而会砍掉官方支持的合法能力。
2. **首帧/首尾帧/edit/prolong 收紧到仅 adaptive 是官方硬约束**（「仅支持」「必须」「不可指定」三重措辞），仓内在提交侧前置拒绝与官方同步/异步报错口径对齐，能把失败提前到本地 4xx，合理。
3. **任务类型判定器与官方 auto 模式判定逻辑同构**（首尾帧角色 > 延长意图 > 编辑意图 > 默认），关键词闭集逐字对齐官方。注意两点固有差异：官方是「模型判定」，本仓是子串匹配——本仓更机械，边界 case（如模型对隐喻表达的编辑意图）会比官方判得窄，这是保守方向的偏差，可接受；反之本仓不会把官方判为 default 的单误判成 edit，方向正确。
4. **命名映射提醒**：本仓枚举 `default`/`prolong` 与官方取值 `reference`/`extend` 不同名。当前本仓未向上游传 `omni_reference_task_type`（默认 auto，由官方模型判定）尚无冲突；若后续要在请求里显式传（把报错前置为同步 4xx），必须映射为 `reference`/`edit`/`extend`，不要把 `default`/`prolong` 直发上游。
5. **仓内尚未表达的官方约束（非本次调查范围，顺带记录）**：
   - edit 任务的 `duration 必须为 -1`、prolong 的 `duration 可自选 [4,30]`——`features.task_types` 目前只有 `allowed_ratios`，没有按任务类型的时长约束（edit 需强制 -1，即「智能选择」，与本仓整数秒档位体系不兼容）；
   - edit 任务参考视频时长下限 4s（非 edit 为 2s）、参考视频总时长 ≤30s；
   - edit/prolong 官方建议 `output_format` 使用 mov。
   这些如需跟进，应另开工单，不影响本次 ratio 结论。

## 6. 官方未写明 / 未能核实之处

1. **多素材比例取舍规则（Q7）**：Seedance 2.5 当前文档未写明「图片 + 视频混合、比例不一致时输出跟随谁」。只能确定：adaptive 下参考生视频按提示词语义在固定比例中选择。若产品需要「跟随第一段参考视频比例」的确定性语义，官方没有依据，属产品侧决策。
2. **auto 与 reference 的等价性**：官方未说明「auto 被模型判定为参考生视频」与「显式 reference」在参数校验上是否完全等价（auto 有被判成 edit/extend 而触发约束的可能；reference 则锁死为参考任务）。本仓 default 配置等效于「按最宽松口径放开」，与官方对 reference 的口径一致，但本仓并未显式传 reference，实际行为取决于官方模型判定——若提示词意外命中编辑/延长语义，上游仍会异步报错（本仓侧已通过的固定比例会被官方拒绝）。这是官方设计使然，本仓 4xx 预检无法完全消除。
3. **`adaptive` 在「模型自动选择固定比例」时是否计入按量计费差异**：官方未说明（计费按分辨率 + 时长，与比例无直接关系，本笔记未深挖）。
4. **页面标题与内容不一致**：API 参考页（1520757）标题仍为「Seedance 2.0 API 参考官方文档」，但正文已含 Seedance 2.5 专属参数（`omni_reference_task_type` 标注 new）。引用时以正文为准，标题不代表覆盖范围。
5. **未能核实（不影响结论）**：火山方舟控制台内嵌的 API Explorer 在线调试页（需登录）未访问；`omni_reference_task_type` 的 `reference` 取值在 API 文档正文参数表中已列出，但教程「配置方法」章节只给了 auto/edit/extend 三种推荐配置，未单独给 reference 的配置小节（reference 仅出现在参数说明与 50 素材示例中）。
