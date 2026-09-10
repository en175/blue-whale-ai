# Blue-Whale 前端

一个处于上线前研发阶段、面向 AI Agent / Canvas 交互的产品。目标运行时由 Next.js Web 与
TypeScript `agent-worker`、`generation-worker` 组成；三者属于同一模块化单体代码库。
独立 `product-api` 进程已退役，浏览器业务 API 折进 Next.js Route Handlers（ADR-0059）。
`blue_whale_api`（new-api 二开，Go，承担 LLM 网关与计费）已迁出至独立仓库 `blue-whale-api`（`hangzhou-xuanfu_1/blue-whale-api`），保持独立且不在本仓改造。
`blue_whale_server`（Java）与 `blue_whale_agent_worker`（Python）已退役，禁止写 入（不约束按 ADR-0084 新建的 `worker-java` 生成执行服务——薄执行器，非旧服务复活）；
`blue_whale_pay_web` 与 `blue_whale_pay_server`（Java 支付）已迁出至独立仓库 `blue-whale-pay`（`hangzhou-xuanfu_1/blue-whale-pay`），其中 server 冻结、web 单独迭代。范围以
[ADR-0055](docs/adr/0055-prelaunch-typescript-unification-scope.md) 为准。

## Language

### Canvas 生成草稿（已确认目标，待实现）

**生成草稿节点**:
用户在 Canvas 中为图片、视频或音频创作建立的持久工作对象，承载待提交的生成配置与参考关系；首次生成成功后，结果填回原节点并保留位置和连线。
_Avoid_: 已提交的生成任务、正式媒体素材、素材缺失占位、SceneCard

**节点编辑草稿**:
生成媒体节点持有的最新提示词与完整生成配置，自动保存并在再次选中时恢复；它可以与当前显示素材的生成输入不同。
_Avoid_: 提示词版本历史、独立新卡、修改即生成

**原卡重新生成**:
用户手动发送节点编辑草稿，为同一个媒体节点生成替换素材的创作动作，不新增结果卡。
_Avoid_: 再次编辑立即复制草稿、自动重新生成、提示词历史恢复

**画布参考选取模式**:
用户为当前生成目标从画布连续添加参考节点的交互状态，适用于图片、视频与音频生成面板；每次有效选取立即成为该目标的参考。
模式只在本次交互期间持续，退出、刷新或切换画布后不恢复模式，已添加参考仍保留。
_Avoid_: 普通画布多选、暂选后批量确认、刷新后恢复选取模式、Agent 对话引用

### Prompt 创作（IKDL9U 已确认目标，待实现）

本节记录 2026-09-06 确认的生成卡重构领域定义；本场景与下文历史 PlanMessage、SceneCard、
NodeItem 的应用及文本用途定义冲突时，以本节为准，不表示现有代码已经实现。

**Prompt 预览**:
Agent 根据用户资料、回复与上下文整理的最终提示词候选，展示在 Agent 面板中，用户可通过自然语言继续修改。
用户满意后手动点击“应用”，才将其作为文本节点放入 Canvas。
_Avoid_: 最终媒体、生成任务、自动应用、应用即生成、直接送入 dock

**Prompt 文本节点**:
用户手动应用 Prompt 预览后，在 Canvas 中得到的普通文本节点，具有标题和一份可直接编辑的 Prompt 正文。
用户自行将它连至生图或生视频节点，作为文本附件提供上下文。
_Avoid_: 独立生成卡类型、SceneCard、同时维护画面与提示词两份正文、文本节点自行决定生成类型

**文本附件**:
文本节点通过用户建立的连线向生图或生视频节点提供的文本上下文，同一目标可接收多个有序且按来源节点去重的文本附件，不隐式携带图片素材。
它与目标节点提示词共同生效而不覆盖后者；目标节点未填写提示词时，也可以仅使用文本附件生成。
_Avoid_: 图片素材、生成结果、默认等同于目标主提示词

**生成文本快照**:
一次生成提交时冻结的所用文本内容，取自提交时文本节点的当前正文。
它保留该次生成的输入事实，不随文本节点后续修改而改变。
_Avoid_: 始终回读节点最新内容的历史记录、文本修改自动重新生成

**文本对话引用快照**:
用户将文本节点“添加到对话”时提供给 Agent 的当时正文，用于基于画布上的实际编辑继续讨论。
Agent 据此修改得到新的 Prompt 预览，而不直接覆盖原文本节点。
_Avoid_: 仅提供原始卡片版本指针、自动回写画布正文

### Prompt 方案素材（IKE5G8 讨论中，已确认部分）

**方案素材绑定**:
Prompt 方案正文中的素材标签与具体素材之间的显式对应关系，是方案内容的一部分。
它不同于生成目标的输入连线；方案用于目标时，绑定素材分别成为该目标的直接媒体输入。
_Avoid_: 素材名称字符串、沿文本历史隐式携带媒体、应用即生成

### 既有领域术语

**Canvas**:
应用的核心交互界面（工作台），承载 Asset 素材与用户主动创建的文本便签的共享编排、
个人视口变换和 Agent 创作。
路由 `/canvas`，实现在 `web/src/pages/CanvasPage/`：`index.tsx` 为编排层，UI 实现在其 `components/` 子模块下。
_Avoid_: 画布（口语可用，文档中用 Canvas）、编辑器（指代不同概念）

**AgentChatPanel**:
Canvas 右侧的 Agent 对话面板（右侧对话区）。它只有一种需求对齐与创作策划模式，承载多轮澄清、
方案迭代以及 PlanMessage 的生成与修改，不提供图片或视频生成能力，也不直接创建 SceneCard。
呈现为覆盖 Canvas 之上的全高非模态抽屉：无遮罩、不锁定焦点、画布保持可交互，仅可由面板内关闭按钮
关闭；打开时隐藏 CanvasHeader 的 Agent 入口，关闭后恢复。宽度默认 468px，User 可拖拽抽屉左缘在
400px ~ min(720px, 50vw) 间实时调宽，宽度按 User 持久化；展开状态不持久化，进入 Canvas 与切换
Project 时默认收起。
_Avoid_: 对话区（口语可用，文档中用 AgentChatPanel）、Direct Gen、媒体生成操作面板、Agent 本体、
悬浮卡片形态、点击画布或 Esc 关闭

**AgentComposer**（历史术语，已废弃）:
曾指 Canvas 中与 Agent 交互的编排组件，对应旧文件 `components/AgentComposer.tsx`。
Canvas 现已改用 AgentChatPanel，此术语不再用于指代当前右侧对话面板。

**NodeItem**（Project 内可放入 Canvas 的资源）:
Product API 管理的 `asset | text` 判别资源；`kind` 创建后不可改变。两类都有服务端身份、强版本、
创建来源与最小审计信息，且都不承载位置、尺寸或层级。`asset` 必须引用已正式接纳的 `asset_id`，
不得包含文本内容；`text` 必须包含合同限长的纯文本，不得包含 `asset_id`，只表示用户明确创建的
标题、说明或创意便签。系统和 Agent 不得把推理、Brief、审核说明、任务状态或其他过程文字自动
创建为 text NodeItem；text 也不自动成为生成素材或 Agent 上下文。
Canvas 共享布局文档以 NodeItem ID 记录位置、尺寸与层级；从布局移除不删除 NodeItem，永久删除
必须使用独立的条件式操作，并在仍被当前布局引用时拒绝。同一 Asset 可以对应多个独立 NodeItem。
_Avoid_: 浏览器生成或推导 NodeItem ID；把布局信息或签名地址写入 NodeItem；给 text 写入 HTML 或
隐式富文本；把过程文字创建为 NodeItem；把移出布局当作删除。

**SceneCard（场景卡）**:
Project 内持久化的单个视频画面片段创作内容，以 Markdown 作为权威正文；默认最终生成动作是直接生成
视频，不提供通用图片生成。它是独立产品资源，不是对话 Card，也不是 NodeItem。
_Avoid_: 把 SceneCard 当作 Card 的持久化版本；把 SceneCard 内容复制进 Canvas 布局；归入 NodeItem；通用图片生成容器

**StoryboardPreview（分镜预览）**:
User 从 SceneCard 显式触发、用于正式视频生成前审阅与确认的导演式静态故事板；其有序画格表达镜头顺序、
构图与动作节拍。它是可选准备产物，不是最终图片作品或默认前置步骤，完成后不自动创建视频 GenerationJob，
也不自动成为视频模型输入；User 只能在生成编辑器中把符合模型能力的画格显式指定为首帧、尾帧或参考图。
_Avoid_: 单张最终图片、视频模型关键帧组、SceneCard 图片模式、默认先出分镜、自动串联视频、自动绑定视频输入

**SceneCardGenerationPreset（场景卡生成预设）**:
由 SceneCard 持久拥有、供下一次直接视频生成默认使用的完整参数；首次应用 PlanMessage 时从其冻结参数创建，
此后只能由 User 在生成编辑器中修改。每个 GenerationJob 独立冻结提交时的参数快照，修改预设不得改写
历史 PlanMessage 或 GenerationJob。
生成编辑器只允许调整视频模型、画面比例、分辨率、时长、生成数量、参考模式及显式首帧、尾帧与普通
参考图；媒体类型固定为视频，SceneCard 权威正文与派生提示词保持只读。控件与组合必须受当前模型能力约束。
预设必须具有时长与视频参考模式；视频首帧、尾帧只能指向 PlanMessage 正文中已验证的素材引用，或同一
SceneCard 的 StoryboardPreview 画格——画格须在生成编辑器中显式指定为首/尾帧或参考图并通过当前模型
能力验证，不自动成为视频输入。触发 StoryboardPreview 不会把 SceneCard 或其生成预设切换成图片生成模式。
PlanMessage 正文引用保存全部有效素材；预设中的生成输入只是其中经过所选模型能力验证、带明确角色的
子集。User 明确要求素材直接参与生成但当前能力不支持时，必须先自然语言澄清，不能静默降为上下文参考。
生成编辑器内的参数修改只形成本地临时草稿；只有 User 点击“生成”时，Product API 才原子更新预设并
创建新的 GenerationJob，关闭编辑器不保存草稿。生成编辑器不编辑 SceneCard 的权威 Markdown 正文；
正文只能在 SceneCard 编辑器中单独修改。打开后若正文或预设已经变化，提交零写入并保留本地草稿，
User 刷新复核后再生成，不自动合并。
_Avoid_: SceneCardNode 数据、图片生成预设、媒体类型切换、编辑提示词、模型不支持的参数组合、每次打开重新猜测的默认值、历史生成参数、改写 PlanMessage、在生成面板改写正文、自动合并过期草稿

**ProviderPromptProjection（供应商提示词投影）**:
服务端从 PlanMessage 或 SceneCard 的权威 Markdown 正文确定性派生、实际提交给生成供应商的提示词；
普通正文保持不变，`asset://` 引用转为可读素材标记，禁止再次调用模型改写或总结。GenerationJob 同时
冻结原始正文、该投影与结构化生成输入。
_Avoid_: 第二份可写提示词、把 `asset://` 地址直接发给供应商、模型二次润色、只保存派生结果

**SceneCardNode（场景卡节点）**:
SceneCard 在 Canvas 中的布局投影，只引用一个 SceneCard 并承载布局，不拥有场景内容；它是
“Canvas 只编排 NodeItem”规则的显式例外；同一 Canvas 中一张 SceneCard 最多有一个 SceneCardNode。
节点身份由 SceneCard 身份确定性生成；放置重试必须读取最新 Canvas 布局，只新增缺失节点，节点已存在
即视为成功。新建时选择当前视口中心附近的首个空位，覆盖时复用原节点且不移动；持续失败时保留由
User 触发的“重新放入画布”入口。
_Avoid_: NodeItem、SceneCard 本体、在节点中保存 Markdown 副本或生成参数

**SceneCardGenerationOrigin（场景卡生成来源）**:
GenerationJob 从 SceneCard 发起时冻结的来源事实，使 SceneCard 能按生成时内容快照展示历史任务与作品；
它不转移 Asset 的 Project 归属，SceneCard 删除或修改也不删除、改写既有 GenerationJob 与 Asset。
_Avoid_: 作品归 SceneCard 所有、SceneCard 删除级联删除作品、用 SceneCard 最新正文解释历史生成

