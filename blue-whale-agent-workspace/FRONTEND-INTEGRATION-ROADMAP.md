# 前端接通后端 PRD 模块路线图

> 跨 session 的进度索引。新 session 读此文件即可接上,不依赖对话记忆。
> 最后更新:2026-07-05

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

### 🔲 10. 长对话、内容版本与历史资产索引(P1 评估)
- **P0 边界**:先支持用户在同一个 Agent 对话中切换两个产品方向。P0 不实现完整 `content_version` 系统、不做长期对话摘要系统、不做完整历史版本索引。
- **P0 最小可用建议**:
  - 后端每轮至少保存当前产品方向和上一个产品方向的结构化摘要。
  - 用户切换到新的产品方向时,用户侧话术使用"这是一个新的产品方向。你想继续在当前项目中进行,还是新建一个项目?";不要说"替换"或"覆盖"。
  - 如果用户选择继续在当前项目中进行,内部可先用轻量标记区分 current / previous;旧内容不删除,但不再作为当前主线。
  - 用户说"用前面的产品重新生成一张产品图"时,应引用上一个产品方向的素材或 `asset_understanding`,创建新的 image GenerationJob,不要覆盖旧图。
  - 如果用户换成完全不同品类或视频目标,只问"继续在当前项目中进行,还是新建一个项目?",不要向用户暴露 workflow / stage / run。
- **P1 需要评估的完整方案**:
  - **状态持久化**:每轮更新 `project_state`,保存 active product / current_stage / selected_skill / stage_plan / active_jobs / active_canvas_node_ids。
  - **内容版本**:新增 `content_versions`,用于处理换产品、替换内容、返回前面产品。字段至少包含 `project_id`、`subject_summary`、`product_asset_ids`、`brief`、`selected_skill`、`stage_plan`、`storyboard`、`status(active/inactive/superseded)`、`created_from`。
  - **完整历史**:分开保存 `messages` 和 `agent_events`;消息给用户回看,events 给工程追踪版本切换、确认阶段、生成任务和恢复动作。
  - **历史摘要**:新增 `conversation_summary`,在长对话、阶段确认、产品切换、生成完成或 token 超阈值时生成结构化摘要;摘要记录 key_decisions / open_questions / user_preferences / version_history。
  - **版本索引**:从 `content_versions` 聚合轻量 `version_index`,让 Agent 能理解"前面的产品/刚才那版"指向哪个产品方向或资产,而不是翻完整聊天。
  - **历史资产引用生成**:支持 `historical_asset_reference_generation`;用户说"用前面的产品重新生成一张图"时,引用历史产品资产,生成结果写成新的 Canvas Node。
  - **恢复版本**:支持 restore content version;用户说"还是用回刚才那个产品"时,默认恢复旧版本为 active,不是从零重生成。
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
- **Agent 对话(2026-07-05 锁定)**:后端 P0 三链路全做(Direct / Image-to-Video / Full Canvas,避免返工);前端无分阶段,过程消息(brief/skill/storyboard/review/visible_reasoning)P0 全展示(文字气泡),P1 仅可选美化;新增 `optimized_prompt_preview` 消息类型(用户友好版,可展示),区别于原始 `optimized_prompt`(发给 Provider,永不进 message);`forced_skill_id` 仅决定 skill 选择那一步,不锁后续 Stage;Agent turn 结束后未完成 Job 由 `active_jobs` + 独立 `/api/jobs/{id}/stream` 接管,重连失败再轮询 `GET /api/jobs/{id}`。
- **产品切换 P0 边界(2026-07-05 锁定)**:P0 先支持同一 Agent 对话内两个产品方向切换;不做完整内容版本系统。完全不同品类或目标时,用户侧只问"继续在当前项目中进行,还是新建一个项目?",不说替换/覆盖,不暴露 workflow。完整状态持久化、历史摘要、版本索引放 P1 评估。
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
| 11 | L1 意图识别判定暴露 + 可对话推翻(范围从「4 链路」缩小到「3 分流」) |
| 12 | L1 歧义默认轻量编排(Full Canvas 必须显式触发) |
| 13 | Dock = 纯参数透传,**零优化**(连技术规整都不做);提示词优化只在 Agent。`README` 原则 4 限定 Agent 链路 |
| 14 | Dock **零 understanding**(图直传 Provider,Provider 自己消费);understanding 硬约束限定 Agent;Image-to-Video 两边都能做(机制不同) |
| 15 | Agent 轻量编排 = 追问(仅方向歧义)+ 优化提示词(硬停)+ 生成;Skill 有匹配才用(无匹配跳过);L1 意图识别分流(轻量 / Full Canvas / 非生成) |

**受影响文档(均已本次落盘)**:`backend_implementation_contract.md` / `BACKEND-API-PRD.md` / `confirmation_gate.md` / `generation_route_decision.md` / `progressive_disclosure.md` / `skill_generation_priority.md` / `canvas_state_rules.md` / `video_agent_canvas.md` / `image_understanding.md` / `AGENT-CONVERSATION-PRD.md` / `README.md`。

## 建议推进顺序

P0 主链路优先:**模块 5(Project)→ 模块 2(BottomDock)→ 模块 3(SSE 映射)→ 模块 4(Job 生命周期)→ 模块 7(上传)→ 模块 6(身份)→ 模块 8(目录)→ 模块 9(错误码)**。Project 和 BottomDock 强耦合(直生需要 project_id),建议先一起定。

## 不要做的事

- 不主动改 `blue_whale/` 前端代码(用户没要求)
- 不读/改 `deer-flow/`
- 不用 `gh` CLI;Gitee MCP 当前 token 访问该仓库 404,本任务是本地文档工作
- 不重写已完成的模块 1 三份产出
