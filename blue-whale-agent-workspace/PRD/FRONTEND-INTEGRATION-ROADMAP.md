# 前端接通后端 PRD 模块路线图

> 🔗 **关联**：wayfinder map #IK29RN（三链路总图）· 需求 #IJZ7Z7 / #IJZ7Z8 / #IJZ7Z9
> **同批 PRD**：[AGENT-CONVERSATION-PRD.md](./AGENT-CONVERSATION-PRD.md) · [BACKEND-API-PRD.md](./BACKEND-API-PRD.md) · [FRONTEND-SKILL-PANEL-PRD.md](./FRONTEND-SKILL-PANEL-PRD.md)

> 跨 session 的进度索引。新 session 读此文件即可接上,不依赖对话记忆。
> 最后更新:2026-07-06

## 怎么用这份文件

- 每个模块标状态:✅ 已完成 / 🔲 待做 / 🟡 进行中
- 已完成模块只列产出路径,不重复内容
- 待做模块列:**现状缺口** + **需 PM 拍板的关键决策** + **关联文件**
- 拍板的决策汇总在文末「已锁定决策」
- 写新模块 PRD 时参照 `skill/references/frontend_canvas_interaction_contract.md` 的颗粒度(行为契约,不写实现)

## 前端现状基线(供后续模块引用,不重复扫)

- 纯前端 SPA,零 `fetch`/`axios`/`WebSocket`/`EventSource`/Server Action/API Route
- 零 `localStorage`/`sessionStorage`,唯一跨页通道是 URL `?prompt=`
- 三块 state 各锁组件:Canvas nodes(`app/canvas/page.tsx:31`)、对话 messages(`AgentChatPanel.tsx:33`)、dock 参数(`dock/BottomDock.tsx:34-44`)——无全局 store
- 模型目录硬编码 4 处(且不一致):`components/AgentComposer.tsx`、`app/canvas/_canvas/components/AgentChatPanel.tsx`、`app/canvas/_canvas/constants.ts`、`components/ImageModelSettingsPopover.tsx`
- **BottomDock 是断头路**:无 `onGenerate` 回调
- TopBar 新建/打开/重命名项目三个按钮全空 onClick
- 首页"开始生成"裸 `router.push('/canvas?prompt=...')`,参数全丢
- 上传走 `FileReader.readAsDataURL` → base64(`app/canvas/page.tsx:174-192`)

## 模块清单

### ✅ 1. Skill 面板(已完成)
- 产出:`FRONTEND-SKILL-PANEL-PRD.md`
- 配套改动:`forced_skill_id` 权威定义在 `skill/references/backend_implementation_contract.md` Agent Turn 字段(语义:仅决定 skill 选择,不锁后续 Stage,不持久化为 auto);`skill/rules/skill_generation_priority.md` 加「Skill 来源与选择」;Agent 侧承接见 `AGENT-CONVERSATION-PRD.md` §5
- 链路闭合:Skill → forced_skill_id/auto 候选 → Agent 决策

> **产出记录(2026-07-05)**:从 `BACKEND-API-PRD.md` §5.6 抽出 `AGENT-CONVERSATION-PRD.md`,闭合 Skill ↔ Agent 接入点的文档断头路。BACKEND-API-PRD 重定位为核心基础设施文档(§5.6/§5.8 抽空成指针)。

### ✅ 2. BottomDock 直生闭环(已完成 — 决策 1-6+13-14)
- **产出**:Dock = 纯参数透传(零优化零 understanding),产物落画布不进对话流;Agent 通过 `@` 引用画布素材;Image-to-Video 两边都能做(Dock 直传 Provider / Agent understanding+优化)。详见文末「已锁定产品决策」。
- **已锁定的原待拍板**:直生只上画布不进对话流;并行入口允许(同一 Project 两条路径可并行 Job);project_id 由模块 5 解决(进画布即有)。
- **实现侧待办**:`BottomDock.tsx` 的 `onGenerate` 接通 `POST /generate`(前端代码,文档侧已闭合)。
- **关联**:`BACKEND-API-PRD.md` §5.4 / §6;`generation_route_decision.md`;`app/canvas/_canvas/components/dock/BottomDock.tsx`

