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

**AssistantDeliveryAttempt（助手交付尝试）**:
一次 AgentAdvance 中尚未被 RunCommit 接纳的临时 Assistant 输出交付身份；其内容只用于实时展示与
断线重连，不属于 Conversation、Snapshot 或后续模型上下文。详见 [ADR-0045](docs/adr/0045-provisional-assistant-delivery-runcommit-boundary.md)。
_Avoid_: AssistantMessageStreamAttempt、把 Provider stream 当作交付身份、把 provisional 前缀当作 ConversationMessage、续接旧 Worker 持有的 Provider stream。

**AssistantMessage（正式助手消息）**:
RunCommit 从唯一胜出 AssistantDeliveryAttempt 创建的永久会话事实；只有它可以进入 Conversation、
Snapshot 与后续模型上下文。详见 [ADR-0045](docs/adr/0045-provisional-assistant-delivery-runcommit-boundary.md)。
_Avoid_: interrupted AssistantMessage、半成品消息、把 DeliveryAttempt 或 chunk 直接写入永久会话。

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

**AssetMention（@ 引用）**:
用户消息对一个 Asset 的结构化引用，在 AgentChatPanel 输入器中以 pill 形态承载 assetId，
消息文本中呈现为 `@[name]`；它是消息事实的一部分，随消息落定即不可变、无失效语义，
Asset 后续状态变化由读取时校验兜底。
同一 Conversation 内被 @ 引用过的 Asset 构成 Agent 读取放行（read_asset 白名单）的来源之一，
与画布节点引用、本 AgentRun 生成产物并列；Agent 读取对话历史时获得每条消息的有序引用列表，
据此精确读取对应 Asset；跨 Project、跨 User 或非 normal 状态的读取一律同构拒绝。
_Avoid_: 把 @ 引用当作无 assetId 的纯文本提及；把 @ 引用与画布选中、生成参考图输入混为一谈；
把引用当作可撤销的授权。

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
耗尽后原 Job 以 `CONTENT_REVIEW_UNAVAILABLE` 失败并封口，隔离结果再保留 24 小时供用户创建关联的
GenerationReviewRetry；超期后删除隔离结果。
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

**GenerationCancellationIntent（生成取消意图）**:
Product API 对用户“停止 GenerationJob 后续工作”请求形成的幂等事实；它立即阻止新的供应商调用，
但不证明已 dispatch 的调用已经取消。只有供应商确认取消或平台证明请求从未发出时，Job 才能进入
`cancelled`；既有真实结果与成本继续按事实收敛。
_Avoid_: 取消证明；抹除 ProviderGenerationAttempt；丢弃真实成本；以用户请求直接改写供应商事实。

**GenerationReviewRetry（生成结果审核重试）**:
原 GenerationJob 因审核恢复超时失败后，用户在 24 小时隔离期内创建的关联新 GenerationJob；它复用
原结果，只重试 ContentReview 与发布，不创建 ProviderGenerationAttempt 或第二次生成费用。
_Avoid_: 自动后台重试；重开原 Job；重新调用生成供应商；隔离结果超期后继续复用。

**GenerationResultCandidate（生成结果候选）**:
Generation Worker 将供应商结果写入私有隔离区后形成的不可变候选，关联原 Attempt、输出槽、交付身份
与内容摘要，但尚不是用户作品。只有 Product API 验证来源且 ContentReview 明确通过后，才能一次性
发布为正式 Asset。
_Avoid_: 隔离对象即 Asset；Worker 直接发布；未审核先展示；在同一候选身份下覆写媒体内容。

**ProviderGenerationAttempt（供应商生成尝试）**:
GenerationJob 为调用生成供应商而发起的一次可能计费的物理副作用事实；一个 Attempt 可覆盖一个或
多个输出槽位，并以稳定身份独立绑定 CostReservation、调度许可与可对账结果。明确未接纳后的重试
创建新 Attempt；`outcome_unknown` 只能核对原 Attempt，不能伪装成重新提交。
_Avoid_: 把 GenerationJob 当成一次供应商调用；覆盖旧 Attempt；复用 Attempt 身份重发；
把供应商 task id 当作 Attempt 身份。