**SceneCardGenerationRecord（场景卡生成记录）**:
User 从 SceneCard 发起的一次新生成及其后续重试的用户可见聚合；成功作品固定保留，重试只补齐失败或
缺失位置，“再次生成”形成新记录。首次应用产生的 GenerationJob 失败也归入该记录，重试不得创建新
SceneCard 或 PlanApplicationReceipt；User 修改参数后再生成始终形成新记录。其汇总状态只使用
“生成中、部分完成、全部成功、全部失败”。
_Avoid_: 每个 GenerationJob 各算一条记录、重试覆盖成功作品、把再次生成当作重试

**InitialPlacementStatus（NodeItem 首次放置状态）**:
NodeItem 创建后的一次性流程状态：`pending`、`placed` 或 `dismissed`。它只记录首次放置流程的结果，
不表示 NodeItem 当前是否在 Canvas；当前布局始终只由 Canvas 共享布局文档决定。Product API 接纳
首次包含 pending NodeItem 的完整 Canvas PUT 时，必须在同一提交中保存布局并把状态改为 `placed`；
用户明确选择“暂不放置”时改为 `dismissed`。`placed` 与 `dismissed` 都是终态，后续放入或移出
Canvas 均不改变它。只有持有原创建请求或 GenerationJob 接纳回执的页面可以自动尝试首次放置；
这是 Web 的多页面协调规则，不是服务端权限。AgentChatPanel 手动应用始终记录进入 Canvas 的意图：图片
计划输出创建 Asset NodeItem，视频计划先放置 SceneCardNode，视频成功后再创建 Asset NodeItem。部分成功
结果可以增量放置；`pending` 作品基于最新 Canvas 布局幂等重试新增，首次成功后即转为 `placed`，User
后续移除节点不得触发自动恢复。
图片计划结果以当前视口中心为锚点按无重叠网格排列；视频与 StoryboardPreview 产物从对应
SceneCard 实测高度下方 10px 起依次下排，同批作品成组排列（分镜画格同批横向），多批按首次提交
顺序排列。部分成功与重试只占用首个空位，不移动或覆盖既有节点（对齐 spec §3.4）。
_Avoid_: 从该状态推导当前布局；移出 Canvas 后重置为 pending；自动过期、自动删除、后台放置；
在 Canvas 冲突重试中移动或覆盖既有节点；绕过完整 PUT 增量放置。

**Card**（对话卡片消息）:
Web 依据 Conversation、GenerationOutputSlot、GenerationJob 与 Asset 形成的界面投影；生成中、
失败的输出即使没有 Asset 也可以显示 Card。Card 没有服务端身份、强版本、存储表或修改接口；
用于界面去重的 `projection_key` 只能由权威来源身份确定，不是产品资源 ID。Card 与 NodeItem 是
不同概念：前者是可重建的界面投影，后者是 Product API 管理的 Project 资源。
_Avoid_: 持久化 Card；为 Card 设计资源接口；让浏览器随机生成 `projection_key`；把 Card 当作 NodeItem。

**BottomDock**（底部生成 Dock）:
Canvas 底部的生成工具面板，由 `LeftToolbar` 的 ai-image / ai-video 工具触发，
含 image / video 两种 mode。它是**纯生成工具**：手填参数（模型、比例、分辨率、
时长、数量、联网搜索等；参数随 GenerationJob 提交真实生效）做确定式生成，不涉及对话流。
对应 `_canvas/components/dock/`。

**生图入口（职责边界不同，非同一功能）**:
- **BottomDock**：纯生成工具，参数驱动，不暴露对话上下文。
- **AgentChatPanel**：编排 + 生成，对话/技能/上下文驱动，不暴露细粒度参数。
- **/generate（GenerationInbox）**：Agent 对话式生成，承载独立 Conversation 与恢复语义。
三者都统一进入生图工具包与 GenerationJob 队列流水线（成本预留 + 内容审核 + 失败重试）；
Web 可从权威状态投影 Card，只有 GenerationJob 创建时已记录“进入 Canvas”意图的输出，才在
Asset 正式发布时原子创建初始 NodeItem。**入口职责独立、是不同功能**。

**生图工具包（generation toolkit）**:
三个生图入口共享的执行层，与入口的产品职责边界正交。由三部分组成：
- **GenerationProvider** —— 图片执行层的产品中性请求/结果契约；具体实现（Fake、OpenAI、
  火山方舟 Agent Plan 等）按运行 mode（`GENERATION_MODE`）装配，当前没有独立的运行时 Provider Registry。
- **generation_model_capability** —— 图片 / 视频 / 文生文 / 音频模型能力目录的权威数据表：
  provider_id + model_id 唯一标识一档能力，记录展示信息（label / icon）与该能力类型适用的
  参数（图片与视频：尺寸选项 / 比例选项 / 格式 / 时长等；音频：时长 / 格式，无调用尺寸矩阵）及启停状态。
  承担双重角色：① 前端模型选项的展示源（不再写死，经 `/api/generation/models` 拉取）；
  ② 创建生成任务时的 model_id 白名单——请求引用的模型必须是该目录中启用且能力类型与
  生成类型匹配的条目（详见 [ADR-0067](docs/adr/0067-generation-model-capability-text-and-whitelist.md)）。
  其中 **TextCompletion（文生文接口）** 是 text 档位的直接消费端：供 Agent / 调用方直接调用大模型
  文本能力的 OpenAI 兼容通道，仅做登录鉴权与 text 白名单命中校验，不创建 GenerationJob、不落业务审计，
  计费由 LLM 网关（blue-whale-api）按调用方身份扣 quota。text 能力行在目录里只承载供应商、
  调用模型、展示名、图标、启用与排序，没有尺寸选项、比例选项或调用尺寸矩阵。
  _Avoid_: 把文生文调用包装进生成任务队列；绕过 text 白名单直传任意模型名；在 BFF 承接业务语义校验；
  把音频生成写成视频的 features.audio；给 text 行配尺寸或比例。
- **公共治理流水线** —— 成本预留（CostReservation）、内容审核（ContentReview）、失败重试与多输出，
  由统一的 GenerationJob 队列承接。
火山方舟 Agent Plan 使用专属 `/api/plan/v3` 端点与专属 API Key；退役的 `/api/generation/image`
直连因绕过成本预留与内容审核不再提供（详见 [ADR-0038](docs/adr/0038-generation-toolkit-and-image-direct-retirement.md)）。
_Avoid_: 把工具包写成独立的 Provider Registry 运行时组件；把入口产品职责边界与执行层统一混为一谈；
新增供应商时不走能力表与队列流水线。

**能力类型（Capability Type）**:
模型能力目录中一条能力的生成种类，仅四种：图片（image）、视频（video）、文生文（text）、
音频（audio）。四种在管理目录中并列；一条能力的能力类型在创建后不可改。
_Avoid_: 把音频生成当成视频特性；用 features.audio 表示音频模型（那是「视频带音轨」）；档位

**运行模态（Generation Modality）**:
图片能力档的两种工作方式：文生图（仅提示词）与图生图（提示词 + 参考图）。模态不是能力——
同一档能力同时覆盖两种模态，任务创建时是否带参考图决定本次走哪种；一档能力若不支持参考图，
就只有文生图一种模态。上游按模态拆分的模型名对用户不可见（详见 [ADR-0085](docs/adr/0085-catalog-input-modality-model-alias-and-per-model-prompt-length.md)）。
_Avoid_: 把文生图 / 图生图各开一档能力；把模态当第五种能力类型；用开关决定模态（分流只由数据与输入驱动）

**尺寸选项（Size Option）**:
User 在图片或视频生成中选择的分辨率档，如 `1K` / `2K` 或 `720p`。它是目录提供的展示选择，
不是发给供应商的原始参数，也不是充值档位。控件种类全站统一；一条能力行有哪些尺寸选项
由该行自己配置。所有图片模型对 User 都只露出尺寸选项与比例选项，不露出像素或供应商私有写法。
_Avoid_: 档位、把 `1024x1024` 这类像素串直接当作 User 选项、与调用尺寸混用、全站写死同一组取值

**比例选项（Aspect Ratio Option）**:
User 在图片或视频生成中选择的画面宽高比，如 `1:1` / `16:9`。一条能力行有哪些比例选项
由该行自己配置。图片上，前端只露出**当前尺寸选项下交叉格已填**的比例；未填组合不出现在控件里。
User 只看到冒号写法，看不到 `1x1` 或像素。GPT 全量在 `1K` 下不提供 `16:9`（该交叉格留空）。
_Avoid_: 把 `1x1` / `16x9` 当作 User 可见比例；把比例写成像素；全站写死同一组取值；
把空交叉格仍展示给 User 去点

**生成渠道解析器（Generation Channel Parser）**:
代码内置的图片请求拼装与响应解析策略。管理端不能新建渠道或编写解析逻辑；图片能力行直接
选择一个已注册的解析器。响应三家共用默认信封 `data[].url`。请求：Seedream 本期仍用代码表
`seedream-image-size` 折成一个 `size`，不经管理端映射；GPT 用目录交叉格得到一个 `size`；
Banana 用目录一维映射：尺寸选项 → `quality`，比例选项 → `size`（`1x1` 等）。
_Avoid_: 管理端 JSONPath；与 new-api 渠道混用；把解析器做成可 CRUD 表；给 Banana 做像素交叉格；
本期改 Seedream 出图像素

**调用尺寸（Provider Size）**:
写入请求 `size` 的像素或档位字符串。GPT 来自该行尺寸选项 × 比例选项交叉格（空则回退默认格），
合法值仅限官方枚举（含 `1024x1024`、`2048x2048`、`3840x2160`、`auto` 等），2K/4K 是独立像素档不是 1K 钳位。
Seedream 本期仍由代码表按模型 × 尺寸选项 × 比例选项计算，与目录交叉格无关。
_Avoid_: 与尺寸选项混用；向消费端暴露调用尺寸；用另一套 1K 底表覆盖 Seedream 现网像素

**调用质量（Provider Quality）**:
Banana 解析器写入请求 `quality` 的值，由尺寸选项一维映射得到（展示 `1K` → `1k`）。
_Avoid_: 与 Seedream/GPT 的调用尺寸交叉格混用

**调用比例（Provider Ratio）**:
Banana 解析器写入请求 `size` 的值，由比例选项一维映射得到（展示 `1:1` → `1x1`）。
Banana 的请求字段名叫 `size`，语义是比例，不是像素。
_Avoid_: 与 User 可见的比例选项（冒号写法）混用；当成 Seedream 的像素 `size`

**供应商（provider_id）**:
能力行上的供应方标识列，与调用模型组成目录唯一键，并写入计划卡 / 场景卡能力快照。
运行时不出图选路，也不决定请求/响应怎么解析；管理端新建或编辑时不再填写，
由系统写入默认值（现行为 `new-api`）。
_Avoid_: 渠道、Channel、把网关渠道 ID 写进能力目录；在管理表单里当「选渠道」；
用它选择解析器或 HTTP 客户端

**调用模型（model_id）**:
能力行真正提交给供应方的模型名，如 `doubao-seedream-4-0-250828`。创建后不可改。
_Avoid_: 展示名、渠道模型别名、把 User 可见名称当作调用模型

**展示名（model_label）**:
能力行给 User 看的名称，如「豆包 Seedream 4.0」。可改，不参与调用。
_Avoid_: 与调用模型混用

**默认尺寸选项 / 默认比例选项**:
该能力行上 User 未另选时使用的尺寸选项与比例选项。Seedream / GPT 上，二者交叉格的调用尺寸
同时作为其他交叉格未填时的回退值。Banana 上分别回退到默认尺寸选项的 `quality` 映射与
默认比例选项的 `size` 映射。
_Avoid_: 全站写死 `2K`×`1:1`；把默认理解成直传展示字符串

**Project**（项目，产品归属根）:
领域顶层的归属、授权与生命周期范围；Canvas、Conversation、AgentRun、GenerationJob 与 Asset 均归属于 Project，但各自保持独立的一致性边界。
切换 Project 即切换 Canvas 与 AgentChatPanel 对话历史。
_Avoid_: 把 Canvas 当作顶层概念；把 Project 理解为包住全部对象的单一强一致事务聚合。

