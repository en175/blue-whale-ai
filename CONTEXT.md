# Blue-Whale 前端

一个处于上线前研发阶段、面向 AI Agent / Canvas 交互的产品。目标运行时由 Next.js Web 与
TypeScript `product-api`、`agent-worker`、`generation-worker` 组成；三者属于同一模块化单体代码库。
现有 Go 计费系统保持独立且不在 IK3UUX 中改造。范围以
[ADR-0055](docs/adr/0055-prelaunch-typescript-unification-scope.md) 为准。

## Language

**Canvas**:
应用的核心交互界面（工作台），承载 Asset 素材与用户主动创建的文本便签的共享编排、
个人视口变换和 Agent 创作。
路由 `app/canvas/`：`page.tsx` 为编排层，UI 实现在 `app/canvas/_canvas/` 子模块下。
_Avoid_: 画布（口语可用，文档中用 Canvas）、编辑器（指代不同概念）

**AgentChatPanel**:
Canvas 右侧的 Agent 对话面板（右侧对话区）。承载消息列表、输入器（Composer）、
技能面板与模式/模型选择。对应 `app/canvas/_canvas/components/AgentChatPanel.tsx`。
_Avoid_: 对话区（口语可用，文档中用 AgentChatPanel）、编排器、Agent 面板

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
Project 内持久化的场景创作内容，以 Markdown 作为权威正文；它是独立产品资源，不是对话 Card，
也不是 NodeItem。
_Avoid_: 把 SceneCard 当作 Card 的持久化版本；把 SceneCard 内容复制进 Canvas 布局；归入 NodeItem

**SceneCardNode（场景卡节点）**:
SceneCard 在 Canvas 中的布局投影，只引用一个 SceneCard 并承载布局，不拥有场景内容；它是
“Canvas 只编排 NodeItem”规则的显式例外；同一 Canvas 中一张 SceneCard 最多有一个 SceneCardNode。
_Avoid_: NodeItem、SceneCard 本体、在节点中保存 Markdown 副本

**InitialPlacementStatus（NodeItem 首次放置状态）**:
NodeItem 创建后的一次性流程状态：`pending`、`placed` 或 `dismissed`。它只记录首次放置流程的结果，
不表示 NodeItem 当前是否在 Canvas；当前布局始终只由 Canvas 共享布局文档决定。Product API 接纳
首次包含 pending NodeItem 的完整 Canvas PUT 时，必须在同一提交中保存布局并把状态改为 `placed`；
用户明确选择“暂不放置”时改为 `dismissed`。`placed` 与 `dismissed` 都是终态，后续放入或移出
Canvas 均不改变它。只有持有原创建请求或 GenerationJob 接纳回执的页面可以自动尝试首次放置；
这是 Web 的多页面协调规则，不是服务端权限。
_Avoid_: 从该状态推导当前布局；移出 Canvas 后重置为 pending；自动过期、自动删除、后台放置；
在 Canvas 冲突后自动合并或绕过完整 PUT 增量放置。

**Card**（对话卡片消息）:
Web 依据 Conversation、GenerationOutputSlot、GenerationJob 与 Asset 形成的界面投影；生成中、
失败或取消的输出即使没有 Asset 也可以显示 Card。Card 没有服务端身份、强版本、存储表或修改接口；
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
- **generation_model_capability** —— Provider、模型与尺寸/格式/数量/参考图/tools 能力的权威数据表；
  前端选项从后端 `/api/generation/models` 拉取，不再写死。
- **公共治理流水线** —— 成本预留（CostReservation）、内容审核（ContentReview）、失败重试与多输出，
  由统一的 GenerationJob 队列承接。
火山方舟 Agent Plan 使用专属 `/api/plan/v3` 端点与专属 API Key；退役的 `/api/generation/image`
直连因绕过成本预留与内容审核不再提供（详见 [ADR-0038](docs/adr/0038-generation-toolkit-and-image-direct-retirement.md)）。
_Avoid_: 把工具包写成独立的 Provider Registry 运行时组件；把入口产品职责边界与执行层统一混为一谈；
新增供应商时不走能力表与队列流水线。

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
_Avoid_: 用浏览器生成值或 SSE 到达顺序充当消息身份与排序依据。

**PlanPhase（计划阶段）**:
Agent 创作入口内由 Agent 按对话意图自主进入或退出的内部行为阶段；User 可以用自然语言要求立即产出
PlanMessage、继续讨论或不产出 PlanMessage，但不需要理解或切换独立模式。
_Avoid_: Plan Mode、模式开关、直接生成入口、把普通问答或素材分析自动转成计划卡