**ProviderObservation（供应商结果观察）**:
供应商回调或平台主动查询针对原 ProviderGenerationAttempt 形成的规范化、可去重结果证据；它只供
Product API 验证和推进统一状态机，不直接授予作品发布或费用结算资格。相互冲突的 Observation
形成 GenerationResultConflict，并进入原 Attempt 的核对流程。
_Avoid_: 回调直接改 Job；轮询另建状态机；最后写入者获胜；把供应商原始响应当作产品决定。

**GenerationAttemptReconciliation（生成尝试核对）**:
ProviderGenerationAttempt 进入 `outcome_unknown` 后，围绕原 Attempt 通过同一幂等键、异步 task 查询、
回调或账单证据收敛结果的持久恢复过程。只有能够证明不会重复生成或重复计费时才可安全恢复；核对
期限耗尽后 GenerationJob 按失败收口，禁止以队列重试自动创建新 Attempt。
_Avoid_: 把超时当作供应商未接纳；换幂等键重发；无证据释放 CostReservation；把核对伪装成重试。

**GenerationJobTerminalSeal（生成任务终态封口）**:
Product API 接纳 GenerationJob 终态后形成的不可逆封口；它保持用户可见状态简单稳定，并关闭原 Job
的后续推进资格。迟到的 ProviderGenerationAttempt 与成本证据可以继续核对和结算，但不得重开或
改写原 Job。
_Avoid_: 以迟到回调复活 Job；把内部恢复阶段暴露为公开状态；终态后重新取得原 Job 执行权。

**GenerationWorkItem（生成工作项）**:
Product API 从 MySQL 权威事实发放给 Generation Worker 的短租约单步骤执行单元，固定关联 Job、
Attempt、输出槽集合、动作、fence 与 deadline。等待期间不持有执行权；恢复与异常核对只重新领取
尚未完成的 WorkItem，并遵循同一幂等接纳流程。
_Avoid_: 认领整个 Job 长时间执行；以内存 timer 作为权威；Reconciler 绕过 WorkItem；无 fence 回报。

**AgentRun（创作运行）**:
围绕一个创作意图持续推进、可跨多轮对话暂停与恢复的工作单元；它拥有创作推进状态，但不拥有
InvocationAttempt 或 GenerationJob 的完整生命周期。终态为 `completed`、`superseded`、`failed`、
`cancelled` 或专用 `recovery_failed`，均不可重开。
_Avoid_: 把每条用户消息都当作新的 AgentRun；把 AgentRun 与具体的 GenerationJob 混为一谈；新增模糊的 `timed_out` 或 `system_cancelled` 终态。

**AgentRunTerminalSeal（运行终态封口）**:
Product API 接纳 AgentRun 终态后形成的不可逆封口；它关闭旧 Run 的推进资格，但不阻止其他 owner
的既有聚合与运营事实继续收敛。详见 [ADR-0049](docs/adr/0049-agent-run-terminal-seal-and-independent-convergence.md)。
_Avoid_: 重开终态 Run、通用 `agent_run.updated` 事件、把独立聚合收敛误报为 Run 进展、阻止新消息创建新 AgentRun、把 Project 删除映射为 AgentRun 终态。

**AgentRunCancellation（运行取消事实）**:
Product API 对“停止继续推进 AgentRun”的幂等产品命令及其 `cancelled` 终态事实；它不证明 Provider、
InvocationAttempt 或 GenerationJob 已实际取消。详见 [ADR-0047](docs/adr/0047-agent-run-user-cancellation-boundary.md)。
_Avoid_: Provider 取消证明、GenerationJob 终态、RunCommit、`cancelling` AgentRun 状态、删除迟到证据。

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
在创建时接纳，`auto` 只随 RunCommit 接纳。详见 [ADR-0050](docs/adr/0050-stateless-agent-advance-and-invocation-boundary.md)。
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
Product API 为 AgentRun 固定的版本化硬限制，统一约束请求、单次 AgentAdvance 与跨推进累计预算；
Runtime 只能在其范围内执行或进一步收紧。
_Avoid_: Worker 重启后计数归零、把本地计数当跨进程权威、把 RuntimeBudgetPolicy 放进 RuntimeCheckpoint、运行中采用新策略追溯改写旧 Run。

**RuntimeBudgetSnapshot（运行预算快照）**:
Product API 根据 RuntimeBudgetPolicy 与已持久化消耗形成的当前可用预算投影；它供 Runtime
本地 fail-fast，不授予新的 Provider dispatch 权限。
_Avoid_: 把快照当预授权重试额度、混淆 lease 与预算、让等待外部产品结果或无执行者空闲时间消耗活动执行预算、用单一模糊 `deadline` 覆盖四种语义、以 Worker 墙钟决定终态。

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