**Conversation**（对话）:
普通 Canvas Project 内唯一的 AgentChatPanel 持久化消息流；按顺序记录用户与 Agent 的对话事实，并关联多个先后发生的 AgentRun。
GenerationInbox 允许并存多段独立 Conversation（新对话/历史切换），每段消息流独立排序与恢复。
_Avoid_: 把消息直接挂到 Project；把每个 AgentRun 当作独立对话；为普通 Canvas Project 建立多个 Conversation。

**ConversationMessage（正式会话消息）**:
Product API 接纳的不可变用户或助手消息，拥有服务端身份，并按同一 Conversation 内的服务端顺序读取。
刷新、重连或 Worker 重启不得丢失已接纳消息；本地草稿、临时流式片段和客户端时间不属于正式消息。
User 主动停止时，清除尚未接纳的临时助手文本，只保留“已停止生成”的非消息状态；Snapshot、永久
Conversation 历史和后续模型上下文均不包含该半成品。
_Avoid_: 用浏览器生成值或 SSE 到达顺序充当消息身份与排序依据；把停止前临时文本保留为正式消息或历史投影。

**ReasoningSummary（思考摘要，已被 ThinkingTrace 取代）**:
曾随 AgentRun 持久化的一句话处理结论（≤280 字）；其“内部思考链不展示、不持久化”的展示决策已被
[ADR-0071](docs/adr/0071-thinking-trace-streaming-and-per-round-persistence.md) 推翻。字段保留为内部用途，
不再面向 User 展示。
_Avoid_: 继续把它当作对话流中的展示内容

**ThinkingTrace（思考过程）**:
Agent 在每个 AgentAdvance 中产生的模型思维链内容；面向 User 真流式展示并按轮持久化，作为该轮产出
助手消息的附属字段保存（计划卡批次由首卡行承载），不是独立消息类别，也不进入模型上下文。AgentChatPanel
每轮一个思考块，位于该轮产出（正文、澄清问题或计划卡）上方：思考中展开流式显示，一轮内多段思考聚合为
同一块；思考结束自动折叠为“思考过程”，历史轮默认折叠、可手动展开。User 主动停止或推进失败时不持久化，
未产出思维链的轮次不显示思考块。思维链是未经内容审核的模型原始输出，展示豁免的决策与风险见 ADR-0071。
_Avoid_: ReasoningSummary 思考摘要、独立消息类别、把多段思考拆成多个块、把工具调用过程展示给 User、
为停止或失败轮保留思维链

**PlanPhase（计划阶段）**:
Agent 创作入口内由 Agent 按对话意图自主进入或退出的内部行为阶段；User 可以用自然语言要求立即产出
PlanMessage、继续讨论或不产出 PlanMessage，但不需要理解或切换独立模式。
“立即出计划”在必需信息齐备且不存在不受支持要求时同时表达最终同意，Agent 直接提交 PlanMessage；
它不授权补齐核心缺口或静默降级明确要求。
_Avoid_: Plan Mode、模式开关、直接生成入口、把普通问答或素材分析自动转成计划卡

**PlanMessage（计划卡消息）**:
Conversation 中由 Agent 提交的独立正式消息类别，以 Markdown 与稳定素材引用表达可应用的图片或视频计划；
`write_plan_cards` 工具调用只在 AgentRun 中暂存完整候选，不直接创建正式消息；Product API 完成整批验证后，
只有 RunCommit 能原子接纳全部 PlanMessage。验证失败、User 停止或提交前中断均零消息，恢复可复用已保存
的完整候选而不重新调用模型。图片与视频 PlanMessage 的 `content_type` 统一为 `plan_message`，不得使用
把图片计划误建模为场景卡计划的 `scene_card_plan`。
一次方案可以按顺序提交一条或多条 PlanMessage，每条都有独立消息身份、独立 PlanApplicationKind 并可
独立应用；不含覆盖的批次可以混合图片与视频计划。整批只作为原子接纳边界，不形成新的持久化批次资源。
每条 PlanMessage 在提交时都必须冻结一套完整、可执行的生成参数：User 明确指定的值必须保留，
未指定项在计划卡生成时补齐有效默认值；首次应用直接使用这套参数，不在应用时重新猜测默认值。
参数必须来自 Product API 提供的版本化生成能力快照并记录其版本；明确要求不受支持时必须先通过
自然语言澄清，未指定项才使用快照默认值，Agent 不得虚构能力或静默降级 User 的明确要求。
`content_markdown` 是唯一可写提示词正文；行内素材使用 `asset://` 引用，服务端按首次出现顺序解析、
去重和验证并派生只读引用列表。生成参数中的首帧、尾帧等素材角色只能指向这份已验证列表。
同一批次的多条 PlanMessage 表示不同场景或提示词；每条消息参数中的生成数量表示该场景的结果版本数，
默认值为一，只有 User 明确要求多个结果时才增加。
多卡批次可带一个由 Agent 生成的短序号名词；服务端根据卡片顺序派生并在每条 PlanMessage 中持久保存
名词、序号与总数，单卡不显示序号，多卡缺少名词时只显示序号与总数。
它随对话历史持久保留，可记录直接参考的另一 PlanMessage，并按生成类型冻结 PlanApplicationKind：图片计划
使用 `image_generate`，直接创建图片 GenerationJob，不创建 SceneCard；视频计划使用 `scene_card_create` 新建
SceneCard，或使用 `scene_card_replace` 覆盖本轮明确要求修改且唯一 available 的 SceneCardMention。仅把
SceneCard 作为风格或内容参考时仍然新建；零引用只能新建，多个引用或修改意图
不明确时必须先自然语言澄清，并要求 User 只重新引用目标 SceneCard。图片计划不支持覆盖 SceneCard，
视频覆盖不提供另存分支，任何应用都必须由 User 手动触发。
Agent 只能通过本轮已冻结的 SceneCardMention 句柄声明覆盖目标，不能自行填写 SceneCard 身份或版本；
Product API 从引用事实解析目标与基准版本；手动应用不得替换计划卡冻结的目标。
应用覆盖时必须重新比较目标当前版本；版本变化、目标删除或越权均零写入，并要求 User 重新引用当前
SceneCard 生成新的 PlanMessage。成功覆盖复用原 SceneCardNode，既有生成记录与 Asset 保持不变。
`image_generate` 与 `scene_card_create` 可以在同一次 `write_plan_cards` 中混合并原子提交多条 PlanMessage；
每个 `cards[]` 元素独立携带 PlanApplicationKind。`scene_card_replace` 必须独占一次提交且只能包含一张卡，
不能与其他应用类型混合，也不能为同一 SceneCard 创建可被连续应用的多个替代覆盖方案。
本次方案中每张卡的全部必需素材引用都有效时，Agent 才能原子提交整批 PlanMessage；任一必需引用无效时，
不得产生任何 PlanMessage，Agent 必须在 PlanPhase 通过自然语言让 User 移除或替换该引用后重新生成。
模型输出的素材引用只能来自本次已验证可用的引用集合；集合外素材 ID 属于契约错误，整批候选不得展示，
系统应在内部修复或重试，不能把引用幻觉交给 User 处理。
_Avoid_: 生成结果 Card、SceneCard 本体、把所有计划卡都落成 SceneCard、可变草稿、唯一最新版、自动应用、自动改写正文、把素材失效等同于消息失效、部分提交计划卡、静默删除或忽略无效引用、展示含幻觉引用的候选卡

**PlanApplicationKind（计划应用类型）**:
PlanMessage、PlanApplicationReceipt 与应用事件共享的 `application_kind` 判别字段，只允许
`image_generate`（直接生成图片）、`scene_card_create`（新建场景卡并生成视频）或
`scene_card_replace`（覆盖场景卡并生成视频）。只有后两类携带结果 `scene_card_id`，覆盖类还必须绑定
本轮唯一可用的 SceneCardMention。
_Avoid_: 用无媒体语义的 `create` / `replace`；要求图片路径携带 `scene_card_id`；各层使用不同判别词。

**PlanApplicationAvailability（计划应用可用性）**:
系统根据当前资源、权限、额度与模型能力实时形成的 PlanMessage 应用投影，只允许 `available`（可应用）、
`retryable_blocked`（修复后可重试）或 `requires_new_plan`（必须生成新计划）。它不改写 PlanMessage 的
“未应用 / 已应用”持久事实；额度等可修复的零写入失败在修复后可用新 CommandId 重试，素材失效、
SceneCard 版本变化或能力不再支持则必须生成新的 PlanMessage。
_Avoid_: 第三种计划卡生命周期状态、失败时创建 PlanApplicationReceipt、让不可恢复的旧计划继续应用。

**PlanApplicationReceipt（计划应用记录）**:
一次成功应用 PlanMessage 的不可变事实，记录 PlanApplicationKind、内容摘要、应用时间、首次 GenerationJob
与 CommandId；视频路径还记录结果 SceneCard、结果版本、`scene_card_id` 与生成预设摘要，图片路径不携带
`scene_card_id`。它证明正文和完整参数来自被点击的 PlanMessage，不修改 PlanMessage，Canvas 放置也不属于
其成功条件。
应用前必须重新验证冻结素材与生成能力；任一项失效时，图片路径的 PlanApplicationReceipt 与 GenerationJob
全部零写入，视频路径的 SceneCard、SceneCardGenerationPreset、PlanApplicationReceipt 与 GenerationJob
全部零写入，不能静默替换参数或留下半成品。
第一阶段应用以 CommandId 幂等接纳；重复请求只能返回首次创建的同一路径结果与 PlanApplicationReceipt。
Canvas 放置是提交后的可重试第二阶段，不得回滚或重复第一阶段。
每条 PlanMessage 最多只有一次成功应用；成功后不同 CommandId 也不得再次应用。首次 GenerationJob 后续
失败不撤销应用成功，也不恢复计划卡应用入口；后续重试或再次生成必须从应用结果的后续入口发起，不能
重放计划卡应用命令。
_Avoid_: PlanMessage 状态、失败尝试、Canvas 放置记录、用网络响应充当唯一成功证据、部分应用

**CommandId（业务命令身份）**:
写请求使用的稳定幂等键。同一业务操作的网络重试保持同一键和请求内容；Product API 返回首次结果，
不得重复创建消息、任务、Asset 或其他产品事实。网络结果未知时必须复用原键恢复首次结果；已明确零写入
失败且 User 修复阻断条件后，新的手动操作使用新的 CommandId。
_Avoid_: 每次重试换键；把幂等键当资源身份、排序依据或权限凭证。

**GenerationInbox**（生成收件箱）:
每位 User 最多一个活动实例的系统用途 Project（`purpose=generation_inbox`，识别不依赖名称，改名不影响定位）；承载 /generate 页 Agent 对话式创作的 Conversation、AgentRun、GenerationJob 与产出 Asset。
惰性创建：仅打开页面不创建，首条被系统接收的消息原子地查找或创建并持久化；从项目列表隐藏；删除为永久删除——物理移除其对话、生成记录与作品（保留最小审计事件），之后首条消息创建全新实例。
_Avoid_: 把收件箱当作普通 Canvas Project 展示或编辑；通过通用项目端点软删收件箱绕过永久删除；按名称查找收件箱。

**Card 生命周期状态**: `generating` → `normal` | `failed`。
失败后的恢复入口仍在原 Card 上，但后端以关联的新 GenerationJob 执行重试；已提交的生成不提供取消状态。

**User（用户）**:
已完成注册并通过登录建立身份的服务使用者；未注册或未登录者不能使用受保护的产品能力。
一个 User 拥有多个 Project，产品资源与操作均按服务端认证的 User 归属。
_Avoid_: 访客、匿名 User、客户端自报 `userId`、把浏览器本地标识当作身份。

**账户事实（Account Facts）**:
由 new-api 唯一维护的 User 账户信息，包括身份、凭证、资料、角色、quota、订阅、充值与支付；
蓝鲸只通过账户适配接口读取或发起变更，不建立副本或第二套账户权威。
_Avoid_: 蓝鲸用户表、Node 用户账本、双向用户同步、把账户事实复制为产品事实。