**PlanMessage（计划卡消息）**:
Conversation 中由 Agent 提交的独立正式消息类别，以 Markdown 与稳定素材引用表达可应用的场景计划；
它随对话历史持久保留，可记录直接参考的另一 PlanMessage，并冻结“新建 SceneCard”或“覆盖所引用
SceneCard”的默认应用意图；User 也可明确选择另存为新 SceneCard，任何应用都必须手动触发。
_Avoid_: 生成结果 Card、SceneCard 本体、可变草稿、唯一最新版、自动应用、自动改写正文、把素材失效等同于消息失效

**PlanApplicationReceipt（计划应用记录）**:
一次成功应用 PlanMessage 的不可变事实，记录实际的新建或覆盖操作、结果 SceneCard、结果版本、内容摘要
与应用时间；它不修改 PlanMessage，Canvas 放置也不属于其成功条件。
_Avoid_: PlanMessage 状态、失败尝试、Canvas 放置记录、用网络响应充当唯一成功证据

**CommandId（业务命令身份）**:
写请求使用的稳定幂等键。同一业务操作的网络重试保持同一键和请求内容；Product API 返回首次结果，
不得重复创建消息、任务、Asset 或其他产品事实。精确格式、摘要算法和保留期由后续实施 Spec 按最小需要定义。
_Avoid_: 每次重试换键；把幂等键当资源身份、排序依据或权限凭证。

**GenerationInbox**（生成收件箱）:
每位 User 最多一个活动实例的系统用途 Project（`purpose=generation_inbox`，识别不依赖名称，改名不影响定位）；承载 /generate 页 Agent 对话式创作的 Conversation、AgentRun、GenerationJob 与产出 Asset。
惰性创建：仅打开页面不创建，首条被系统接收的消息原子地查找或创建并持久化；从项目列表隐藏；删除为永久删除——物理移除其对话、生成记录与作品（保留最小审计事件），之后首条消息创建全新实例。
_Avoid_: 把收件箱当作普通 Canvas Project 展示或编辑；通过通用项目端点软删收件箱绕过永久删除；按名称查找收件箱。

**Card 生命周期状态**: `generating` → `normal` | `failed` | `cancelled`。
失败后的恢复入口仍在原 Card 上，但后端以关联的新 GenerationJob 执行重试；取消且没有产物的
输出槽位显示为 `cancelled`，不创建 NodeItem，也不计为生成失败。

**User（用户）**:
已完成注册并通过登录建立身份的服务使用者；未注册或未登录者不能使用受保护的产品能力。
一个 User 拥有多个 Project，产品资源与操作均按服务端认证的 User 归属。
_Avoid_: 访客、匿名 User、客户端自报 `userId`、把浏览器本地标识当作身份。

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
一个必须归属 Project 的图片或视频文件单元，媒体内容身份不可变，由产品控制的对象存储持久化。
对象永久私有；访问 URL 仅在服务端确认当前 User 有权访问所属 Project 与 Asset 后临时签发，
不构成 Asset 身份或长期地址。
用户上传的 Asset 在内容固定后执行一次机器 ContentReview；明确通过后可作为输入重复使用，
不因每次生成或后续策略升级重复送审。编辑、换源或生成派生版本会创建新 Asset，并重新审核。
上传内容必须在审核明确通过后才可使用；审核无法形成决定时本次上传失败，由 User 重新上传。
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
消息文本中呈现为 `@[name]`；它是消息事实的一部分，随消息落定即不可变、无失效语义，
Asset 后续状态变化由读取时校验兜底。
同一 Conversation 内被 @ 引用过的 Asset 构成 Agent 读取放行（read_asset 白名单）的来源之一，
与 Canvas 中 asset NodeItem 的引用、本 AgentRun 生成产物并列；text NodeItem 不自动进入该白名单。
Agent 读取对话历史时获得每条消息的有序引用列表，
据此精确读取对应 Asset；跨 Project、跨 User 或非 normal 状态的读取一律同构拒绝。
_Avoid_: 把 @ 引用当作无 assetId 的纯文本提及；把 @ 引用与画布选中、生成参考图输入混为一谈；
把引用当作可撤销的授权。

**SceneCardMention（@ 场景卡引用）**:
User 提交消息时对一张 SceneCard 的结构化引用，冻结其当时的身份、内容版本、显示摘要与 Markdown，
作为本轮 Agent 输入及历史证据；后续 SceneCard 修改或删除不得使该引用漂移。
_Avoid_: 始终指向最新版的活动引用、SceneCard 版本历史、用旧引用读取后来内容、AssetMention