### 🔲 3. SSE 事件 → 前端渲染映射表(P0)
- **缺口**:`AGENT-CONVERSATION-PRD.md` §3 列了 SSE 全事件序列,前端如何消费/断线兜底/事件→UI 翻译表未定义。现有 contract 只写"消息怎么展示",没写"事件流怎么消费"
- **待 PM 拍板**:
  - 每种事件(visible_reasoning/message/canvas_update/job_started/job_progress/job_done/turn_done)触发什么 UI 变化
  - 事件乱序/丢失怎么办
  - SSE 断线后 `GET /jobs/{id}` 轮询兜底的频率和退出条件
  - 一条 turn 内多个 canvas_update 怎么叠加到画布
- **关联**:`AGENT-CONVERSATION-PRD.md` §3 / §5.2;`BACKEND-API-PRD.md` §8;`skill/references/frontend_canvas_interaction_contract.md`

### 🔲 4. 生成任务前端生命周期 / "刷新不丢"(P0)
- **缺口**:后端 `active_jobs` 暴露进行中任务,前端表现未定义
- **待 PM 拍板**:
  - generating 卡显示进度条还是只显示"生成中"
  - 刷新回来看到 generating 卡要不要续推 SSE
  - 任务失败时画布卡 vs 对话各显示什么文案
  - 多 Job 并行时阶段状态怎么呈现
- **关联**:`BACKEND-API-PRD.md` §8 / §10(验收第 2 条);`AGENT-CONVERSATION-PRD.md` §5.2 / §7

### ✅ 5. Project 管理 UX(已完成 — 决策 7-9)
- **产出**:首页输入 → 立即建 Project(带 `initial_prompt`)→ 跳画布;`initial_prompt` 预填 AgentChatPanel(不自动开跑);自动保存(结构 2s / viewport 5s / beforeunload flush / 多 tab 不处理);列表 updated_at DESC;删除二次确认;双击重命名;新建入口(首页 + 列表页空 project)。详见文末「已锁定产品决策」。
- **实现侧待办**:TopBar 三按钮 + 首页跳转接通 `POST /projects`(前端代码,文档侧已闭合)。
- **关联**:`BACKEND-API-PRD.md` §5.5;`app/canvas/_canvas/components/TopBar.tsx`;`components/AgentComposer.tsx`

### 🔲 6. 匿名身份与设备识别(P0)
- **缺口**:contract 完全没提"用户是谁"
- **待 PM 拍板**:
  - UUID 何时生成(首次进站?首次点生成?)
  - 用户能否看到自己的身份
  - 清缓存后 Project 算谁的;P2 登录时匿名数据怎么迁移
- **关联**:`BACKEND-API-PRD.md` §4 / §5.1 / §11(风险)

### 🔲 7. 资产上传交互契约(P0)
- **缺口**:presign 直传的 UX 未定义,现状是 base64
- **待 PM 拍板**:
  - 上传中画布显示什么(占位卡?进度?)
  - 上传失败怎么重试、完成前能否关页面
  - 上传是独立动作还是嵌进生成流程(对话里说"用这张图"怎么触发上传)
- **关联**:`BACKEND-API-PRD.md` §5.2 / §9 第 3 条(上传);`app/canvas/page.tsx:174-192`

### 🔲 8. 参数目录 catalog 内容与降级(P0)
- **缺口**:4 处硬编码要收敛到 `GET /api/catalog`,但目录内容来源和降级策略未定
- **待 PM 拍板**:
  - P0 必须有的模型/比例/分辨率权威清单
  - 目录拉取失败时兜底硬编码还是禁用生成
  - 后端新增模型时前端怎么动态展示、积分 multiplier 怎么显示
- **关联**:`BACKEND-API-PRD.md` §5.3 / §10(验收第 4 条)

### 🔲 9. 错误码 → 用户文案映射(P0)
- **缺口**:后端 §9 第 4 条列 5 种错误码,前端每种显示什么没说
- **待 PM 拍板**:每种错误(quota_exhausted/content_moderation_rejected/upstream_timeout/asset_unavailable/asset_understanding_missing)的用户文案、是否可重试、重试入口
- **关联**:`BACKEND-API-PRD.md` §9 第 4 条(错误码)