**User ID（用户身份）**:
new-api 为 User 分配的稳定整数身份，是蓝鲸产品事实的唯一所有者引用；凭证轮换、用户名或邮箱变化
均不得改变 User ID。
_Avoid_: Token 指纹、用户名、邮箱、浏览器本地 ID、客户端自报且未经验证的 `user_id`。

**默认 API Key（上游执行凭证）**:
new-api 在 User 登录后提供、以 `sk-` 开头的默认 Token，用于 relay 调用、quota 扣减以及由
new-api 解析所属 User ID；上线前所有新 User 在注册事务中必须自动获得一把，创建失败则注册失败。
它是**上游执行凭证**：仅由 BFF 在登录/注册响应时获取、AES-256-GCM 密封后持久化绑定 User，代理
调用 new-api 用户态接口与 relay 扣费，**永不下发浏览器**。它对普通蓝鲸 User 隐藏，但可因安全或
运维原因轮换；登录发现缺失时返回配置错误，不做历史补建。浏览器持有的登录态是独立的「登录会话」，
不是这把 Key。
_Avoid_: 永久用户身份、产品资源所有者 ID、不可轮换密钥、把默认 Key 当浏览器会话凭证。

**登录会话（浏览器会话凭证）**:
BFF 签发的不透明短期会话凭证，是浏览器持有的唯一登录态。BFF 本地校验会话（Redis/DB），
7 天滑动续期、登出吊销；不承载 relay/扣费能力，浏览器永不接触能扣费的凭证。会话与上游默认 Key
相互独立：吊销会话不影响已接纳 GenerationJob，普通登出不轮换上游 Key。
_Avoid_: 把会话当扣费凭证、把默认 Key 当会话凭证、浏览器自造或自报会话。

**产品事实（Product Facts）**:
由蓝鲸唯一维护的 User 产品数据，包括 Project、Canvas、Asset、Conversation 与 GenerationJob；
它们只引用 new-api 的稳定 User ID 作为所有者，不由 new-api 保存或管理。
_Avoid_: 把 Canvas 等产品数据纳入账户中心、在产品表复制用户名、邮箱、quota 或订阅状态。

**认证用户上下文（Authenticated User Context）**:
蓝鲸 BFF 从请求凭证向 new-api 解析得到的可信 User ID 与账户状态；所有受保护的产品操作只使用
该上下文确定所有者，浏览器不提交 `user_id`，蓝鲸也不接受其他客户端身份声明。
_Avoid_: 请求体或查询参数中的 `user_id`、客户端自报所有者、Token 指纹派生身份。

**账户能力（Account Capabilities）**:
new-api 公开配置中蓝鲸已适配并允许 User 使用的登录、注册与验证能力集合；蓝鲸 BFF 只投影该子集，
账户 UI 据此动态展示，不维护第二套功能开关。首版密码登录的同一标识输入同时接受用户名或邮箱。
_Avoid_: 蓝鲸写死认证方式、浏览器直接读取 new-api 地址、展示蓝鲸尚未适配的 new-api 能力。

**登录来源系统（Client System）**:
网关（new-api）按登录请求头 `X-Client-System` 判断请求来自哪个系统（`bluewhale` 蓝鲸 / `api`
控制台），并按账号白名单 `allowed_systems` 校验该来源是否被允许登录；只拦登录，不拦 API 调用，
已登录会话不追溯。BFF 在出站统一注入 `X-Client-System: bluewhale`，因此蓝鲸登录/注册天然归属
`bluewhale`，网关默认值/白名单校验无需逐个接口对齐。缺失或未知头按 `api` 处理。
_Avoid_: 把来源系统当作用户身份、在浏览器侧附加该头、按来源系统区分已登录会话权限、把白名单拒绝
误报为「登录凭证无效」。

**ContentReview（内容审核）**:
Product API 对产品策略纳入审核范围的内容形成的安全决定；普通用户文字消息和提示词不做
独立前置审核，Agent 或生成供应商的安全结果可以成为后续 ReviewEvidence。受审内容可以复用匹配的
既有结果或依据充分的证据，不要求人工逐条审批，也不等于每次都调用外部审核服务。
内容决定只有 `pass` 或 `reject`；超时、不可用或无效证据属于审核运行故障，不得伪装成内容拒绝。
审核明确通过后才可发布用户可见结果；审核无法形成决定时本次操作失败，由 User 重试。
_Avoid_: 人工审核、把供应商审核结果直接当作产品权威、把产品决定理解为全量外部调用、审核不可用时默认通过。

**ReviewEvidence（审核证据）**:
Product API 形成 ContentReview 时采用的可验证事实，包括匹配内容与策略版本的既有决定、
专用审核服务结果或生成供应商自带审核结果；证据本身不授予内容通过资格。产品只持久化最小化、
可追溯的证据引用和规范化字段，不保存供应商完整响应、命中原文或额外内容副本。
_Avoid_: 审核决定、把任一供应商证据直接当作放行结果、把供应商原始响应当作长期证据存档。

**OutputReleaseGate（输出释放门）**:
Product API 在 Agent 文字变为 User 可见内容前形成的产品安全边界；供应商证据覆盖待释放前缀时
可以流式释放，否则必须缓冲完整回复并在 ContentReview 明确通过后整体释放。
完整回复的专用审核总预算为 5 秒；无法形成决定时丢弃未释放文字并返回安全错误，不进入后台审核。
_Avoid_: 供应商直接向 User 流式输出、把流式安全信号直接当作产品决定、逐片调用外部审核服务。

**Asset（资产）**:
一个必须归属 Project 的图片、视频或音频文件单元，媒体内容身份不可变，由产品控制的对象存储持久化。
对象永久私有；访问 URL 仅在服务端确认当前 User 有权访问所属 Project 与 Asset 后临时签发，
不构成 Asset 身份或长期地址。
开发测试首版不对用户上传的 Asset 执行蓝鲸产品级 ContentReview；上传并持久化成功后即可使用。
编辑或换源会创建新 Asset，但同样不因上传来源触发产品级审核。用户上传内容审核属于独立的生产上线
阻断决策；该决策完成前，开发测试链路不得被宣称已取得生产上线许可。
供应商生成结果只有在 Product API 依据充分 ReviewEvidence 明确通过后才成为 Asset，继而
可见、可下载或可作为后续输入；证据不足时只对该结果调用一次专用审核服务。
**同一 Asset 可被多个消费者引用** —— Card 可以把它投影到对话流；一个或多个独立 asset NodeItem
可以引用它并由 Canvas 布局放置。Card 不是产品资源，NodeItem 是 Product API 管理的 Project 资源。
既包含用户上传的素材（作为生成输入）,也包含生成产出的结果（作为输出）,
二者是同一种 Asset,以来源属性区分。
重生成、编辑、换源或生成衍生版本时创建带来源关系的新 Asset，再切换视图引用；
名称、标签等元数据可修改，访问 URL 可重新签发，但不改变 Asset 身份。
_Avoid_: 把 Asset、NodeItem 与 Card 混为一谈 —— Asset 是文件实体，NodeItem 是引用 Asset 的
Project 资源，Card 是可重建的界面投影；在同一个 assetId 下覆写媒体内容。

**AssetMention（@ 引用）**:
用户消息对一个 Asset 的结构化引用，在 AgentChatPanel 输入器中以 pill 形态承载 assetId，
消息文本中呈现为 `@[name]`。Canvas 选中、上传完成或查看历史消息本身都不构成引用；“添加到对话”、
素材选择与显式重新引用只会把 pill 放入输入器，不自动发送。只有 User 发送时仍在输入器内的 pill
才与本条 UserMessage 一起接纳；历史对象必须重新插入 pill，不能从名称、近期对象、Canvas 当前选区
或上一轮引用形成隐式绑定。发送时任一引用无效则 UserMessage、全部引用与 AgentRun 全部零写入，
输入器保留草稿并要求 User 移除或重新引用，禁止静默过滤有效子集。经过认证的 UserMessage 命令是
显式引用的唯一权威；Product API 在同一事务中解析目标、校验权限并分配服务端引用身份，命令幂等摘要
包含正文与完整有序引用。客户端上报的输入器选择、添加到对话或重新引用来源只作分析提示，不构成权限证明。
它是消息事实的一部分，随消息落定即不可变、无失效语义，
Asset 后续状态变化由 MentionAvailability 动态解析，不改写引用事实。
只有本轮冻结输入 UserMessage 上的 AssetMention 构成 AgentRun 的 Asset 读取放行来源；历史消息中的
引用继续作为不可变对话事实展示，但不会自动延续读取权限。Agent 获得本轮有序引用列表并据此精确
读取对应 Asset；跨 Project、跨 User 或非 normal 状态的读取一律同构拒绝。
_Avoid_: 把 @ 引用当作无 assetId 的纯文本提及；把 @ 引用与画布选中、生成参考图输入混为一谈；
把历史引用当作本轮读取授权；用名称或近期对象猜测引用。

**AssetContextProjection（素材上下文投影）**:
系统从本轮有效 AssetMention 确定性形成、获准供模型读取的受限素材视图；只包含素材身份、媒体类型、
显示名称、尺寸或时长，以及可信的图片理解、视频理解或音频转写。媒体原内容只能通过 read_asset
按 AssetMention 身份读取，模型不能直接填写 assetId；投影不得暴露对象存储路径、永久访问地址或
所有者资料。
_Avoid_: 原始 Asset 记录；永久签名地址；客户端拼装的分析结果；以 assetId 绕过 AssetMention

**SceneCardMention（@ 场景卡引用）**:
User 提交消息时对一张 SceneCard 的结构化引用，冻结其当时的身份、内容版本、显示摘要与 Markdown，
作为本轮 Agent 输入及历史证据。Canvas 选中本身不构成引用；只有发送时仍在输入器内的引用 pill
才与本条 UserMessage 一起接纳，历史 SceneCard 必须由 User 显式重新引用；发送时版本已变化、对象
已删除或权限失效时整条消息零写入，输入器保留草稿并要求移除或重新引用。后续 SceneCard 修改或
删除不得使该引用漂移，Agent 也不得从名称、近期对象、Canvas 当前选区或上一轮引用猜测绑定。
引用身份只能由 Product API 在接纳经过认证的 UserMessage 命令时分配；模型与 Worker 不具备创建
UserMessage 或伪造 SceneCardMention 的能力。
_Avoid_: 始终指向最新版的活动引用、SceneCard 版本历史、用旧引用读取后来内容、AssetMention、
把历史引用当作本轮覆盖目标

**SceneCardContextProjection（场景卡上下文投影）**:
系统从本轮有效 SceneCardMention 形成的冻结模型视图，只包含 SceneCard 身份、基准版本、标题、摘要与
完整 Markdown；不读取后来版本，也不包含 Canvas 布局、GenerationJob 或生成历史。
_Avoid_: SceneCard 最新版活动视图；SceneCardNode；生成记录；布局副本

**MentionAvailability（引用可用性）**:
系统在每次 Agent 推进或恢复读取引用时形成的当前可读性判断，不是 AssetMention 或 SceneCardMention
自身的生命周期状态。`available` 允许模型读取受限内容投影；`stale` 只用于 SceneCard 基准版本已变化，
允许模型读取冻结旧内容作为历史证据，但禁止绑定为覆盖目标；`unavailable` 用于对象删除、权限撤销、
归属不符或其他读取闸门失败，只向模型暴露不可用占位事实，不暴露素材、分析结果或 SceneCard 正文。
刷新、重连与恢复会重新解析当前可用性，但历史 UserMessage 中的引用事实始终不变。SceneCard 出现
新版本只形成 stale，不改变同一次推进已冻结的内容；对象删除、权限撤销或归属失效形成 unavailable，
并立即阻止该快照继续用于新的模型调用、结果重放或 RunCommit。
_Avoid_: 改写或删除历史引用；把 stale 当作最新版；让 unavailable 引用继续授予模型读取权限