**ReadEvidence（资源读取证据）**:
Worker 单次资源读取的证据（`resource_id` / `revision` / `content_digest` / `token_estimate` / `origin`），随 commit 以 `bundle_evidence` 与 `usage` 同通道回传 Java；Java 当前仅 `log.info` 记录条数、不持久化。
_Avoid_: 资源正文、私有文件路径、Bundle / ModelProfile / CreativeSkill pin 回显。

### Agent 运行机制

**Agent Runtime Executor（Agent 运行执行器）**:
从已接纳 RuntimeCheckpoint 恢复并执行一次 AgentAdvance 的无状态角色；它不拥有 AgentRun 或任何
产品事实的最终写入权威。
_Avoid_: AgentRun 最终状态权威、常驻 Run Actor、持久工作流引擎、把模型 step / 工具中间状态 / 流式 chunk 当作 checkpoint。

**ProjectOwnershipFence（Project 所有权围栏）**:
Product API 对 Project 是否仍有资格接纳新产品事实维护的权威前置条件；关闭后 Runtime 只能回报既有
调用证据，不能继续推进或创建 Project 产品投影。
_Avoid_: 把 Project 删除当作 AgentRunCancellation、让 Runtime 决定删除状态、删除围栏后接纳新产品投影、在本边界推导 Conversation 独立删除语义。

**AgentAdvance（Agent 单次推进）**:
AgentRun 从一个已接纳恢复点推进到下一个产品边界的稳定逻辑轮次；claim 与 lease reclaim 复用其
`advance_id`，RunCommit 接纳后该轮次结束。
_Avoid_: 只按 checkpoint 推导 `advance_id`、每次 claim 生成新身份、Worker 随机生成 `advance_id`、长驻执行会话、逐 step checkpoint。

**RunCommit（运行提交）**:
Product API 接纳 AgentRun 推进事实的唯一原子边界，将 RuntimeCheckpoint、一个判别式 outcome 与可选
附属事实纳入同一提交；每个 AgentAdvance 最多接纳一次。
_Avoid_: Worker 自造独立 `commit_id` 领域身份、把传输关联 ID 当作新提交资格、把 RunCommit 误称为 Product API 的唯一写接口、独立 Activation 写事务、`accepted_actions`、`activations[]`、部分提交、拼接多个 DeliveryAttempt、在 commit 前创建 ConversationMessage。

**RunCommitReceipt（运行提交回执）**:
Product API 为首次接纳的 `(advance_id, request_digest)` 保存的不可变响应；精确回放只返回该回执，
不构成新的提交或产品变化。
_Avoid_: 把幂等回放当作新 RunCommit、重算首次响应、回放时补发事件、仅按传输 request ID 去重。

**SettlementOnlyRunCommit（仅收敛运行提交）**:
尚未终态的 AgentRun 在执行 cutoff 后，只使用 cutoff 前已持久化成功结果完成的普通 RunCommit；
它不产生新的外部执行、proposal 或 outcome 类型。
_Avoid_: 对终态 Run 使用、cutoff 后补发模型请求、使用 cutoff 后才成功的结果、接受会启动 GenerationJob 的新 proposal、绕过 fence、第二次 RunCommit。

**RuntimeInvocation（运行时外部调用）**:
AgentAdvance 内具有成本或结果不可重建风险的逻辑外部调用，以 `(advance_id, call_slot)` 唯一定位；
由 GenerationJob 拥有的供应商调用不属于它。
_Avoid_: 把 `request_digest` 拼进身份、用 AI SDK step ID / Provider response ID / 随机 UUID 定位调用、分歧时静默创建新 Invocation、重复记录 GenerationJob / ProviderTask 已拥有的调用事实。

**CallSlot（调用槽位）**:
Blue Whale Runtime 为 AgentAdvance 内每个逻辑外部调用分配的确定性语义位置；它不依赖进程、
SDK 或 Provider 私有身份。
_Avoid_: Provider 私有标识、随进程变化的计数、让 SDK 绕过 InvocationLedger 自动重试、把一次协议修复覆盖原模型槽位。

