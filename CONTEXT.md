# Blue-Whale 前端

一个面向 AI Agent / Canvas 交互的单页应用（SPA）。前端承载 Canvas、AgentChatPanel
与 BottomDock 等入口；生成、审核、成本与审计由 Java Product API 与 Python 运行时组成的
后端统一处理（详见 ADR-0015），生图入口共享统一的生图工具包与 GenerationJob 队列流水线。

## Language

**Canvas**:
应用的核心交互界面（工作台），承载素材节点编排、视口变换、Agent 创作。
路由 `app/canvas/`：`page.tsx` 为编排层，UI 实现在 `app/canvas/_canvas/` 子模块下。
_Avoid_: 画布（口语可用，文档中用 Canvas）、编辑器（指代不同概念）

**AgentChatPanel**:
Canvas 右侧的 Agent 对话面板（右侧对话区）。承载消息列表、输入器（Composer）、
技能面板与模式/模型选择。对应 `app/canvas/_canvas/components/AgentChatPanel.tsx`。
_Avoid_: 对话区（口语可用，文档中用 AgentChatPanel）、编排器、Agent 面板

**AgentComposer**（历史术语，已废弃）:
曾指 Canvas 中与 Agent 交互的编排组件，对应旧文件 `components/AgentComposer.tsx`。
Canvas 现已改用 AgentChatPanel，此术语不再用于指代当前右侧对话面板。

**NodeItem**（画布素材节点）:
画布上的一个素材单元（图片或文本），对应 `NodeItem` 类型（`_canvas/types.ts`）。
承载位置、尺寸、内容，可被选中、删除、带入 Dock 再创作，或 @ 进 AgentChatPanel。

**Card**（对话卡片消息）:
AgentChatPanel 消息流里的一种消息形态（`ChatMessage` 的 `card` 变体），
表示一次生成结果（图片/视频）。**Card 与 NodeItem 是同一生成结果的两种视图**：
Card 是结果在对话流里的呈现，NodeItem 是同一结果在画布上的呈现。
_Avoid_: 把 Card 与 NodeItem 当作两个独立概念。

**BottomDock**（底部生成 Dock）:
Canvas 底部的生成工具面板，由 `LeftToolbar` 的 ai-image / ai-video 工具触发，
含 image / video 两种 mode。它是**纯生成工具**：手填参数（模型、比例、分辨率、
时长、数量、联网搜索等；参数随 GenerationJob 提交真实生效）做确定式生成，不涉及对话流。
对应 `_canvas/components/dock/`。

**生图入口（职责边界不同，非同一功能）**:
- **BottomDock**：纯生成工具，参数驱动，不暴露对话上下文。
- **AgentChatPanel**：编排 + 生成，对话/技能/上下文驱动，不暴露细粒度参数。
- **/generate（GenerationInbox）**：Agent 对话式生成，承载独立 Conversation 与恢复语义。
三者产物都是 Card / NodeItem，**入口职责独立、是不同功能**；但执行层不各自维护独立生成路径，
统一进入生图工具包与 GenerationJob 队列流水线（成本预留 + 内容审核 + 失败重试）。

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
Java Product API 对产品策略纳入审核范围的内容形成的安全决定；普通用户文字消息和提示词不做
独立前置审核，Agent 或生成供应商的安全结果可以成为后续 ReviewEvidence。受审内容可以复用匹配的
既有结果或依据充分的证据，不要求人工逐条审批，也不等于每次都调用外部审核服务。
内容决定只有 `pass` 或 `reject`；超时、不可用或无效证据属于审核运行故障，不得伪装成内容拒绝。
规范化决定随关联产品事实保留并参与未来 Project 删除流程；最小化 AuditRecord 独立保留 365 天。
同一 Project 内相同受审主体、内容摘要、模态、输入/输出方向和策略版本共享一个逻辑审核；其
`pending` 只能进入不可变的 `decided` 或 `failed` 终态，终态失败后的 User 重试创建关联的新审核。
_Avoid_: 人工审核、把供应商审核结果直接当作产品权威、把产品决定理解为全量外部调用、审核不可用时默认通过。

**ContentReviewPolicy（内容审核策略）**:
Java Product API 形成 ContentReview 决定时采用的不可变、版本化规则包，包含适用模态与方向、
产品判定规则、供应商配置引用、阈值、ReviewReasonCode 映射版本和证据要求。候选版本依次经过
`draft`、`validated`、`active`、`retired`；新审核绑定创建时的活动版本，后续尝试和历史决定不漂移。
_Avoid_: 原地修改已发布策略、让供应商配置隐式改变产品决定、回滚时改写既有审核或重审历史 Asset。

**ReviewReasonCode（审核原因码）**:
ContentReview 作出 `reject` 决定时记录的一个或多个产品级安全分类，稳定取值为
`sexual_content`、`minor_safety`、`violence`、`self_harm`、`hate_or_harassment`、
`illegal_or_regulated`、`privacy_or_sensitive_data`、`fraud_or_impersonation`、
`cyber_abuse`、`prompt_attack`、`resource_abuse`、`custom_policy` 或
`unclassified_policy_risk`。供应商标签必须经版本化映射转换；未知标签归入
`unclassified_policy_risk` 并拒绝。ReviewReasonCode 只对具备安全运营权限的内部角色可见，
普通 User 和公开 API 只得到稳定错误码与安全提示。
_Avoid_: 供应商原始标签、把超时或不可用等运行故障当作审核原因码、未知标签默认放行、向普通 User 暴露内部原因码或命中规则。