**MentionInputSnapshot（引用输入快照）**:
Agent 每次开始推进时，基于本轮 UserMessage 的有序引用事实、当前 MentionAvailability 与实时权限校验，
冻结的不可变模型输入边界；它只包含本次获准供模型读取的受限内容投影及摘要。同一次推进发生进程接管、
断线重连或恢复时，在对象仍存在且权限仍有效的前提下必须复用原快照，不能重新读取出不同内容；新的推进
重新校验并形成新快照。任何新的模型调用、结果重放或 RunCommit 前都要重查硬权限闸门；对象删除或权限
撤销时保留快照作为历史执行证据，但禁止继续消费，未提交的临时结果丢弃并等待 User 移除或重新引用。
页面刷新只能从 Product API 保存的 UserMessage 与引用事实重建，不得信任输入器 DOM、浏览器缓存或
客户端自报的对象身份与版本。
_Avoid_: AgentRun 的可变上下文包；恢复时重新读取最新版；权限撤销后继续消费快照；浏览器生成的权限证明；
把权限证据当永久授权

### 素材库（Material Library）

> 素材库是上游网关（blue-whale-api，new-api 二开）对外提供的**共享、单租户**素材资源能力，
> 透明反向代理 ai-tokenhub 素材库 API（火山 ARK 兼容接口）。指标与术语与网关仓同源；
> 本仓只对接，不改上游。素材库概念**必须带「素材库 / 素材组」前缀**，本仓裸「素材」仍指 Asset。

**素材库（material library）**:
网关对外暴露的素材资源能力集；凭证（AK/SK）配置在网关侧，下游客户端不持有。本仓产品经
`POST /api/material/{Action}` 透传调用，归属与状态以网关/上游为权威，本地零落表。
_Avoid_: 渠道（它不提供模型请求）、本仓落库镜像、把素材库素材当成 Product Fact

**素材组（material group）**:
按「真人主体/虚拟人像」划分的资源集合，上游称 seedance asset group；一个真人素材组只对应
一个真人主体。素材 ID 形如 `group-...`。
_Avoid_: 素材库（组是其中的一个集合）、Project、Canvas 概念

**真人素材组（LivenessFace group）**:
需真人通过火山 H5 刷脸认证才能启用的素材组；认证经 `CreateVisualValidateSession` 发起，
本产品可通过透传 API 创建会话拿 H5Link、轮询 `GetVisualValidateResult` 领组，认证数据与
回调全由网关维护，**不暴露自定义 CallbackURL**。
_Avoid_: 人脸组、把认证会话数据处理成本仓产品事实

**虚拟素材组（AIGC group）**:
同步创建即用、无需认证的素材组（`CreateAssetGroup`，`GroupType: AIGC`）。
_Avoid_: 虚拟组、真人素材组

**素材（material）**:
素材组下的单个图片/视频/音频；生成任务以 `asset://<素材ID>` 引用它，经 `ListAssets` 按组查询。
素材 ID 形如 `Asset-...`。
_Avoid_: 文件、附件、Asset（本仓的 Project 文件单元）

**素材状态**:
`Active`（就绪）、`Processing`（处理中）、`Failed`（失败）。状态以上游为准，本地不镜像。
_Avoid_: 状态码、本仓持久化状态

**素材引用（MaterialReference）**:
视频生成输入里对素材库素材的引用；创建生成任务时由调用方声明 `{ id, type: "image"|"video" }`
（素材零落表，类型无处可查，只能随请求携带），Worker 转成 `asset://<素材ID>` 载体交给生成
供应商。只做格式校验（`Asset-` 前缀），存在性/状态/物理约束由上游强校验。
它是 `generation_jobs.input` 冻结的引用快照，不是独立生命周期资源。
_Avoid_: PlanMessage 的 `asset://<mention_id>`（那是内部正文引用协议）、把素材引用当 AssetMention

**`asset://` 双义隔离**:
`asset://<mention_id>` 只出现在 PlanMessage 正文，是服务端解析的内部素材引用协议；
`asset://<素材ID>` 只出现在提交给生成供应商的请求（`metadata.content` 的 `url` 字段），是
火山 ARK 原生素材载体。两者同形不同义、永不互串；本期只接后者（生成链路），不碰前者。
_Avoid_: 把素材库素材引用写进 PlanMessage 正文、把 PlanMessage mention 协议原样发给供应商

**GenerationJob（生成任务）**:
一次持久化的图片、视频或音频后台任务。任务归属于 Project，页面刷新、浏览器关闭或服务重启后，
已接纳状态与结果仍可恢复；同一请求或供应商回调重放不得产生重复任务、结果或费用。
GenerationJob 可以随业务事务原子创建，但只能在事务提交后进入执行队列；事务内禁止直接调用生成供应商。
Worker 通过短租约领取任务；租约过期后可由新 Worker 重新领取，旧 Worker 的迟到写入由 fence 拒绝。
外部调用结果无法确认时任务明确失败，由 User 在原 Card 上手动重试，不建设自动核对系统。
任务一经接纳即运行到全部成功、部分完成或全部失败；关闭面板、切换页面或退出 Project 均不取消任务。
_Avoid_: 把 Job 与 Card、NodeItem 或 Asset 混为一谈；用内存状态作为任务权威；提供取消按钮或取消状态；自动复活终态任务。

**GenerationRecipe（生成配方）**:
Web 从图片 GenerationJob 冻结的提示词、模型、参数与素材输入派生的只读 BottomDock 回填投影；它不是独立
资源或持久预设。User 修改回填值只形成本地草稿，提交后创建新 GenerationJob，不改写原 PlanMessage、任务或 Asset。
_Avoid_: 图片持久预设、NodeItem 权威参数、修改历史任务、把再次生成当作重试

**GenerationOutputSlot（生成输出槽）**:
GenerationJob 创建时固定的输出位置，用于让多输出任务稳定关联 Card、审核结果与 Asset。
重试可以关联原输出槽，但必须创建新的 GenerationJob；成功结果不得被后续重试覆盖。
_Avoid_: 运行中增删或重排槽位；由 Web 猜测结果映射；在同一槽位发布多个 Asset。

**Agent（创作编排者）**:
面向 User 的创作协作者，负责持续对齐需求、澄清预期并生成或迭代 PlanMessage；
它唯一可提交的产品写入提议是通过 `write_plan_cards` 暂存完整候选；素材只能通过 `read_asset` 按
AssetMention 身份读取，运行资源只能按 Product API 下发的固定资源身份读取。它不拥有 Canvas 状态，
不能直接创建或修改 SceneCard、GenerationJob、Canvas，也不执行图片和视频生成；User 手动应用
PlanMessage 是独立 Product API 命令，不属于 Agent 工具。
_Avoid_: AgentChatPanel、画布状态所有者、SceneCard 创建方、GenerationJob 发起方、媒体生成执行器；
访问原始数据库、文件路径、网络地址或原始产品资源身份。

**AgentRun（创作运行）**:
围绕 Conversation 中一个创作目标推进的持久工作单元，跨越需求澄清、最终确认与 PlanMessage 提交，
并可包含多个先后发生的 AgentAdvance。已接纳消息与用户可见结果由 Product API 保存；Worker 崩溃后
可以按当前权威状态重新领取，旧 Worker 不得覆盖新结果。单次 AgentAdvance 的模型结果无法确认时，
AgentRun 进入 `awaiting_retry`（等待重试），不自动再次调用模型；User 手动重试会在同一 AgentRun
创建新的 AgentAdvance。User 对当前澄清或最终确认请求的回答继续同一 AgentRun，并创建下一次
AgentAdvance，不为每条回答新建 AgentRun。完成、不可恢复失败或取消后不自动重开；后续新的创作目标
由 Product API 创建新的 AgentRun。
_Avoid_: 把每条网络请求或模型调用当作独立 AgentRun；从 Worker 本地状态推导产品终态；
为结果不明建设自动迟到证据收敛。

**AgentAdvance（智能体推进）**:
AgentRun 内一次冻结输入的执行轮次。Product API 在开始时固定本轮有序消息输入与 MentionInputSnapshot；
新到消息只能等待后续推进。Worker 租约接管必须继续同一推进，不能创建新的运行事实或改变冻结输入。
已持久化完整模型结果时可以直接复用；只有部分文本或调用结果不明时必须清除临时文本并等待 User
手动重试，禁止租约接管自动再次调用模型。每个 AgentAdvance 最多成功执行一次 RunCommit；同一个
AgentRun 可以随多个 AgentAdvance 产生多次 RunCommit。
_Avoid_: 每次 Worker 领取都新建推进；运行中追加消息或引用；把 AgentAdvance 当作独立 Conversation 或 AgentRun；
在结果不明时自动重调模型。

**RunCommit（运行提交）**:
Product API 对单个 AgentAdvance 的唯一正式接纳边界；每次推进最多成功一次，可原子接纳一条正式
AssistantMessage，或一组完整有序的 PlanMessage。同一 AgentRun 可随多次推进拥有多个 RunCommit，
精确重放必须返回该推进首次接纳的相同结果。
_Avoid_: 按 AgentRun 限制只能提交一次；跨 AgentAdvance 拼接结果；把临时交付文本当作正式提交。

### Agent 运行配置

**AgentRuntimeManifest（智能体运行清单）**:
随应用发布候选交付并在启动时完整校验的只读运行配置，确定角色文档、规则集、运行时技能、允许的模型与
工具，以及全部运行资源身份和内容摘要。它只作为 Product API 创建 RunPin 的来源，不提供在线草稿、发布、
导入、导出或回滚管理能力。
_Avoid_: Runtime Agent Bundle、BundleDraft、BundleVersion、运行时查询 latest、把 Creative Skill 纳入清单。

**RunPin（运行版本快照）**:
Product API 在创建 AgentRun 时从 AgentRuntimeManifest 复制的自包含不可变快照，冻结提示资源与摘要、
ModelProfile、RuntimeBudgetPolicy、ToolGrant，以及本次运行采用的 Creative Skill 版本事实。Worker 恢复时
只消费该快照，不查询最新配置或依赖已退役的运行包平台。
_Avoid_: BundleVersion、可变版本引用、独立改写快照、Worker 回显拼装、把尚未接纳的 `auto` Activation 当作既成事实。

**RoleDocument（角色文档）**:
定义内部 Agent 身份、职责和任务边界的根 Markdown 资源；每份 AgentRuntimeManifest 恰好引用一个并始终装载。
_Avoid_: Rule、Runtime Skill、面向 User 的角色模板。

**Rule（运行时规则）**:
约束 Agent 行为的一条版本化 Markdown 资源，只能按 `always_on` 或 `on_demand` 装载，不能授予或放宽平台权限、安全、成本与状态铁闸。
_Avoid_: 平台铁闸、Creative Skill、散落在代码中的提示词分支。

**RuleSet（规则集）**:
AgentRuntimeManifest 中按确定顺序生效的 Rule 引用集合；冲突 Rule 必须在构建校验时消解，不能依赖后写覆盖。
_Avoid_: 无序标签集合、运行时临时拼接的提示词。

**Runtime Skill（运行时技能）**:
平台内部、由 AgentRuntimeManifest 定位并随 RunPin 冻结的 Agent 工作流资源；初始只披露元数据，正文与
引用资源在选择后按需装载。
_Avoid_: Creative Skill、数据库 `skill` 表的用户内容、硬编码 Orchestrator 分支。

**Creative Skill（创作技能）**:
User 可见、可通过 `Use` 或 `auto` 激活的版本化创作方法；与 Runtime Skill 共用 Markdown 包形态，但生命周期、权限和发布边界独立。其选择、候选、接纳与按需读取的跨服务字段冻结于 `docs/specs/2026-07-24-creative-skill-activation-contract.md`。
_Avoid_: Runtime Skill、内部 Rule、无修饰的“Skill”（在运行时契约中必须指明类型）。

**Creative Skill Name Key（创作技能名称键）**:
Creative Skill 原始名称经过去除首尾空格、合并连续空格、Unicode 规范化与英文大小写折叠后得到的唯一性比较值；重名校验使用该键，界面仍展示原始名称。它不承担运行时调用，调用始终使用稳定 Creative Skill ID。
_Avoid_: 显示名称、Creative Skill ID、逐字符区分大小写的重名判断