**GenerationJob（生成任务）**:
一次持久化的图片或视频后台任务。任务归属于 Project，页面刷新、浏览器关闭或服务重启后，
已接纳状态与结果仍可恢复；同一请求或供应商回调重放不得产生重复任务、结果或费用。
Worker 通过短租约领取任务；租约过期后可由新 Worker 重新领取，旧 Worker 的迟到写入由 fence 拒绝。
外部调用结果无法确认时任务明确失败，由 User 在原 Card 上手动重试，不建设自动核对系统。
_Avoid_: 把 Job 与 Card、NodeItem 或 Asset 混为一谈；用内存状态作为任务权威；自动复活终态任务。

**GenerationOutputSlot（生成输出槽）**:
GenerationJob 创建时固定的输出位置，用于让多输出任务稳定关联 Card、审核结果与 Asset。
重试可以关联原输出槽，但必须创建新的 GenerationJob；成功结果不得被后续重试覆盖。
_Avoid_: 运行中增删或重排槽位；由 Web 猜测结果映射；在同一槽位发布多个 Asset。

**AgentRun（创作运行）**:
围绕 Conversation 中一个创作意图推进的持久工作单元。已接纳消息与用户可见结果由 Product API 保存；
Worker 崩溃后可以按当前权威状态重新领取，旧 Worker 不得覆盖新结果。完成、失败或取消后不自动重开；
后续用户输入需要继续处理时，由 Product API 明确创建或继续相应运行。
_Avoid_: 把每条网络请求或模型调用当作独立 AgentRun；从 Worker 本地状态推导产品终态；
为结果不明建设自动迟到证据收敛。

### Agent 运行配置

**AgentDefinition（Agent 定义）**:
平台内部一个 Agent 的稳定身份，是 Runtime Agent Bundle 草稿与发布版本的归属根；自身不承载运行时内容。
_Avoid_: AgentRun、BundleVersion、可直接执行的提示词。

**Runtime Agent Bundle（运行时 Agent 包）**:
平台维护、普通 User 不可见的 Agent 行为配置边界，由角色、Rules、根 Runtime Skill、允许的模型与工具以及资源清单组成；运行时只消费其不可变发布版本。
_Avoid_: 仓库目录、Creative Skill、可变系统提示词、Agent 框架 checkpoint。

**BundleDraft（运行时 Agent 包草稿）**:
一个可编辑、可校验但不可运行的 Runtime Agent Bundle 工作区；发布后产生新的不可变 BundleVersion。
_Avoid_: 活动配置、可由 Worker 读取的快照。

**BundleVersion（运行时 Agent 包版本）**:
Runtime Agent Bundle 的不可变发布快照；AgentRun 固定具体版本，激活或回滚只影响之后创建的 Run。
_Avoid_: 原地修改的配置行、Git commit、RuntimeCheckpoint 版本。

**Run pin（版本固定）**:
Product API 为 AgentRun 固定的不可变运行版本锚点，覆盖 Runtime Agent Bundle、ModelProfile 与已激活
Creative Skill；这些身份在 Run 生命周期内不随发布或恢复漂移。
_Avoid_: Worker 回显静态 pin、可变版本引用、独立改写 pin、把尚未接纳的 `auto` Activation 当作既成事实。

**RoleDocument（角色文档）**:
定义内部 Agent 身份、职责和任务边界的根 Markdown 资源；每个 BundleVersion 恰好一个并始终装载。
_Avoid_: Rule、Runtime Skill、面向 User 的角色模板。

**Rule（运行时规则）**:
约束 Agent 行为的一条版本化 Markdown 资源，只能按 `always_on` 或 `on_demand` 装载，不能授予或放宽平台权限、安全、成本与状态铁闸。
_Avoid_: 平台铁闸、Creative Skill、散落在代码中的提示词分支。

**RuleSet（规则集）**:
Runtime Agent Bundle 中按确定顺序生效的 Rule 引用集合；冲突 Rule 必须在发布前消解，不能依赖后写覆盖。
_Avoid_: 无序标签集合、运行时临时拼接的提示词。

**Runtime Skill（运行时技能）**:
平台内部、随 BundleVersion 发布的 Agent 工作流资源；初始只披露元数据，正文与引用资源在选择后按需装载。
_Avoid_: Creative Skill、数据库 `skill` 表的用户内容、硬编码 Orchestrator 分支。

**Creative Skill（创作技能）**:
User 可见、可通过 `Use` 或 `auto` 激活的版本化创作方法；与 Runtime Skill 共用 Markdown 包形态，但生命周期、权限和发布边界独立。其选择、候选、接纳与按需读取的跨服务字段冻结于 `docs/specs/2026-07-24-creative-skill-activation-contract.md`。
_Avoid_: Runtime Skill、内部 Rule、无修饰的“Skill”（在运行时契约中必须指明类型）。

**CreativeSkillActivation（创作技能激活记录）**:
AgentRun 所属、可审计且不可变的 Creative Skill 版本选择事实，记录来源与结构化原因；`forced_use`
在创建时接纳，`auto` 只在 Product API 接纳本轮结果时落定。
_Avoid_: `activations[]`、独立 `activate` 写接口、普通 metadata、AgentActionProposal、多 Creative Skill 组合、运行中切换版本、自由文本理由。