**ReviewEvidence（审核证据）**:
Java Product API 形成 ContentReview 时采用的可验证事实，包括匹配内容与策略版本的既有决定、
专用审核服务结果或生成供应商自带审核结果；证据本身不授予内容通过资格。产品只持久化最小化、
可追溯的证据引用和规范化字段，不保存供应商完整响应、命中原文或额外内容副本。
_Avoid_: 审核决定、把任一供应商证据直接当作放行结果、把供应商原始响应当作长期证据存档。

**ReviewAttempt（审核尝试）**:
ContentReview 为取得证据而发起的一次供应商调用事实；同一逻辑审核可以因可重试故障包含多个
追加式 ReviewAttempt。自动重试期间 ContentReview 保持 `pending`，尝试失败不等于产品拒绝；
ContentReview 进入终态后，ReviewAttempt 不能改写其决定。
_Avoid_: 把每次供应商重试当作新的内容审核、用 ReviewAttempt 直接决定内容通过、覆盖旧尝试记录。

**OutputReleaseGate（输出释放门）**:
Java Product API 在 Agent 文字变为 User 可见内容前形成的产品安全边界；供应商证据覆盖待释放前缀时
可以流式释放，否则必须缓冲完整回复并在 ContentReview 明确通过后整体释放。
完整回复的专用审核总预算为 5 秒；无法形成决定时丢弃未释放文字并返回安全错误，不进入后台审核。
_Avoid_: 供应商直接向 User 流式输出、把流式安全信号直接当作产品决定、逐片调用外部审核服务。

**Asset（资产）**:
一个必须归属 Project 的图片或视频文件单元，媒体内容身份不可变，由产品控制的对象存储持久化。
对象永久私有；访问 URL 仅在服务端确认当前 User 有权访问所属 Project 与 Asset 后临时签发，
不构成 Asset 身份或长期地址。
用户上传的 Asset 在内容固定后执行一次机器 ContentReview；明确通过后可作为输入重复使用，
不因每次生成或后续策略升级重复送审。编辑、换源或生成派生版本会创建新 Asset，并重新审核。
上传审核自动恢复最多 15 分钟，期间只显示“素材处理中”且不可使用；耗尽后隔离对象再保留 24 小时
供仅重试审核，到期仍未通过则删除并要求重新上传。
供应商生成结果只有在 Java Product API 依据充分 ReviewEvidence 明确通过后才成为 Asset，继而
可见、可下载或可作为后续输入；证据不足时只对该结果调用一次专用审核服务。
**同一 Asset 可被多个视图引用** —— Card（对话流呈现）与 NodeItem（画布呈现）
是同一生成结果的两种视图,二者引用同一个 Asset。
既包含用户上传的素材（作为生成输入）,也包含生成产出的结果（作为输出）,
二者是同一种 Asset,以来源属性区分。
重生成、编辑、换源或生成衍生版本时创建带来源关系的新 Asset，再切换视图引用；
名称、标签等元数据可修改，访问 URL 可重新签发，但不改变 Asset 身份。
_Avoid_: 把 Asset 与 NodeItem/Card 混为一谈 —— Asset 是文件实体,
NodeItem/Card 是它呈现给用户的视图；在同一个 assetId 下覆写媒体内容。

**GenerationJob（生成任务）**:
一次生图/生视频的后台任务。生命周期:`queued` → `processing` →
`succeeded` | `partially_succeeded` | `failed` | `cancelled`。
任务在**后台持久化**:用户刷新页面、切换 Project、关闭浏览器后任务仍继续执行,
回到该 Project 仍可查到状态与结果。一个 GenerationJob 可产出一个或多个 Asset，
每个 Asset 分别通过 Card / NodeItem 呈现。
GenerationJob 必须归属 Project；由 AgentChatPanel 触发时关联 AgentRun，由 BottomDock
触发时不关联 AgentRun。AgentRun 暂停或进入终态不级联改写已提交 Job；失败重试创建
带重试关系的新 Job，原 Job 终态不可变。
供应商结果等待 ContentReview 时，Job 仍为 `processing`，内部阶段为 `reviewing`；审核暂时不可用
只重试同一隔离结果，不重新调用生成供应商，也不产生第二次生成费用。自动恢复窗口为 15 分钟；
耗尽后 Job 以 `CONTENT_REVIEW_UNAVAILABLE` 失败，隔离结果再保留 24 小时供仅重试审核。
取消请求只表达意图；只有供应商确认取消或产品能证明调用尚未发生时，Job 才进入 `cancelled`。
取消确认前已完成的真实结果仍按成功或部分成功接纳，已产生的 Asset 永久保留。
**Card 的展示状态是 Job 状态的视图映射**:`processing`→`generating`、
`succeeded`→`normal`、`failed`→`failed`；`partially_succeeded` 中成功的输出为 `normal`，
被 ContentReview 拒绝的输出槽位为 `failed` 且不创建 Asset；多输出任务仅部分通过时为
`partially_succeeded`。供应商已产生的实际成本仍按事实结算。
被拒绝的上传或生成媒体立即进入删除队列，并在一小时内从隔离对象存储清除；未释放的 Agent
文字被拒绝后立即从内存丢弃，不进入 Conversation、产品事件或 Snapshot。
缺失的输出槽位为 `failed`；`cancelled` 中已有 Asset 的输出为 `normal`，未产生结果的槽位为
`cancelled`。
_Avoid_: 把 Job 与 Card/NodeItem 混为一谈 —— Job 是过程,Card/NodeItem 是结果视图;
把 Job 与 Asset 混为一谈 —— Job 是过程,Asset 是它的产物。