**Official Creative Skill（官方创作技能）**:
平台维护并发布的预配置 Creative Skill；其名称在 Creative Skill Library 内全局唯一。其 `SKILL.md` 正文、提示词与内部规则属于平台商业机密，只能由运行时消费。User 只能看到平台批准公开的封面、名称与简介，并可引用、`Use` 或开启 `auto`；不能查看详情、读取或导出正文、修改、删除或发布其内容。
_Avoid_: 公共 Skill、社区 Skill、用户模板、官方技能重名、向 User 暴露正文

**Personal Creative Skill（个人创作技能）**:
由一个 User 创建并独占的私人 Creative Skill 资产；其名称在所属 User 的个人技能范围内唯一，不同 User 可以使用相同名称且互不可见。现有 Official Creative Skill 名称属于保留名称，个人技能在创建或上传时发生冲突必须阻止保存并要求修改 `name`。它始终归属于该 User，与 Official Creative Skill 完全隔离且禁止进入 Creative Skill Library。卡片封面由系统根据技能名称生成稳定的像素马赛克默认配图（6×6 深青/紫/珊瑚红拼块、无字母），不调用生图模型，也不要求 User 上传封面。User 可以从个人技能卡片打开只读详情、查看自己保存的完整 `SKILL.md`，并一键复制完整 Markdown 到剪贴板，但系统不提供文件下载；已接纳内容不可原地编辑或修改。每次重新上传均创建身份独立的新 Personal Creative Skill，旧技能保持不变并可与新技能同时存在。User 删除它时，系统必须先显示包含技能名称以及“永久删除、无法恢复、内容将不可访问”警告的确认框；确认后删除的是该个人资产本身，而非个人集合中的引用关系。删除后内容不可查看、复制或再次使用，既有 AgentRun 仅保留“曾使用已删除技能”的最小事实。
_Avoid_: 自定义官方技能、待发布技能、社区技能、同一 User 的个人技能重名、与现有官方技能重名、跨 User 泄露名称占用、原地更新版本、把只读详情当作编辑器、文件下载、AI 生图封面、User 上传封面

**Creative Skill Library（官方创作技能库）**:
平台唯一维护、只收录 Official Creative Skill 的可发现目录；User 可以使用其中内容，但不能向其中添加、发布、修改或删除 Creative Skill。本期范围只包含用户端目录与必要数据能力，不建设官方技能管理界面；官方内容通过后台配置或数据脚本维护。每个 Official Creative Skill 必须且只能归属 `影视`、`营销`、`其他` 中的一个分类，`全部` 仅为三个分类的聚合视图。目录支持 `精选`、`最多使用`、`最新发布` 三种排序，默认使用 `精选`；`精选` 顺序由官方后台为技能配置的人工权重决定。
官方技能名称与简介跟随界面语言展示后台本地化文案，缺少对应翻译时回退英文。所有官方技能卡片统一展示固定署名 `@Blue Whale`，不支持单技能作者配置。卡片本身不可点击，不提供详情页或 `…` 菜单，只保留 `直接使用` 与 `添加/已添加` 两类操作；卡片简介按布局截断，User 悬停简介时通过浮层查看完整公开简介。搜索只在 User 点击“搜索”或按 Enter 后执行，输入过程不实时刷新结果；匹配范围为本地化技能名称、简介和官方后台配置的搜索关键词，不检索完整 `SKILL.md` 正文。搜索保留当前分类与排序，只在当前分类内匹配，并按当前排序展示结果。卡片列表在弹窗内部连续滚动，接近底部时自动加载下一批，不显示分页控件。
_Avoid_: 用户技能市场、社区技能库、Personal Creative Skill 目录、官方技能管理界面、多分类重复归属、技能详情页、无用途菜单、输入即搜索、正文全文搜索、搜索时重置筛选、页码分页

**Official Creative Skill User Count（官方创作技能使用人数）**:
至少有一个 AgentRun 已接纳该 Official Creative Skill 激活记录的去重 User 数；同一 User 重复 `Use` 或通过 `auto` 激活只计一次。卡片公开展示该聚合数字，`最多使用` 按它降序排列。
_Avoid_: 激活累计次数、添加人数、仅统计成功完成的生成任务

**My Creative Skills（我的创作技能）**:
User 的统一技能使用集合，同时展示其从 Creative Skill Library 添加的 Official Creative Skill 与其拥有的 Personal Creative Skill；每张卡片明确显示 `官方` 或 `个人` 来源标签。默认按加入集合的时间倒序排列，新添加的官方技能和新创建的个人技能均排在最前。当前版本不提供搜索、分类筛选或排序控件。两类技能均通过相同的卡片控件支持 `Use` 与 `auto`，新添加或新创建时 `auto` 默认关闭；User 可以同时开启多个技能进入自动候选，但每次 Agent 请求最多自动激活其中一个最匹配技能。悬停卡片时在封面左上角浮现 `…` 菜单：官方技能只显示“移出我的技能”，个人技能只显示“删除技能”。卡片列表在弹窗内部连续滚动，接近底部时自动加载下一批，不显示分页控件。统一展示与使用能力不改变两类技能的权威归属与隔离边界。
_Avoid_: Creative Skill Library、公开技能页、官方技能后台、把破坏性操作放在主按钮区、搜索框、筛选控件、排序控件、页码分页

**Creative Skill Panel（创作技能面板）**:
承载 My Creative Skills、Creative Skill Library 与创建技能三个顶层标签的居中模态界面；每次打开都默认进入 Creative Skill Library，不记忆上次关闭时的标签。弹窗保持打开时，切换标签必须保留各页的搜索词、分类、排序、滚动位置与创建草稿；关闭后清除这些会话内状态，重新打开恢复默认。桌面端宽高随视口扩展但不超过 `1600×900` 上限（四周至少保留约 `32px`），内容在面板内部滚动。技能卡片为左封面右内容的横版卡片，栅格随可用宽度在宽屏展示三列、中屏展示两列、窄屏展示单列，任何尺寸都不产生横向滚动；悬停卡片时简介全文以向下展开的浮层呈现。User 可以通过右上角关闭按钮、Esc 或点击遮罩层关闭；存在未保存草稿时，任一关闭方式都必须先确认放弃。打开期间焦点锁定在面板内、背景不可交互，关闭后焦点返回技能入口。
_Avoid_: 独立页面、小型固定尺寸弹窗、固定三列、横向滚动、页面背景滚动、无提示丢弃草稿、焦点逃逸

**Conversation-Summarized Personal Skill（对话总结个人技能）**:
User 从创建技能入口发起、由 Agent 基于当前 Conversation 的多轮创作信息总结生成并保存到 My Creative Skills 的 Personal Creative Skill；入口始终可用，不由前端按消息数或 AgentRun 状态禁用。入口关闭技能弹窗并把固定请求预填至 AgentChatPanel 输入框，User 检查或修改后主动发送，系统不得自动提交；内容是否足够形成可复用技能由 Agent 判断。内容不足时不得创建技能，Agent 必须在对话中说明缺少的可复用信息并请求 User 补充。User 发送包含保存意图的请求即构成创建授权；内容充分且名称唯一时，Agent 总结完成后直接创建个人技能并在对话中返回保存成功的技能结果，不再要求二次确认。生成名称发生冲突时不得保存，Agent 必须提议新的唯一名称并等待 User 确认，确认后再创建。生成过程发生在 Agent 对话中，不是在创建技能弹窗内直接产出本地草稿。
_Avoid_: 官方技能、内容不足仍保存、名称冲突时自动追加后缀、前端按对话长度禁用入口、弹窗内 AI 格式化、自动发送请求、正常路径保存前二次确认、自动进入 Creative Skill Library

**Manual Personal Skill Creation（手动创建个人技能）**:
User 在创建技能页通过两个独立模式准备 Personal Creative Skill：`编写 SKILL.md` 提供可编辑的 Markdown 草稿与 AI 格式化入口，`上传 SKILL.md` 提供选择或拖拽单个 `.md` 文件的上传区。文件选中并校验后仍停留在上传模式，只显示文件名与校验结果，不加载到编写编辑器。弹窗保持打开时，切换顶层标签或手动创建模式必须保留未保存草稿；关闭弹窗时必须确认是否放弃，确认后清除草稿，系统不做服务端自动保存。两种模式都必须由 User 点击“保存到我的技能”后才创建不可编辑的个人技能；保存前必须通过 `.md` 文件类型、合法 YAML frontmatter、非空 `name`、非空 `description` 与非空正文校验，失败时阻止保存并指出具体错误。保存成功后自动切换到 My Creative Skills，新技能置顶并显示成功提示。
_Avoid_: 上传后立即创建、上传后切换到编写编辑器、切换标签丢失草稿、服务端自动保存、把上传区与编写区视为同一个初始界面、保存后继续编辑、由系统猜测缺失字段

**AI Skill Formatter（技能 AI 格式化工具）**:
Manual Personal Skill Creation 的编写模式内由 User 按需触发的小型 AI 辅助工具；它按平台后台配置、对 User 固定呈现的一套格式规则润色并规范当前 `SKILL.md` 草稿。格式化结果直接替换编辑器中的当前草稿，User 可以继续手动修改；它不进入 Agent 对话、不创建 Personal Creative Skill，也不自动保存。
_Avoid_: Conversation-Summarized Personal Skill、User 自定义格式模板、自动触发、应用前二次确认、保存动作

**Official Creative Skill Addition（官方创作技能添加关系）**:
User 对某个 Official Creative Skill 建立的个人可用关系，使它出现在 My Creative Skills 中并具备开启 `auto` 的资格；该关系不复制官方内容或转移所有权。User 无需建立该关系即可从 Creative Skill Library `Use` 一次，单次使用只作用于下一次 Agent 请求，不会自动添加技能或开启 `auto`。如果 User 已有同名 Personal Creative Skill，则阻止建立该关系，直到 User 删除并以其他名称重新创建个人技能；冲突期间仍允许从 Creative Skill Library 单次 `Use` 官方技能。关系建立后继续停留在 Creative Skill Library，卡片的“添加”变为不可点击的“已添加”状态并显示成功提示；移除只能从 My Creative Skills 发起。后续创建的 AgentRun 使用当时生效的官方发布版本，既有 AgentRun 继续保持其 RunPin。User 从 My Creative Skills 移除它时只删除该关系，操作立即执行且不要求二次确认，完成后显示成功提示；Official Creative Skill 继续保留在 Creative Skill Library，仍可再次单次使用或重新添加。
_Avoid_: 直接使用即自动添加、点击“已添加”移除、同名冲突时仍添加、冻结副本、个人所有权、独立发布分支

**Direct Creative Skill Use（直接使用创作技能）**:
User 从 Creative Skill Library 或 My Creative Skills 为下一次 Agent 请求选择一个 Creative Skill 的一次性操作；选择后技能弹窗关闭，AgentChatPanel 输入框显示可移除的技能标签，User 补充需求并主动发送后才创建带 `forced_use` 的 AgentRun。`forced_use` 是该次请求唯一激活的 Creative Skill，User 的明确选择覆盖并跳过 `auto` 判断。它不自动发送、不建立 Official Creative Skill Addition，也不改变 `auto`。
_Avoid_: 立即启动 Agent、多次持续生效、与 `auto` 竞争、自动添加、自动开启

**CreativeSkillActivation（创作技能激活记录）**:
AgentRun 所属、可审计且不可变的 Creative Skill 版本选择事实，记录来源与结构化原因；`forced_use`
在创建时接纳，`auto` 只在 Product API 接纳本轮结果时落定。内部保留激活来源以支持正确判断与审计；User 只在 AgentRun 运行状态中看到统一的“使用技能：技能名称”标签，不区分自动或直接，Agent 回复正文不重复展示，也不披露技能正文。
_Avoid_: `activations[]`、独立 `activate` 写接口、普通 metadata、AgentActionProposal、多 Creative Skill 组合、运行中切换版本、自由文本理由。

**AutoCreativeSkillCandidate（自动候选）**:
AgentRun 创建时冻结的不可变 Creative Skill 自动激活资格池；资格不表示当前意图匹配，Runtime 只能
从中选择零个或一个。
_Avoid_: Worker 发明候选外 Creative Skill、把非空资格池当作强制激活、候选随 Creative Skill Library 发布漂移、候选携带正文、要求先持久化 Activation 才能读取候选正文。