**InvocationCoordinator（调用协调职责）**:
Runtime 在所有 RuntimeInvocation 外围承担的统一协调职责，确保每次物理 dispatch 都先取得 Product API
权威 InvocationAttempt 与 AttemptPermit；该名称不预设代码拓扑。
_Avoid_: 只在进程启动时读取一次策略后自行重试、两个 Worker 并发创建 attempt、让 Adapter 或 SDK 直接获得 retry 权威、把职责名称当作代码拓扑。

**AgentRunLeaseTakeover（运行租约接管）**:
Product API 在新 Worker 实际 claim 过期 lease 时完成的 AgentAdvance 执行权转移；它更新 Run fence，
但不把自然 lease expiry 本身解释为产品状态变化。详见 [ADR-0048](docs/adr/0048-time-deadline-and-lease-facts.md)。
_Avoid_: 把 expiry 当 takeover、生成新 `advance_id`、把接管当 failed / cancelled、撤销已消费 Permit 来伪造未 dispatch。

**AttemptPermit（调用尝试许可）**:
Product API 为一次可能产生 Provider 执行或计费的 InvocationAttempt 签发的受限单次能力；它绑定请求、
执行边界与成本上界，并必须在物理 dispatch 前消费。
_Avoid_: 把 Permit 当作多次调用额度、准入后修改请求、使用过期 fence、先 dispatch 再补 Permit、让 reconciliation 查询复用为新执行许可、撤销已消费 Permit 来伪造未调用。

**RuntimeAdapter（运行时适配器）**:
可替换的模型或远程只读工具协议实现，负责规范化请求、结果与调用证据；它不拥有持久状态、
调用身份、retry 或 AgentRun 决策权。
_Avoid_: `retryable: true` 作为 Adapter 决策、运行中静默更换 Adapter、Provider / SDK 私有对象跨边界、以 telemetry 事后补记未获准的调用。

**InvocationErrorEvidence（调用错误证据）**:
RuntimeAdapter 对 InvocationAttempt 错误事实的版本化安全记录；它只描述观察证据，不决定 retry、
fallback 或 AgentRun 终态。
_Avoid_: `retryable`、`shouldFailRun`、原始 Provider payload、不受控错误消息、堆栈、提示词、凭据或 Secret。

**RuntimeErrorPolicy（运行时错误策略）**:
Product API 为 AgentRun 固定的版本化错误处置规则，将 InvocationErrorEvidence 映射为允许的
RuntimeErrorDisposition。
_Avoid_: Worker 本地默认策略、运行中切换策略版本、仅凭 HTTP 状态码决定 Run 终态、把可选 retry 当作强制 retry。

**RuntimeErrorDisposition（运行时错误处置）**:
Runtime 按 RuntimeErrorPolicy 产生的内部控制分类：`retry`、`reconcile`、
`await_authoritative_state`、`stop_fence_lost` 或 `terminal_candidate`；它不是产品状态。
_Avoid_: 第五种 AgentAdvance 状态、Adapter 直接返回处置、把 fence 丢失或 outcome_unknown 当作 failed。

**AgentRunFailure（运行失败事实）**:
Product API 通过 RunCommit 接纳的 AgentRun `failed` 终态事实，关联稳定错误身份、证据与策略版本；
它表示 Run 无法安全继续，不表示某次 Provider 调用一定失败。
_Avoid_: 原始 Provider 错误、Worker 堆栈、自由文本用户消息、从 InvocationAttempt 状态直接推导 failed、迟到结果自动重开终态 Run。

**InvocationAttempt（调用尝试）**:
RuntimeInvocation 下单次可能越过 Provider 边界并产生执行或计费的追加式事实；它区分未 dispatch、
执行中、成功、确定失败与结果不明，不被 retry 覆盖。
_Avoid_: retry 覆盖原 attempt、让 `outcome_unknown` 的 attempt 复用原成本预留、把 reconciliation 当作新调用或 Provider attempt、用过期 AgentRun lease 创建 attempt、让迟到证据回报权限升级为产品状态写权限。

**InvocationLedger（调用台账）**:
Product API 拥有的 RuntimeInvocation 与 InvocationAttempt 持久运营记录；它保存外部调用与结果不明
事实，但不推进 AgentRun 或替代 RuntimeCheckpoint。
_Avoid_: 从调用成功直接推导 AgentRun 完成、把超时 / AbortSignal / lease 过期等同于失败或未调用、用 `abandoned_before_dispatch` 掩盖可能已 dispatch 的请求、终态后创建新 attempt、无限期核对、把状态查询或原结果取回误算成 retry、用 partial chunks 标记成功、覆盖结果不明的原 attempt、只保存完成状态、永久保存完整提示词 / 结果、保存供应商私有对象、凭据或 Secret。