### 10. 长对话、内容版本与历史资产索引(P0 + P1)
- **P0 边界(2026-07-13 更新)**:`content_versions`(结构化产品记忆)、历史资产引用、恢复版本**已从 P1 提到 P0** —— 支持同对话内多产品历史切换,容忍但有界(阈值引导新 project)。完整规格见 `PRD/PRODUCT-HISTORY-PRD.md`。P0 仍不做长期对话摘要(`conversation_summary`)、版本索引(`version_index`)、messages / agent_events 分离完整历史。
- **P0 最小可用建议**:
  - 后端每轮至少保存当前产品方向和上一个产品方向的结构化摘要。
  - 用户切换到新的产品方向时,用户侧话术使用"这是一个新的产品方向。你想继续在当前项目中进行,还是新建一个项目?";不要说"替换"或"覆盖"。
  - 如果用户选择继续在当前项目中进行,内部可先用轻量标记区分 current / previous;旧内容不删除,但不再作为当前主线。
  - 用户说"用前面的产品重新生成一张产品图"时,应引用上一个产品方向的素材或 `asset_understanding`,创建新的 image GenerationJob,不要覆盖旧图。
  - 如果用户换成完全不同品类或视频目标,只问"继续在当前项目中进行,还是新建一个项目?",不要向用户暴露 workflow / stage / run。
- **P1 需要评估的完整方案**:
  - **状态持久化**:`project_state` 完整持久化(active product P0 已覆盖;完整 stage_plan / active_jobs 持久化 P1)。
  - ~~**内容版本**~~:**已提 P0**(见 `PRODUCT-HISTORY-PRD.md`)。
  - ~~**历史资产引用生成**~~:**已提 P0**(见 `PRODUCT-HISTORY-PRD.md` §5.1 跨产品引用)。
  - ~~**恢复版本**~~:**已提 P0**(见 `PRODUCT-HISTORY-PRD.md` §5.1 切回历史产品)。
  - **完整历史**:分开保存 `messages` 和 `agent_events`;消息给用户回看,events 给工程追踪版本切换、确认阶段、生成任务和恢复动作。
  - **历史摘要**:新增 `conversation_summary`,在长对话、阶段确认、产品切换、生成完成或 token 超阈值时生成结构化摘要;摘要记录 key_decisions / open_questions / user_preferences / version_history。**即对话压缩层,P0 不做(Codex/Claude Code/OpenCode 压缩都有损),详见 PRODUCT-HISTORY-PRD §3 / §9。**
  - **版本索引**:从 `content_versions` 聚合轻量 `version_index`,让 Agent 能理解"前面的产品/刚才那版"指向哪个产品方向或资产,而不是翻完整聊天。
  - **阈值校准**:产品数阈值(意向 3)按真实用户行为校准;`content_versions` superseded 淘汰策略。详见 PRODUCT-HISTORY-PRD §9。
- **每轮 Agent 输入建议(P1)**:
  - 最新用户消息
  - 当前 `project_state`
  - active `content_version`
  - 最近 5-10 轮消息
  - `conversation_summary`
  - `version_index`
  - 当前 canvas nodes 摘要
  - 当前 active jobs
- **风险**:如果 P1 不做状态持久化 + 历史摘要 + 版本索引,长对话、多产品切换、"回到前面产品"、"引用历史产品重新生成"会依赖模型上下文记忆,容易丢状态或把新旧产品素材混在一起。
- **关联**:`AGENT-CONVERSATION-PRD.md`;`BACKEND-API-PRD.md` Project / Job / messages 数据模型;`skill/references/backend_implementation_contract.md`;后续需补 backend contract 和前端历史版本 UX。

## 已锁定产品决策(全模块共享,别再问)

- Skill 面板 P0;创建 tab 隐藏;库 ⊃ 我的;引用非副本(跟随更新);Use 一次性不改 auto;auto 候选池后端自读不前端传;forced > auto > 未指定。
- **Agent 对话(2026-07-05 锁定,2026-07-06 收口)**:P0 按两入口落地——Dock 直生负责 Direct Image / Direct Video / Image-to-Video;Agent 对话按 `decision_branch` 覆盖 lightweight / full_canvas / prompt_only / revise / product_switch / confirm / consult 等分支。前端无分阶段,过程消息(brief/skill/storyboard/review/visible_reasoning)P0 全展示(文字气泡),P1 仅可选美化;新增 `optimized_prompt_preview` 消息类型(用户友好版,可展示),区别于原始 `optimized_prompt`(发给 Provider,永不进 message);`forced_skill_id` 仅决定 skill 选择那一步,不锁后续 Stage;Agent turn 结束后未完成 Job 由 `active_jobs` + 独立 `/api/jobs/{id}/stream` 接管,重连失败再轮询 `GET /api/jobs/{id}`。
- **产品切换 P0 边界(2026-07-05 锁定,2026-07-13 更新)**:P0 已支持同对话内**多产品历史**切换(`content_versions` 从 P1 提 P0,见 `PRODUCT-HISTORY-PRD.md`);容忍但有界,到阈值(意向 3)引导新 project;完全不同品类强推新 project;切回不主动推进要追问。不说替换/覆盖,不暴露 workflow / stage / superseded。对话压缩(`conversation_summary`)、版本索引(`version_index`)仍放 P1 评估。
- 错误码、目录、身份、上传、Job 生命周期等模块的决策**尚未锁定**(Project、直生于 2026-07-06 锁定,见下)。