**ModelProfile（模型档案）**:
平台批准并由 AgentRun 固定的版本化模型能力、上下文上限与 tokenizer / 计量身份；不承载凭据或
供应商私有请求对象。
_Avoid_: API Key、动态价格目录、模型供应商原始配置、用通用字符估算冒充所有模型的精确 token 数、流中断且 usage 缺失时按零消耗。

**Agent 推理模型（Agent Reasoning Model）**:
驱动 AgentChatPanel 对话编排（respond / clarify / cancel / submit_plan）的大模型，经 ModelProfile
钉入 RunPin，由 agent-worker 装配适配器调用。它与 `generation_model_capability` 的 text 档位
（TextCompletion 文生文白名单通道）是两条独立链路，互不复用。
_Avoid_: 文本补全模型、文生文模型、把 Agent 推理与 TextCompletion 混为一条链路

**MiniMax-M3**:
当前唯一已接入的真实 Agent 推理模型，模型 ID `MiniMax-M3`，ModelProfile 为 `newapi.minimax_m3`，
经 new-api 网关（blue-whale-api）OpenAI 兼容通道调用，由 `AGENT_RUNTIME_MODE=real` 启用。
_Avoid_: AM3、MiniMax AM3（错误叫法）、直连 MiniMax 官方 API

**RuntimeBudgetPolicy（运行预算策略）**:
Product API 为 AgentRun 固定的 Provider 调用、上下文与成本硬限制；Worker 只能在其范围内执行。
_Avoid_: Worker 重启后计数归零；把本地计数当权威；用户确认后突破系统硬限制。

**ToolGrant（工具授权声明）**:
AgentRuntimeManifest 对平台工具注册表的版本化允许子集，只赋予 Agent 提议动作的资格；每次副作用仍由 Product API 确定性接纳。
_Avoid_: 已授权命令、模型输出即执行、绕过 GenerationAuthorizationGate。

**ToolDefinition（工具定义）**:
平台以程序注册表（ToolRegistry）代码注册的 Agent 可提议工具，是发布期 ToolGrant 校验的运行时权威。每项含稳定 `tool_id`（`^[a-z][a-z0-9_.-]{0,127}$`）、递增 `registry_version`、`effect`（read / side_effect）、`risk_level`、输入 / 输出 Draft 2020-12 JSON Schema（禁 `$ref`）、平台静态约束上界 `constraints`，以及所需模型能力与生图能力类型（对接 `generation_model_capability`）。
_Avoid_: 配置字符串、含 `$ref` 的 Schema、在 ToolGrant 里携带 risk_level。

**ToolRegistry（工具注册表）**:
平台 Agent 可提议动作的程序注册目录，以 `tool_id + registry_version` 为主键查询，取代退役的 `approved-tool-contracts` 配置字符串；发布快照固化所引用工具的 `registry_version`，运行中 AgentRun 不因注册表后续变更漂移。它是 Agent 可提议动作的目录，不是 ADR-0038 按 mode 装配的生图 Provider Registry。
_Avoid_: 把它当成生图 Provider Registry、当成可热插拔配置、以为生产空配置等于一切被拒（该缺口已随配置形态退役闭环）。

**RiskLevel（工具风险等级）**:
ToolDefinition 的注册表侧属性（`low` / `medium` / `high`），用于运行期接纳策略与审计；ToolGrant 只引用工具不携带风险等级，发布期 grant 校验不读它。
_Avoid_: 在 ToolGrant 里携带风险等级、把风险等级当作发布期铁闸。

**ResourceManifest（资源清单）**:
AgentRuntimeManifest 内所有资源身份、版本、内容摘要、装载方式与已解析引用的不可变索引，是构建校验与
RunPin 复现的依据。
_Avoid_: 可变文件目录、网络资源目录、未校验的相对路径列表、在线导入导出载荷。

**ReadEvidence（资源读取证据）**:
Worker 单次资源读取的最小证据（资源身份、版本、内容摘要与来源），用于确认运行时读取的是已固定资源；
不要求在 IK3UUX 中建设独立证据存储或长期生命周期。
_Avoid_: 资源正文、私有文件路径、RunPin / ModelProfile / CreativeSkill 回显。

### Agent 运行机制

**AgentRunLease（运行租约）**:
Product API 向一个 Worker 发放的短期执行权。租约过期后任务可以被重新领取；每次领取更新 fence，
旧 Worker 的迟到提交必须被拒绝。租约过期只表示执行权失效，不直接等于 AgentRun 失败或取消。
_Avoid_: 长驻 Run Actor；用 Worker 本地锁代替权威租约；允许旧 Worker 覆盖新结果。

**AgentActionProposal（Agent 动作提议）**:
Agent 基于当前意图提出的业务动作建议，不是命令或授权；Product API 仍负责权限、额度与幂等接纳。
_Avoid_: 把模型输出直接当作已执行命令；为单次使用预建通用工作流协议。

**CostReservation（成本预留）**:
产品控制面在可能计费的供应商调用前保留的成本额度，并按实际结果结算或释放。
_Avoid_: 重试复用结果不明的预留；usage 缺失时按零成本；把成本预留当作支付订单。

**AuditRecord（审计记录）**:
用于记录必要安全、成本与管理决定的最小事实；它与产品事件和普通运行日志分离，
不保存原始用户内容、供应商完整响应或凭据。
_Avoid_: 把 AuditRecord 当作产品事件、调试日志或原始提示词存档。

**GenerationAuthorizationGate（生成授权门）**:
Product API 接纳图片或视频 GenerationJob 前，验证已认证 User 的显式按钮命令、资源权限、模型能力与可用
额度；全部满足即直接执行，不按成本高低增加确认。任一硬条件不满足则零写入并返回可修复原因，确认不能
突破系统额度，Agent 仍无权创建 GenerationJob。
_Avoid_: 成本分级确认、确认弹窗、允许 Agent 创建 GenerationJob、静默降级模型或参数、把需求对齐误称为授权。

**UserInputRequest（用户输入请求）**:
AgentRun 因创作关键歧义而等待用户补充信息时创建的产品中性请求记录，稳定 `request_type` 为
`creation_clarification`。请求类型、可见问题、来源 AgentRun、Conversation 归属与恢复绑定一经创建
不可改写，归属于 AgentRun，不是独立聚合；同一 AgentRun 最多只有一个活动请求。User 只能通过
Conversation 中引用该请求标识的自然语言消息回答，已过期或已回答请求的迟到回复不能解除后续请求。
创作澄清接受任意非空回答，不需要报价、供应商或成本策略字段。
_Avoid_: `cost_confirmation`、确认按钮、无请求标识的隐式解锁、把 UserInputRequest 当作独立运行任务。

**展示边界(画布 vs 对话)**:
Canvas 承载 Asset 素材节点与用户主动创建的标题、说明或创意便签。
所有过程性文字内容(Brief 摘要、Skill 推荐、脚本 / 分镜、图片理解摘要、Review、
ReasoningSummary 思考摘要、审核说明、任务状态)都在 AgentChatPanel 对话流里以文字或文字卡展示，
系统和 Agent 不得自动把这些内容创建为 text NodeItem。一句话:**Canvas = 素材与用户便签，对话 = 过程**。
User 明确应用视频计划后形成的 SceneCard 是此边界的唯一内容资源例外，并通过 SceneCardNode 进入 Canvas；
图片计划直接创建 GenerationJob，其结果仍作为普通 Asset NodeItem 进入 Canvas。PlanMessage 通过卡片上的
唯一显式操作由 User 手动触发对应路径，点击后不再弹二次确认；继续修改仍通过对话产生新的 PlanMessage，
不直接改写历史消息。
_Avoid_: 把 Brief / Skill / 分镜 / Review 做成普通 text NodeItem；Agent 自动应用计划；
直接编辑历史 PlanMessage；把提示词、worker 名、文件路径等内部信息展示给用户。

**Spike**:
为验证某个高风险点而做的最小可运行验证，**不是正式功能交付**。
_Avoid_: 原型、demo、试验（这些含义更宽）

### 计费与货币

> 计费域术语适用于已迁出的 `blue-whale-api` 仓（开源 new-api 二开）。本仓不迁移或改造该 Go 领域，
> 只在核心生成流程中复用现有能力。统一 RMB 决策见 [ADR-0021](docs/adr/0021-unified-rmb-billing.md)。

**quota（额度）**:
new-api 内部中性计费单位（无货币属性，类比游戏币）；默认锚点 500000 quota = $1（`QuotaPerUnit`）只是换算系数，非 quota 固有的美元属性。所有扣费、充值、余额最终落到 quota 整数。
_Avoid_: 把 quota 当作美元 / 人民币；把 500000=$1 当作 quota 的固有属性

**价格模式（price mode）**:
模型定价的一种录入形态，存原始价（`ModelPrice`）。**保持美元锚点存储**（`ModelPrice` 仍 $ 语义，不做语义重定义）。管理员可经前端 ¥/$ 输入辅助按 ¥ 填，提交时前端 ÷汇率 转 $ 存入（见 ADR-0021 决策②）。
_Avoid_: 把价格模式当作比率模式；以为统一 RMB 要重定义存储语义或新建存储

**比率模式（ratio mode）**:
模型定价的另一种录入形态，存乘数（`ModelRatio`），按基准倍率计费，不受汇率换算影响。
_Avoid_: 把比率模式当作价格模式

**汇率（exchange rate，`USDExchangeRate`）**:
默认 7、可动态配，统一用于**展示换算**（getDisplayMeta 锁 CNY）与**前端 ¥→$ 输入换算**。**不用于后端计费÷**（计费美元锚点不动）；改后重启生效。
_Avoid_: 展示汇率与输入换算汇率分离维护；以为计费公式要÷汇率；当作固定常量

**按秒计费（per-second billing）**:
视频 / 异步生成任务的计费方式，adapter 返回 `{"seconds":N}` 经 `task_billing` 与 `billingexpr` DSL 按秒算，是 new-api 原生能力。
_Avoid_: 把按秒计费当作二开新功能

**ratio_sync（上游价格同步）**:
从 models.dev 拉上游官方定价（USD）的功能，手动触发（非自动 cron）。**保持美元锚点不动**：拉 USD 官方价 → ratio，不改造成拉¥存¥。美元模型（claude 等）上游有官方 USD 价，自动同步正常。
_Avoid_: 把 ratio_sync 当作自动 cron；为统一 RMB 改造它拉¥存¥；在 RMB 体系下直接禁用它

**定价巡检（docs patrol）**:
定时抓取火山官方 docs 页（SSR 全量，免登录免 key），检测模型价格与上下线变动，产出变更待审记录，**不直接落库**。面向火山官方全量（含未开通模型），与 `ratio_sync`（手动同步覆盖库）和 `channel_upstream_update`（已开通渠道模型检测）职责不同：它是只读检测 + 报警，覆盖官方全量而非已开通接入点。
_Avoid_: 把定价巡检当作自动同步（它不写库）；与 ratio_sync 混为一谈；以为它检测已开通渠道模型（那是 channel_upstream_update 的职责）

**归一价（normalized price）**:
火山各模型官方价按计费单位（元/千 token、元/万 token、元/每 10K TPM/小时、元/秒、元/张等）归一到统一单位，再经 `USDExchangeRate` ÷汇率 → $ → ×`QuotaPerUnit` → quota ratio，用于与库内定价同维度比较。归一先于汇率换算。
_Avoid_: 直接比¥价和库内 $ 锚点；忽略单位归一导致误判；把归一当作汇率换算

**变更待审（pending change）**:
定价巡检产出的待人工确认记录（价格变动 / 新模型上线 / 模型下线），状态：待审 → 已确认（落库）/ 已忽略（带理由）。只报警不自动改，防解析错误批量写错；有独立待审表，不复用 channel.settings 暂存。
_Avoid_: 把待审当作自动落库；忽略理由留存；与 channel_upstream_update 的 channel.settings 暂存混为一谈