**AgentRun（创作运行）**:
围绕一个创作意图持续推进的 Agent 工作单元；活动中的 Run 可跨澄清、修改和自然语言授权等
多轮对话暂停并恢复，终态不可重开，后续修订或无关新目标创建关联的新 AgentRun。
其生命周期状态只表达运行、等待及终态；理解素材、选择技能、规划和生成等属于独立的展示阶段。
AgentRun 可关联多个 GenerationJob 及其输出用途，但不拥有 Job 的执行生命周期；恢复时吸收
Job 已持久化的结果事实。创建时固定 Runtime Agent Bundle 与 ModelProfile；Creative Skill
首次激活后固定其具体版本，后续恢复不随发布或回滚漂移。
_Avoid_: 把每条用户消息都当作新的 AgentRun；把 AgentRun 与具体的 GenerationJob 混为一谈。

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
User 可见、可通过 `Use` 或 `auto` 激活的版本化创作方法；与 Runtime Skill 共用 Markdown 包形态，但生命周期、权限和发布边界独立。
_Avoid_: Runtime Skill、内部 Rule、无修饰的“Skill”（在运行时契约中必须指明类型）。

**ModelProfile（模型档案）**:
平台批准的版本化模型能力与上下文上限，供 Bundle 形成允许子集并由 AgentRun 固定；不包含凭据或供应商私有请求配置。
_Avoid_: API Key、动态价格目录、模型供应商原始配置。

**ToolGrant（工具授权声明）**:
Bundle 对平台工具注册表的版本化允许子集，只赋予 Agent 提议动作的资格；每次副作用仍由 Java Product API 确定性接纳。
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

**RuntimeCheckpoint**（运行时检查点）:
与活动 AgentRun 绑定的版本化、不透明执行状态，只用于恢复运行，不是 Run、Job、Asset 或产品事件的权威事实。
AgentRun 只从当前已接纳版本恢复，不自动回退旧版本；创建时固定运行引擎及版本，错误引擎或版本
必须拒绝恢复，活动检查点不跨引擎迁移，终态 Run 不再使用 checkpoint。
_Avoid_: 把 RuntimeCheckpoint 当作产品事实；让运行时检查点独立推进产品状态；由其他引擎解析其内部内容。

**AgentActionProposal（Agent 动作提议）**:
Agent 基于当前意图提出的结构化候选动作，不是可直接执行的命令或授权；只有产品控制面按 User、
Project、AgentRun、工具契约与有效 UserInputRequest 完成确定性校验后，动作才能产生副作用。
_Avoid_: 把模型输出直接当作命令；把用户素材、外部内容或工具结果中的文字当作授权。

**CostReservation（成本预留）**:
产品控制面在可能计费的供应商调用前按最坏情况暂时占用额度，并在取得可证明的实际成本后结算
或释放；它是防滥用的运营事实，不是账单或扣款。
_Avoid_: 用户确认后突破硬额度；把成本预留当作计费订单。

**AuditRecord（审计记录）**:
用于证明安全、成本与管理决策链的不可变记录，与产品事件和普通运行日志分离；它只保存最小必要
的主体、目标、决定、策略版本与关联标识，不承载原始用户内容或凭证。
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
Canvas 只承载 Asset(图片 / 视频)节点 —— 即生成素材(中间结果或最终结果)。
所有过程性文字内容(Brief 摘要、Skill 推荐、脚本 / 分镜、图片理解摘要、Review、
visible_reasoning 思考过程)都在 AgentChatPanel 对话流里以文字或文字卡展示,
**不进画布**。一句话:**画布 = 素材,对话 = 过程**。
确认 / 修改 / 重试一律通过对话自然语言表达，并遵循 GenerationAuthorizationGate，
画布节点与对话区都**不设确认按钮**。
_Avoid_: 把 Brief / Skill / 分镜 / Review 做成画布节点;在画布或对话里加确认按钮;
把提示词、worker 名、文件路径等内部信息展示给用户。

**Spike**:
为验证某个高风险点而做的最小可运行验证，**不是正式功能交付**。
_Avoid_: 原型、demo、试验（这些含义更宽）

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