### 2026-07-06 锁定:Dock 直生 ↔ Agent 编排重构(决策 1-15)

**核心重构**:职责按「要快 / 要好」重划——Dock = 所有直接生成(纯参数透传,零优化零 understanding);Agent = 单链路对话编排(L1 意图识别 → 轻量编排 / Full Canvas),永远走 Prompt Optimizer。Direct 链路从 Agent 移除。

| # | 决策 |
|---|---|
| 1 | Dock 直生 = 无上下文独立链路,产物落画布;Agent 引用画布节点 |
| 2 | `@` 引用素材(P0),自然语言指代放 P1,复用 `reference_asset_ids` |
| 3 | understanding 触发 = 仅 `@` 引用(Agent 链路);数据挂 asset 表(`understanding_status`+`understanding_data`);ChatMessage variant 降为派生展示;lazy+缓存。修了 contract/canvas_state_rules/image_understanding 三处冲突 |
| 4 | Agent 每轮拿画布**文本元数据**(active 产品方向),不扫视觉 |
| 5 | Agent 不主动推断隐式指代,反问带候选 |
| 6 | title 三位一体(prompt 派生 / 文件名 / `understanding.subject` 覆盖)+ 可变 + 可手改(`is_user_titled`) |
| 7 | 首页输入 → 立即建 Project(带 `initial_prompt`)→ 跳画布 |
| 8 | `initial_prompt` 预填输入框,不自动开跑 |
| 9 | UX 默认值(自动保存 2s / viewport 5s / beforeunload flush / 多 tab 不处理;列表 updated_at DESC;删除二次确认;双击重命名;新建入口) |
| 10 | Full Canvas = **4 硬停**(Brief / 分镜 / 视觉 / 视频)+ **3 软过**(Skill / 阶段计划 / 审核) |
| 11 | L1 意图识别判定暴露 + 可对话推翻(范围从旧链路缩小到 Agent 分支:lightweight / full_canvas / prompt_only / 非生成) |
| 12 | L1 歧义默认轻量编排(Full Canvas 必须显式触发) |
| 13 | Dock = 纯参数透传,**零优化**(连技术规整都不做);提示词优化只在 Agent。`README` 原则 4 限定 Agent 链路 |
| 14 | Dock **零 understanding**(图直传 Provider,Provider 自己消费);understanding 硬约束限定 Agent;Image-to-Video 两边都能做(机制不同) |
| 15 | Agent 轻量编排 = 追问(仅方向歧义)+ 优化提示词(硬停)+ 生成;Skill 有匹配才用(无匹配跳过);L1 意图识别分流(轻量 / Full Canvas / 非生成) |

**受影响文档(均已本次落盘)**:`backend_implementation_contract.md` / `BACKEND-API-PRD.md` / `confirmation_gate.md` / `generation_route_decision.md` / `progressive_disclosure.md` / `skill_generation_priority.md` / `canvas_state_rules.md` / `video_agent_canvas.md` / `image_understanding.md` / `AGENT-CONVERSATION-PRD.md` / `README.md`。

### 2026-07-06 锁定:Agent 判定分层重构(决策 16-20)

**核心重构**:判定分层——硬状态下沉后端代码(铁闸),意图方向+路由甩 L1 轻量 classifier(haiku 级,软建议),主 Agent 瘦到「读 `decision_context` → `switch(decision_branch)` → 确认门细判」。废除 Full Canvas 内部独立 L2,全场景统一 `decision_branch`。

| # | 决策 |
|---|---|
| 16 | **判定分层**:硬状态→后端代码;意图方向+路由→L1 classifier(haiku 级,软建议);确认门四分类+输出+调度→主 Agent |
| 17 | **decision_context**:后端算好单一 `decision_branch` + L1 软建议 + 硬事实,整体喂主 Agent |
| 18 | **主 Agent 瘦身**:删 7 级优先级排序 + 语义分流大段,改 `switch(decision_branch)` |
| 19 | **优先级**:`generating` 物理最高 → L1 意图优先(product_switch > new_task > prompt_only > consult > revise > responding_to_confirm > ambiguous)→ 硬状态 tiebreak |
| 20 | **confirm_pending 后端铁闸 + L1/L2 统一**:`advance_stage` 必须独立校验 `has_ready_node`;废除 L2,全场景统一 `decision_branch` |