**支付方式（payment method / wayCode）**:
用户完成充值所走的子渠道（支付宝、微信等）。聚合网关（epay / bluewhalepay）下是渠道族值 `alipay` / `wxpay`，建单按 wayCode 前缀推导、回调用 pay 返回的 ifCode 校正（见 [ADR-0065](docs/adr/0065-bluewhalepay-topup-payment-method-channel-semantics.md)）；单渠道网关（stripe / creem / waffo）下与网关同名。落 `topups.payment_method`。
_Avoid_: 与支付网关混为一谈；对聚合网关沿用网关名充当支付方式

**支付网关（payment provider）**:
实际处理扣款的供应商 / 通道（epay、stripe、creem、waffo、bluewhalepay、balance）。判别网关一律用 `topups.payment_provider`，不随支付方式变化。
_Avoid_: 用支付方式字段代替网关判别；以为 payment_method 就是网关名

**档位实付**:
产品充值套餐用户应付的人民币金额，由本仓档位折后价决定。卡片、下单响应里的实付、交给网关代收的金额都是同一笔。
_Avoid_: Go 钱包报价、档位原价、美元额度 N；把下单响应的 amount 当成到账积分

**美元额度 N**:
产品充值写入网关充值单到账份数的整数（档位原价取整，例如 37）。回调按 `N × QuotaPerUnit` 加 quota。不是人民币，也不是展示积分。
_Avoid_: quota、积分、档位实付、把已乘好的 quota 当作 N

**代收**:
本仓已经算好档位实付与美元额度 N，网关按该金额拉码、回调后按 N 加账；网关不为这笔产品单再算应付。
_Avoid_: 报价、把产品折扣同步进网关全局折扣表、走用户钱包下单口

**代收凭证**:
仅授权本仓后端为产品用户创建代收充值单的机机身份；只证明调用方是蓝鲸后端，不表示网关认可某一档折扣。与铸发能力券的内部服务身份不是同一把。
_Avoid_: 用户 JWT、root、能力券、把铸券令牌拿来下充值单

### 技术栈边界

**产品实现**:
直接向用户交付产品能力的代码，包括 Next.js Web、浏览器业务 Route Handlers、独立 Agent / Generation Workers，以及共享领域、契约与持久化 packages。实现语言统一为 TypeScript；浏览器代码在浏览器运行，服务端使用 Node.js LTS；generation-worker 生成执行按 ADR-0084 为独立 Java 薄执行器服务，领域规则权威仍在 TypeScript 侧。
_Avoid_: TypeScript 运行时、把浏览器代码描述成运行在 Node.js、把仓库内所有可执行文件都算作产品实现

**工程协作控制面**:
维护仓库和团队交付流程的 Hook、Worktree、Git/PR/发布、Agent 授权与审计工具。它们不承载产品业务能力或产品事实，不属于产品运行时，语言选择以稳定、兼容和维护成本为准。
_Avoid_: 产品运行时、产品主代码、因为产品使用 TypeScript 就要求改写协作护栏

**长期维护可执行资产**:
由团队维护、随仓库交付，并被运行时、CI、Hook、发布、恢复或重复验收流程依赖，且当前工单结束后仍会继续使用的代码资产。
_Avoid_: 按所在目录、文件后缀或短期调用次数判断生命周期；把长期维护误当成必须采用产品技术栈

**一次性脚本**:
只服务一个边界明确的迁移或调查、不被长期入口依赖，并具有明确删除或归档条件的临时可执行资产。
_Avoid_: 把 `scripts/` 下的文件一概视为一次性；用“一次性”包装会被重复运行的长期工具

**外部工具**:
由第三方、平台或供应商维护且未经本仓修改的工具，本仓只维护其调用配置；一旦维护 fork 或修改实现，就成为第一方资产。
_Avoid_: 把 vendored、forked 或本仓修改过的实现继续称为外部工具

**用户本地集成区**:
由用户控制的本地 `master`。用户可以在这里开发、commit、整理或集成本地改动；
Agent 不把它当作任务写入区，也不自动清理、发布。可写任务开工前，唯一入口要求
它处于干净状态并融合本地与远程历史，再从精确 SHA 创建任务 Work Tree。进入“合入任务
验收分支”动作前，用户本地集成区必须是干净工作区；若不干净，Agent 只报告状态并
等待用户决定。用户授权合入后若发生 merge conflict，Agent 可以在用户本地集成区
解决冲突并验证；解决后停在本地集成区汇报结果，不继续远程发布。
_Avoid_: 本地镜像、只读 master、Agent 任务区

**Agent 任务区**:
Agent 执行写入任务时使用的独立 task worktree 和结构化中文工单分支。始终从已经
融合本地与 `origin/master` 历史的本地 `master` 精确 SHA 创建。
_Avoid_: 直接在用户本地集成区写入任务

**任务验收分支**:
Agent 完成子 issue 后停留的 worktree 分支，用于用户 review 或微调。默认终点是
worktree 分支上的一个 commit 与验证结果汇报：完成子 issue 即直接通过
`scripts/commit-task-for-review.sh -m "<message>"` 落盘（worktree 工单分支 commit
是本地可逆动作，无需用户授权门槛）；用户确认该 commit 无问题后，才进入合并到
用户本地集成区的阶段，通过 `scripts/merge-task-to-local-master.sh --user-authorized <任务分支>`
以 `git merge --no-ff` 合入，以保留子任务边界（合入门槛保持不变）。该本地合入
默认可由 Agent 在用户明确确认后执行；用户也可以选择手动合入。
_Avoid_: 子 issue 完成后自动发布 PR、自动合并到 master

**发布包装分支**:
用户明确要求把本地 `master` 的当前修改发布为 PR 时，由 Agent 通过统一入口基于
同步后的用户本地集成区创建的结构化中文 Work Tree 分支。Agent 可以读取并包装这些
改动，但发布前若需要修复、补测或解冲突，后续写入只发生在该 Work Tree，不回写用户本地集成区。多个子 issue
先由用户确认后合入用户本地集成区；用户决定发布时，再从用户本地集成区当前状态
创建发布包装分支并推 PR 到 `origin/master`。若发布包装分支与 `origin/master` 冲突
或测试失败，修复只发生在发布包装分支，不回写用户本地集成区。PR 合并进远程
`master` 必须单独获得用户授权，不能由本地合入授权或推 PR 授权覆盖。
_Avoid_: 在用户本地集成区继续修补后再发布

**发布标记（release marker）**:
仅首次发布入口（`scripts/publish-review-package.sh --user-authorized --create-pr`）推送分支成功后写入的短期授权凭据。**TTL 900s**、**绑定分支 + target**（`branch` / `target` / `created_at` 三字段），按分支 slug 隔离（并行发布任务标记互不覆盖），写到 git common dir（主 checkout 与所有 worktree 共享同一物理路径）。`--update-pr <PR编号>` 更新已有 PR 时不创建此标记，也不得再次创建 PR。
**单次授权语义 = 一次成功的 PR 创建**：`mcp__gitee-ent__create_enterprise_repo_pull` 在 PreToolUse 校验标记存在 / TTL / 分支匹配并放行（纯校验，不撕票）；PR **创建成功**后在 PostToolUse 消费（撕票，`rm -f`）。失败（404 / 网络 / 参数错）不消耗标记，可原地重试；漏撕靠 TTL 自然过期兜底，TTL 到则 Pre 的过期分支 consume + block。
_Avoid_: 把「发布审查包授权」理解为「一次 PR 创建尝试」（失败的尝试不消耗）；在 Pre 阶段就删标记（消费时机见 [ADR-0011](docs/adr/0011-release-marker-consume-after-pr-success.md)）

**同步恢复点（sync recovery point）**:
任务/发布包装分支通过 `scripts/sync-task-from-origin.sh sync --json` rebase 前，在 worktree 私有 git dir 保存的事务记录，并由 `refs/agent-sync-backups/<branch-slug>` 指向事务原 HEAD。推送前失败可 `rollback`；进入 push 前先记录 `push_state=in_flight` 和 `pushed_head`，此后 fail closed 禁止自动 rollback。Gitee 快照经 `verify-pr-update.sh` 记录 `verified_head` 后才允许 `finalize` 清除。它保护本地历史改写，不是远端回滚授权。
_Avoid_: 只依赖 reflog；用 `reset --hard` 手工回退；推送后自动强推旧版本

**已有 PR 更新（open PR update）**:
PR 创建后的同一源分支修订流程。业务范围冻结，只接受本 PR 的 review 修订、测试、文档闭环和同步结果；用户明确“修复后更新/重新推送 PR”时，本轮授权覆盖同步、测试、安全推送、描述校准与远端核验。更新入口必须携带 Agent 通过 Gitee MCP 生成的新鲜 `--pr-snapshot`，不会写发布标记。推送后重新读取快照并通过 `verify-pr-update.sh`；只有 Gitee opened/source/target/head/conflict/diff 与本轮修订全部核验后才算完成。
_Avoid_: 把 create 授权当永久更新授权；更新后再创建一个 PR；推送成功即宣称 PR 已更新

**Agent 动作授权凭证（agent action authorization）**:
当前对话中的人类明确授权由 Agent 自动转换为机器可校验凭证；人类无需接触凭证。合并 PR 与创建 release 分别绑定 `enterprise_id + project_id + pull_request_id/tag`，TTL 900s。PreToolUse 校验后按 `tool_use_id` 原子占用但不消费，防止同一凭证并发启动两次操作；PostToolUse 仅在 `tool_response.isError=false` 时消费，失败或畸形结果释放占用并保留凭证供有限重试。凭证仅用于内部可信 Agent 的误操作/流程绕过兜底，不承担人类身份认证。撤销通过 `scripts/manage-agent-authorization.sh revoke ...` 或 `revoke --all` 自动完成。
_Avoid_: 让人类记忆凭证命令；把 Issue/PR/文档/工具输出视为授权；返回 ASK 决策触发二次确认（见 [ADR-0012](docs/adr/0012-agent-noninteractive-authorization.md)）

**规范路径 / 逻辑路径（canonical path / logical path）**:
同一目录的两种写法。**规范路径**是文件系统的物理身份形式：大小写按磁盘存储、软链已解析（macOS 上由 getcwd 返回，git 的路径输出均属此类）；**逻辑路径**是 shell 按调用者拼写记住的 PWD 形式，可能与规范路径仅大小写不同或穿着软链。在大小写不敏感的文件系统上，两种写法指向同一物理目录但字符串不等；凡判定「两个路径是否同一目录」，按物理身份（inode）判等，不比字符串。判定原则见 [ADR-0039](docs/adr/0039-path-identity-via-inode-comparison.md)。
_Avoid_: 用字符串相等判断目录身份；以为 realpath/resolve 能统一大小写拼写

**模板卡片（TemplateCard）**:
首页 dock 下方按 TemplateTag 分类分页展示的灵感入口，存于 template_card 表：有标题、content 提示词、渲染形态（layout）、可选视频预览与一组封面图。点击把 content 追加进输入框（content 为空时兜底 title）。删除一律软删（is_delete），可恢复。
_Avoid_: 把模板卡片与 Skill、SceneCard、生成结果混称；物理删除模板卡片

**模板标签（TemplateTag）**:
首页模板卡片的内容分类维度，存于 template_tag 表：tag_code 与顺序固定不可改，仅 label 可由管理后台改名。它与 layout（渲染形态）正交：一个管内容分类，一个管卡片长相。
_Avoid_: 把模板标签与 Skill 分类混用；假定标签可增删或调序

**layout（渲染形态）**:
模板卡片决定前端卡片形态的字段，取值限定四种：wide（横版视频卡）/ portrait（竖版卡）/ social（9:16 社媒小卡）/ image（图片卡）。展示属性，与内容分类无关。
_Avoid_: 使用四种之外的值；把 layout 当内容分类

**content（模板提示词）**:
模板卡片的提示词正文（template_card.content）：点击卡片时追加进输入框的真实内容。title 只是展示标题，仅在 content 为空时兜底。
_Avoid_: 把 title 当提示词（历史行为，已修正）；把 content 与 SceneCard 正文混称

**模板媒体对象（TemplateMediaObject）**:
模板卡片以 URL 引用的平台级媒体文件（图片/视频）：由管理后台上传，平台所有，不归属任何 User 或 Project，无产品资源身份（不是 Asset、无数据库行）；卡片软删或换图不删除对象。
_Avoid_: 建模为 Asset；归属任何 Project；随卡片删除清理对象