**AutoCreativeSkillCandidate（自动候选）**:
AgentRun 创建时冻结的不可变 Creative Skill 自动激活资格池；资格不表示当前意图匹配，Runtime 只能
从中选择零个或一个。
_Avoid_: Worker 发明候选外 Creative Skill、把非空资格池当作强制激活、候选随 Creative Skill Library 发布漂移、候选携带正文、要求先持久化 Activation 才能读取候选正文。

**ModelProfile（模型档案）**:
平台批准并由 AgentRun 固定的版本化模型能力、上下文上限与 tokenizer / 计量身份；不承载凭据或
供应商私有请求对象。
_Avoid_: API Key、动态价格目录、模型供应商原始配置、用通用字符估算冒充所有模型的精确 token 数、流中断且 usage 缺失时按零消耗。

**RuntimeBudgetPolicy（运行预算策略）**:
Product API 为 AgentRun 固定的 Provider 调用、上下文与成本硬限制；Worker 只能在其范围内执行。
_Avoid_: Worker 重启后计数归零；把本地计数当权威；用户确认后突破系统硬限制。

**ToolGrant（工具授权声明）**:
Bundle 对平台工具注册表的版本化允许子集，只赋予 Agent 提议动作的资格；每次副作用仍由 Product API 确定性接纳。
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
BundleVersion 内所有资源身份、版本、内容摘要、装载方式与已解析引用的不可变索引，是运行时加载与导入导出复现的依据。
_Avoid_: 可变文件目录、网络资源目录、未校验的相对路径列表。

**ReadEvidence（资源读取证据）**:
Worker 单次资源读取的最小证据（资源身份、版本、内容摘要与来源），用于确认运行时读取的是已固定资源；
不要求在 IK3UUX 中建设独立证据存储或长期生命周期。
_Avoid_: 资源正文、私有文件路径、Bundle / ModelProfile / CreativeSkill pin 回显。

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
Agent 创建 GenerationJob 前对用户意图与风险的分类：明确且在默认成本额度内则直接执行；
存在关键歧义则继续对齐；高成本或不可逆操作则先取得自然语言确认，但确认不能突破系统硬额度。
_Avoid_: 每次生成都确认、确认按钮、把需求对齐误称为授权。

**UserInputRequest（用户输入请求）**:
AgentRun 因关键歧义或 GenerationAuthorizationGate 而等待用户补充信息时创建的产品中性请求记录，
以稳定的产品级 `request_type` 区分创作澄清（`creation_clarification`）与成本确认
（`cost_confirmation`）。请求类型、可见问题、来源 AgentRun、Conversation 归属与恢复绑定一经创建
不可改写，归属于 AgentRun，不是独立聚合；同一 AgentRun 最多只有一个活动请求。用户只能通过
Conversation 中引用该请求标识的自然语言消息回答，已过期或已回答请求的迟到回复不能解除后续请求。
创作澄清接受任意非空回答，不需要报价/供应商/成本策略字段；成本确认仍校验动作身份、参数摘要、
报价与策略版本（详见 ADR-0036）。
_Avoid_: 确认按钮、无请求标识的隐式解锁、把 UserInputRequest 当作独立运行任务。

**展示边界(画布 vs 对话)**:
Canvas 承载 Asset 素材节点与用户主动创建的标题、说明或创意便签。
所有过程性文字内容(Brief 摘要、Skill 推荐、脚本 / 分镜、图片理解摘要、Review、
visible_reasoning 思考过程、审核说明、任务状态)都在 AgentChatPanel 对话流里以文字或文字卡展示，
系统和 Agent 不得自动把这些内容创建为 text NodeItem。一句话:**Canvas = 素材与用户便签，对话 = 过程**。
User 明确应用对话中的计划后形成的 SceneCard 是此边界的唯一例外，并通过 SceneCardNode 进入 Canvas。
确认 / 修改 / 重试一律通过对话自然语言表达，并遵循 GenerationAuthorizationGate，
画布节点与对话区都**不设确认按钮**。
_Avoid_: 把 Brief / Skill / 分镜 / Review 做成画布节点;在画布或对话里加确认按钮;
把提示词、worker 名、文件路径等内部信息展示给用户。

**Spike**:
为验证某个高风险点而做的最小可运行验证，**不是正式功能交付**。
_Avoid_: 原型、demo、试验（这些含义更宽）

### 计费与货币

> 计费域术语适用于 `blue_whale_api`（开源 new-api 二开）。IK3UUX 不迁移或改造该 Go 领域，
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

### Agent 协作语言

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