**与决策 11/12/15 的关系**:那三条已锁「L1 暴露可推翻 + 歧义默认轻量 + L1 分流」。本轮(16-20)把它们工程化——L1 = 独立轻量 classifier(不是主 Agent 自判),硬状态下沉后端代码,主 Agent 瘦身到 switch 收口。是落地细化,不冲突。

**受影响文档(均已本次落盘)**:
- 新增 `skill/rules/decision_layer.md`(判定分层权威:三层分工 + `decision_context` + `decision_branch` switch 表 + 组合器优先级 + 推翻规则 + L1/L2 统一)
- 改 `skill/workers/director_agent.md`(删 Step1/4/5/6/7,改 `switch(decision_branch)` + 推翻规则 + confirm_pending 四分类;必读规则加 decision_layer;总流程图加「后端算 decision_context」前置)
- 改 `skill/references/backend_implementation_contract.md`(`decision_context` 字段+数据结构节、硬约束 13 `advance_stage` 铁闸、L1 调用时机)
- 改 `AGENT-CONVERSATION-PRD.md`(§0 必读加 decision_layer、§2 turn 前置算 decision_context、§4 硬约束 7 铁闸)
- 改 `skill/workflows/video_agent_canvas.md`(Stage 0 承接 `decision_branch`,删 L2)
- 改 `skill/workflows/direct_generation.md` / `image_generation_prompt.md`(Stage 1 读 `decision_context`)
- 改 `skill/rules/generation_route_decision.md`(L1 明确为独立轻量 classifier,路由判定移到 L1)
- 改 `skill/rules/confirmation_gate.md`(confirm_pending branch 由 decision_context 算出 + `advance_stage` 铁闸呼应)
- 轻量呼应:`BACKEND-API-PRD.md` §6 / `skill/rules/skill_generation_priority.md` / `README.md`(L1 描述微调为「轻量 classifier」)
- 记录:`skill/memory/workflow_decisions.md`(判定分层 + L1/L2 统一)

### 2026-07-08 锁定:候选图消歧(决策 21)

**核心**:画布多图 + 用户未指明时不默认扫描/不猜,在 `@` 引用解析阶段反问带候选(对齐已锁决策 3/5)。`active_asset_id`(画布选中)视为明确指向,P0 选中即识别不追问。

| # | 决策 |
|---|---|
| 21 | 候选范围 = `active_product_context` 内 `ready`/`confirmed` image(不取全部图,跨产品引用必须显式,见 `product_switch_p0.md` 第 4/5 类);消歧挂 `@` 引用解析阶段,不挂 understanding workflow 内;优先级 `reference_asset_ids`(@) > `active_asset_id`(选中) > 候选=1 > 候选≥2 反问;`active_asset_id` P0 选中即识别不追问;不认纯文字编号;id 统一 asset_id(pointed 复用 `reference_asset_ids`,删 pointed_node_ids);多图引用留 @ 各 asset understanding;前端 node_id/asset_id 全后端生成 |

**与决策 3/5 的关系**:决策 3(understanding 仅 @ 触发)+ 决策 5(反问带候选)已隐含消歧。本轮(21)细化候选范围、优先级、active 选中态、id 统一、答法——是决策 3/5 的落地细化,不冲突。

**受影响文档(均已本次落盘)**:`image_understanding.md` / `image_understanding_agent.md` / `decision_layer.md` / `backend_implementation_contract.md` / `revise_canvas.md` / `progressive_disclosure.md` / `frontend_canvas_interaction_contract.md`(skill/ 7 处)+ `AGENT-CONVERSATION-PRD.md`(§0/§2/§4/§7)+ `BACKEND-API-PRD.md`(确认对齐决策 3,未改)+ 本 ROADMAP + `workflow_decisions.md`。

## 建议推进顺序

P0 主链路优先:**模块 5(Project)→ 模块 2(BottomDock)→ 模块 3(SSE 映射)→ 模块 4(Job 生命周期)→ 模块 7(上传)→ 模块 6(身份)→ 模块 8(目录)→ 模块 9(错误码)**。Project 和 BottomDock 强耦合(直生需要 project_id),建议先一起定。

## 不要做的事

- 不主动改 `blue_whale/` 前端代码(用户没要求)
- 不读/改 `deer-flow/`
- 不用 `gh` CLI;Gitee MCP 当前 token 访问该仓库 404,本任务是本地文档工作
- 不重写已完成的模块 1 三份产出