**Single Proposal Commit Boundary（单提议提交边界）**:
每次 AgentAdvance 最多接纳一个业务原子副作用 proposal，并与其他 outcome 互斥；模型返回多个
副作用 tool call 是必须整轮拒绝并受限修复的协议错误。详见 [ADR-0050](docs/adr/0050-stateless-agent-advance-and-invocation-boundary.md)。
_Avoid_: `actions[]`、部分接纳多个动作、把 Activation 放入 proposal、隐式 fan-out/fan-in、把有依赖的动作提前批量提交。

**RuntimeCheckpoint**（运行时检查点）:
与活动 AgentRun 绑定、由 Runtime 解码的版本化不透明恢复状态；它使用
`agent-runtime-checkpoint/v1` canonical codec，不是产品事实或 SDK / Provider 对象快照。
_Avoid_: 把 RuntimeCheckpoint 当作产品事实；直接序列化 AI SDK / Provider 内部对象；保存 pin、stream、usage、资源正文、凭据或临时 Secret；让运行时检查点独立推进产品状态。

**AgentActionProposal（Agent 动作提议）**:
Agent 基于当前意图提出的单个业务原子动作，不是命令或授权；一个 proposal 可以表达同一动作的
多个输出。
_Avoid_: 把输出数量拆成多个 proposal；把模型输出直接当作命令；把用户素材、外部内容或工具结果中的文字当作授权。

**CostReservation（成本预留）**:
产品控制面为一次可能计费的 InvocationAttempt 或 ProviderGenerationAttempt 保留的最坏成本额度；
它按可证明结果结算或释放，是运营事实而非账单。
_Avoid_: 取消 Run 时批量释放所有预留、retry 复用结果不明的预留、usage 缺失时按零成本、永久冻结完整预留、用户确认后突破硬额度、把成本预留当作计费订单。

**UnresolvedProviderExposure（未决供应商成本敞口）**:
ProviderGenerationAttempt 的限时费用核对结束后仍缺少精确成本证据时，按冻结价格策略记录的有上限
平台风险事实；它承接并释放临时 CostReservation，迟到供应商账单只能形成追加调整。
_Avoid_: 用户账单、零成本、永久冻结完整预留、覆盖历史结算、用迟到账单重开 GenerationJob。

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

### 计费与货币

> 计费域术语适用于 `blue_whale_api`（开源 new-api 二开）。统一 RMB 决策见 [ADR-0021](docs/adr/0021-unified-rmb-billing.md)。

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

### 支付（payment）

> 支付域术语适用于 `blue_whale_api`（Go，充值/quota）与 Payment Gateway（支付通道）。

**Payment Gateway（支付网关）**:
在 Go 继续拥有订单与 quota 账本权威的前提下，负责对接微信/支付宝渠道并回传已验证支付结果的独立支付通道。
_Avoid_: blue-whale-pay（历史 Java/Dubbo 目标名称）、订单服务、账本服务

**blue-whale-pay**（历史术语，已废弃）:
曾指规划中的 Java 支付通道；Node.js/TypeScript 目标架构统一使用 Payment Gateway，不再以此名称指代当前目标单元。
_Avoid_: Payment Gateway、jeepay（参考项目，非本项目服务名）

**jeepay**:
本需求参考的开源支付系统（计全支付，SpringBoot 3.3.7），只移植其渠道 SDK 对接经验，不整体引入。
_Avoid_: 当作本项目服务；认为要整套搬入或独立部署

**充值链路（topup flow，Go 发起 Java 当通道）**:
Go 充值页发起、Java blue-whale-pay 当纯支付通道、Go 仍是订单与 quota 账本唯一权威的支付数据流；Java 只负责下单与回调验签，结果经 Dubbo 回写 Go。
_Avoid_: 把订单或账本权威挪到 Java；前端直发 Java 绕过 Go

**confirmTopUp**:
Go 暴露给 Java 的 Dubbo 回写接口，带订单级幂等守卫（仅 top_ups.status==pending 时加 quota），是支付成功回写 quota 的唯一入口。
_Avoid_: 裸调 IncreaseUserQuota 做回写（它非幂等，重复调会多加 quota，见 service/funding_source.go:61）

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
