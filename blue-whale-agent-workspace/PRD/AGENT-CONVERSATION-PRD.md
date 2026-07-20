# Agent 对话交付 PRD（P0）

> 🔗 **关联**：需求 #IJZ7Z7 · wayfinder map #IK29RN（前端接后端三链路总图）
> **同批 PRD**：[FRONTEND-SKILL-PANEL-PRD.md](./FRONTEND-SKILL-PANEL-PRD.md)（§5 Skill 接入）· [BACKEND-API-PRD.md](./BACKEND-API-PRD.md)（§5.6 抽出源）· [路线图](./FRONTEND-INTEGRATION-ROADMAP.md)

> 给前后端工程师的 Agent 对话交付契约。从 `BACKEND-API-PRD.md` §5.6 抽出,闭合 Skill 面板 ↔ Agent 对话的接入点断头路。
> 版本:P0 · 日期:2026-07-05

## 0. 怎么读这份文档

实现前**必读** workspace 三份契约 + 两份规则:

- `skill/references/backend_implementation_contract.md` —— **权威定义层**。Agent Turn 字段、Canvas Node、ChatMessage variant(对话消息类型)、Stage、Workflow Run 都在这里定义,本文不重复字段定义,只引用。
- `skill/rules/decision_layer.md` —— **判定分层架构**。三层分工(硬状态代码 / L1 轻量 classifier / 主 Agent)+ `decision_context` + `decision_branch` switch 表。turn 前置算 `decision_context` 的权威。
- `skill/references/frontend_canvas_interaction_contract.md` —— 前端展示边界(画布 = 素材,对话 = 过程)与验收颗粒度。
- `skill/rules/confirmation_gate.md` —— 确认门四分类(明确确认 / 弱继续 / 修改意图 / 等待中)。
- `skill/rules/generation_route_decision.md` —— 两条入口（Dock 直生 / Agent 对话）的路由判定。
- `skill/workflows/image_understanding.md` —— 候选图消歧（`@` 引用解析阶段，画布多图未指明时反问带候选）。

本文定义 backend contract **未覆盖**的部分:

- **SSE wire 格式**(事件序列 + 各事件 payload)——传输层契约,contract 当前不定义。
- **接入点契约**(Agent ↔ Skill 面板 / BottomDock / Canvas 的边界)。

> 编排规则本身(brief→skill→分镜→视觉→视频 的 worker 协作)不在本文,继续引用 `skill/rules/*` 与 `skill/workflows/*`。

---

## 1. 范围(P0)

### 后端 P0 —— 两入口 + Agent 内部分支

P0 按两条入口落地，避免把 Dock 直生和 Agent 编排混成一条链路：

1. **BottomDock 直生**：Direct Image / Direct Video / Image-to-Video，纯参数透传，零 Prompt Optimizer，零 understanding。
2. **Agent 对话**：后端先算 `decision_context`，主 Agent 按 `decision_branch` 收口。Agent 内部分支包括 `new_task + lightweight`、`new_task + full_canvas`、`prompt_only`、`revise_canvas`、`product_switch`、`consult`、`confirm_pending` 等。

> Full Canvas 的**前端**过程消息展示(brief / skill / storyboard 等对话卡)见 §6 P0/P1 边界。

### 前端 —— 无分阶段,过程消息全展示

过程消息(`visible_reasoning` / `brief` / `skill_recommendation` / `storyboard` / `review` / `optimized_prompt_preview` 等)在 P0 就**全部作为对话文字气泡展示**。展示边界遵循 `frontend_canvas_interaction_contract.md`:**画布只放素材(图/视频),对话放一切过程**。

> 本文 P1 只覆盖**前端展示维度**:可选的过程消息结构化美化(如把 storyboard 渲染成分镜表),非阻塞,P0 用纯文字气泡即可。
> P1 另有一条独立工作线——**长对话 / 状态持久化 / 历史版本**(完整 `messages`+`agent_events` 历史、`conversation_summary`、`content_versions`、版本索引、历史资产引用、版本恢复),不在本文,见 `FRONTEND-INTEGRATION-ROADMAP.md` 模块 10(P1 评估)。

---

## 2. 输入

### `POST /api/projects/{project_id}/agent/turn`

用户在 AgentChatPanel 发一句话。后端先算 `decision_context`,主 Agent 按 `decision_branch` 分流(轻量编排 / Full Canvas / prompt_only / 非生成等),逐段流式返回;必要时启动 GenerationJob。

```json
// req
{
  "text": "用户的自然语言",
  "forced_skill_id": "skl_xxx",          // optional，用户在 Skill 面板点 Use
  "reference_asset_ids": ["ast_xxx"],    // optional，用户 @ 引用的画布素材
  "active_asset_id": "ast_xxx"           // optional，用户画布选中（选中即识别，跳过消歧）
}
```

**字段语义**:

| 字段 | 必填 | 语义 |
|---|---|---|
| `text` | 是 | 用户的自然语言输入。 |
| `forced_skill_id` | 否 | 仅当用户在 Skill 面板点 `Use` 时携带。**仅决定 skill 选择那一步,不锁后续 Stage**;一次性指令,**不改变用户的 `auto` 状态**(不持久化)。权威定义见 `backend_implementation_contract.md` Agent Turn 字段。 |
| `reference_asset_ids` | 否 | 用户在对话框打 `@` 引用的画布素材。Agent 拿到 asset_id 后:若该 asset `understanding_status != ready`,先补做 `asset_understanding`(visible_reasoning 兜「我先看一下这张图」),再进图生图 / 图生视频链路。复用 `BACKEND-API-PRD.md` §5.4 直生入口的同名字段语义。 |
| `active_asset_id` | 否 | 用户画布**选中**的素材。**选中即识别,跳过候选图消歧反问**;与 `reference_asset_ids` 一样,asset 若 `understanding_status != ready` 先补做 `asset_understanding`。优先级:`reference_asset_ids`(@) > `active_asset_id`(选中) > 候选=1 唯一张 > 候选≥2 消歧反问。**语义 = 前端选中态透传**(见 `decision_layer.md` decision_context / `backend_implementation_contract.md` Agent Turn 字段):请求传入值直接作为 `decision_context.active_asset_id`,后端不重新从画布读;若与后端画布 selection 状态不一致,**以请求为准**(用户最新操作覆盖)。 |

**`forced_skill_id` 与 auto 候选池的关系**(详见 §5 接入点):

- 不传 `forced_skill_id` = 用户未手动指定,Agent 按既定规则(见 `skill/rules/skill_generation_priority.md`「Skill 来源与选择」)从 auto 候选池决定。
- **auto 候选池不在请求里传**。后端 Agent runtime 直接从 `/api/skills/mine?auto=true` 自读,保证与 Skill 面板状态同源。
- 冲突仲裁优先级:**`forced_skill_id`(Use)> auto 候选池 > 未指定**。

### turn 前置:算 decision_context

后端收到 `text` 后、主 Agent 开跑前,先算 `decision_context`(见 `backend_implementation_contract.md` + `skill/rules/decision_layer.md`):

1. 硬状态代码每轮必跑(零成本):`has_generating` / `has_ready_node` / `has_failed` / `awaiting_confirm` / `pending_workflow` / `current_stage` / `active_product_context` / `product_history_summary` / `active_asset_id` / `candidate_asset_ids`。(`previous_product_context` 已升级为 `product_history_summary`,支持同对话多产品历史,见 `PRD/PRODUCT-HISTORY-PRD.md` §6)
2. `has_generating=true` 直接短路到 `decision_branch=generation_in_progress`,**跳过 L1**。
3. 其余情况调 L1 轻量 classifier(haiku 级),得 `intent_direction` + 仅 `new_task` 带 `suggested_route`。
4. 后端代码按组合器优先级算出单一 `decision_branch`。
5. 整个 `decision_context` 喂主 Agent,主 Agent `switch(decision_branch)` 收口。

**`decision_context` 是后端 turn 内部,不进 SSE**——前端看到的仍是 §3 的事件序列(`visible_reasoning` / `message` / `canvas_update` / `job_*` / `turn_done`)。主 Agent 的分支判定体现在 `visible_reasoning` 与 `turn_done.requires_user_action` / `allowed_actions` 里。

---

## 3. 输出(SSE 全事件序列)

一条 SSE 连接,按需推送以下事件。事件类型与 payload:

```
event: visible_reasoning
data: {"title":"思考过程","items":["我看到画布里已有一张产品图。","我会先用电商产品图 Skill。"]}

event: message
data: {"type":"skill_recommendation","content":{ ... }}      // brief/skill/分镜/review 等过程消息

event: message
data: {"type":"plain_text","content":{"text":"看到你的产品图了,我会先做 3 个方向。"}}

event: message
data: {"type":"optimized_prompt_preview","content":{"text":"我帮你把提示词优化成了:近景特写,清晨桌面光线……"}}  // 用户友好版,可展示

event: canvas_update
data: {"node":{"node_id":"n_xxx","type":"image","status":"generating","asset_refs":[],"stage_id":"s_xxx"}}

event: job_started
data: {"job_id":"job_xxx","type":"image"}

event: job_progress
data: {"job_id":"job_xxx","status":"processing","progress":0.6}

event: job_done
data: {"job_id":"job_xxx","status":"succeeded","asset_id":"ast_yyy"}

event: canvas_update
data: {"node":{"node_id":"n_xxx","type":"image","status":"ready","asset_refs":["ast_yyy"]}}

event: message
data: {"type":"image_card","content":{"asset_id":"ast_yyy","node_id":"n_xxx"}}

event: turn_done
data: {"requires_user_action":true,"allowed_actions":["confirm","revise","retry"],"current_stage_id":"stg_xxx","active_job_ids":[]}
```

**失败流序列**(呼应 §4 硬约束 5:生成失败必写 `failed` 节点 + `error` 消息,不静默失败):

```
event: job_started
data: {"job_id":"job_zzz","type":"image"}

event: job_progress
data: {"job_id":"job_zzz","status":"processing","progress":0.3}

event: job_done
data: {"job_id":"job_zzz","status":"failed","error":{"code":"provider_timeout","message":"生成超时,请重试"}}

event: canvas_update
data: {"node":{"node_id":"n_zzz","type":"image","status":"failed","asset_refs":[],"stage_id":"s_xxx"}}

event: message
data: {"type":"error","content":{"text":"这张生成失败了,可以重试或换个方向。"}}

event: turn_done
data: {"requires_user_action":true,"allowed_actions":["retry","revise"],"current_stage_id":"stg_xxx","active_job_ids":[]}
```

> 失败流必有 `job_done(status:"failed")` → `canvas_update(status:"failed")` → `message(type:"error")` → `turn_done`,`allowed_actions` 收口到 `retry` / `revise`(无 `confirm`)。

> 上面的序列是**轻量编排**形态(一个 turn 内:追问 → 优化提示词 → 生成 → 出结果)。**Full Canvas** 形态不同:跨多个 turn,每个「硬停 stage」(Brief / 分镜 / 视觉 / 视频)切一次 turn,用户确认后才开下一个 turn;「软过 stage」(Skill / 阶段计划 / 审核)在同一 turn 内自动推进。两种形态都**必有 `optimized_prompt_preview`**(Agent 永远优化提示词,区别于 Dock 裸直生)。

**Full Canvas 跨 turn 序列骨架**(硬停 stage = turn 边界,确认才推进;软过 stage 在 turn 内自动推进。stage 细节见 `skill/workflows/video_agent_canvas.md`):

```
Turn 1 — Brief(硬停·低成本):
  visible_reasoning → message[skill_recommendation,软过] → message[stage_plan,软过] → message(brief) → turn_done{requires_user_action:true}
Turn 2 — 脚本分镜(硬停·低成本):
  visible_reasoning → message(storyboard) → turn_done{requires_user_action:true}
Turn 3 — 首批视觉(硬停·低成本):
  visible_reasoning → message(optimized_prompt_preview) → canvas_update(image,generating)
  → job_started→job_progress→job_done → canvas_update(image,ready) → message(image_card)
  → turn_done{requires_user_action:true}
Turn 4 — 视频生成(硬停·**高成本**):
  visible_reasoning → message(optimized_prompt_preview) → canvas_update(video,generating)
  → job_started→job_progress→job_done → canvas_update(video,ready) → message(video_card)
  → turn_done{requires_user_action:true}
Turn 5 — 审核(软过,turn 内自动收尾):
  message(review) → turn_done(交付摘要)
```

> - **低成本硬停**(Brief / 分镜 / 视觉):弱继续("继续 / 下一步")直接推进。
> - **高成本硬停**(视频):弱继续**不推进**,回二次确认话术(决策 10,见 `confirmation_gate.md`)。
> - 每个 turn 必有 `visible_reasoning`;生成 turn(Turn 3 / 4)必有 `optimized_prompt_preview` + `job_*` + `canvas_update` + 结果卡。
> - `allowed_actions` 取值由 §4 确认门四分类 + stage 类型决定,本文不逐 stage 写死。
> - 失败处理同上「失败流序列」(任一生成 turn 的 Job 失败 → failed 节点 + error 消息)。

### 事件清单

| 事件 | payload | 说明 |
|---|---|---|
| `visible_reasoning` | `{title, items[]}` | 产品化思考过程,可折叠展示。**独立 event,不作 `message.type`**(见下 variant 表注)。 |
| `message` | `{type, content}` | 一条对话消息。`type` 取 backend contract 的 ChatMessage variant 全集(见下表)。 |
| `canvas_update` | `{node}` | 新增/更新画布素材节点。node payload 见 §5.3。 |
| `job_started` | `{job_id, type}` | Agent 内部启动了一个 GenerationJob。 |
| `job_progress` | `{job_id, status, progress}` | Job 进度,Agent turn 连接内嵌推送。 |
| `job_done` | `{job_id, status, asset_id?}` | Job 完成(成功给 `asset_id`,失败给 `status:"failed"`)。 |
| `turn_done` | `{requires_user_action, allowed_actions[], current_stage_id, active_job_ids[]}` | turn 关闭。`requires_user_action` / `allowed_actions` 由确认门四分类决定(见 §4);`active_job_ids` 用于接管仍在运行的生成任务。 |

### `message` 的 ChatMessage variant 全集

`type` 字段取 `backend_implementation_contract.md` 「对话消息类型」全集。

> **`visible_reasoning` 不在此表**:它在 SSE 走**独立 event**(见上「事件清单」第一行),数据对应 backend contract 的 `agent_turn.visible_reasoning`(turn 级思考过程对象 `{title, items[]}`),**不作为 `message.type` 传输**。contract「对话消息类型」列表里虽含 `visible_reasoning`,本文 SSE 传输层把它独立成 event——数据同源,传输包装不同。
>
> (contract 口径已统一:见 commit 29f8491 / PR !88——`visible_reasoning` 定为 Agent Turn 级字段,非 ChatMessage variant;`canvas_state_rules.md` 同步对齐,原 contract variant 列表里的条目已删。)

| variant | 是否展示 | 备注 |
|---|---|---|
| `brief` | 是 | 需求摘要。 |
| `skill_recommendation` | 是 | Skill 推荐。 |
| `asset_understanding` | 是 | 图片理解摘要。 |
| `stage_plan` | 是 | 阶段计划。 |
| `script` / `storyboard` | 是 | 脚本 / 分镜(P0 文字气泡,P1 可美化成分镜表)。 |
| `prompt_draft` | **否** | 提示词草稿,默认不展示。 |
| `optimized_prompt` | **否** | 发给 Provider 的原始版,含系统指令/格式 token,**永不进 `message`**。 |
| `optimized_prompt_preview` | **是** | 用户友好版,中文可读,"我帮你优化成了这样",可在对话展示。**Agent 链路必有**(轻量编排 + Full Canvas 都走;Dock 直生不产生此消息)。 |
| `review` | 是 | 审核结论。 |
| `plain_text` | 是 | 普通文字回复。 |
| `image_card` / `video_card` | 是 | 结果卡,引用画布上的 asset node。 |
| `error` | 是 | 错误说明,可展示给用户。 |

> **关键区分**:`optimized_prompt`(原始)**永不进 `message`**;`optimized_prompt_preview`(友好版)可展示。两者不可混用。

---

## 4. 后端硬约束

来自 `backend_implementation_contract.md` 「后端必须实现的硬约束」,Agent 对话链路务必实现:

1. 没有 `ready` 节点不允许确认;用户只说"继续"不推进(见 `confirmation_gate.md` 四分类 → `turn_done.requires_user_action` / `allowed_actions`)。
2. 用户消息意图按四分类处理:明确确认 / 弱继续 / 修改意图 / 等待中。
3. 图生图或图生视频前必须存在 `asset_understanding`;主 LLM 不多模态时必须调视觉模型或请用户补充,**不假装识别**。
4. Provider 调用前必须存在 `optimized_prompt`。
5. 生成失败必须写入 `failed` 节点 + `error` 消息,**不静默失败**。
6. `trace_event` / `prompt_draft` / `optimized_prompt` / worker 名 / 文件路径 **不进** `message` / `visible_reasoning`。
7. **`advance_stage` 铁闸**:推进 stage 必须独立校验 `has_ready_node`,与主 Agent 判定解耦——主 Agent 误判要推进也拦(呼应 `backend_implementation_contract.md` 硬约束 13、`decision_layer.md`、`confirmation_gate.md`)。`confirm_pending` branch 由 `decision_context` 算出,主 Agent 只在命中时判四分类。
8. **候选图消歧铁闸**(呼应 `backend_implementation_contract.md` 硬约束 14):`@` 引用解析阶段,任务需要图 + `candidate_asset_ids` ≥ 2 + 无 `reference_asset_ids` / `active_asset_id` 时,必须消歧反问(画布高亮 + 文字引导),**禁止**主 Agent 靠「最近 ready / 第一张 / 刚生成」猜自然语言指代。`active_asset_id`(用户画布选中)视为明确指向,选中即识别不追问。详见 `image_understanding.md` 候选图消歧。

> 规则全文见 `skill/rules/confirmation_gate.md`(四分类)与 `skill/rules/generation_route_decision.md`(两条入口路由判定)。本文不复制规则全文,只声明 Agent 对话链路必须遵守。

---

## 5. 接入点(Agent 模块的对外边界)

### 5.1 ↔ Skill 面板(闭合 `FRONTEND-SKILL-PANEL-PRD.md` §5 断头路)

Skill 面板只负责把"用户选了哪个 skill / 哪些 skill 开了 auto"传出去,Agent 侧承接:

| 来源 | 携带方式 | 优先级 | 生效范围 |
|---|---|---|---|
| 用户点 `Use` | 请求体 `forced_skill_id`(见 §2) | **高** | 仅当前这一条 turn |
| `auto=on` 的 skill 集合 | 后端自读 `/api/skills/mine?auto=true`(不在请求里传) | 中 | 后续所有 turn 的候选池 |
| 未指定 | 不传 `forced_skill_id`,候选池为空或不命中 | 低 | Agent 按既定规则决定 |

- **冲突仲裁**:`forced_skill_id`(Use)> auto 候选池 > 未指定。Use 与 auto 冲突时以 Use 为准。
- **`forced_skill_id` 仅决定 skill 选择那一步,不锁后续 Stage**(skill 选完后的 brief→分镜→视觉→视频 编排照常走)。
- **Use 不持久化为 `auto`**(一次性指令)。

> 呼应 `FRONTEND-SKILL-PANEL-PRD.md` §5(接入点)。两边联调验收见该 PRD §8 第 7 条。

### 5.2 ↔ BottomDock(共用 GenerationJob)

BottomDock 直生(`/api/projects/{project_id}/generate`)与 Agent 对话(`/agent/turn`)是**两条独立生成路径,不合并为同一 API**(见 `BACKEND-API-PRD.md` §6 概览表)。

二者底层共用 GenerationJob + Asset,保证计费/状态/资产管理统一。职责分工:

| 维度 | BottomDock(`/generate`) | Agent(`/agent/turn`) |
|---|---|---|
| 入参 | 完整参数(模型/比例/分辨率/时长/参考) | 自然语言意图 |
| 编排 | 无,直接 GenerationJob | CEO 路由 + worker 编排 |
| 产物 | Asset → 画布节点 | 对话消息 + Asset → 画布节点 |
| Job 进度 | 走独立 `/api/jobs/{id}/stream` | 走 turn 的 SSE 内嵌 `job_*` 事件 |

**三套 Job 进度机制各管什么**:

1. **turn 的 SSE 内嵌 `job_started` / `job_progress` / `job_done`**:Agent turn **进行中**时,Job 进度随对话连接推送。
2. **独立 `/api/jobs/{id}/stream`**:BottomDock 直生,或 Agent turn 已关闭但 Job 仍在运行时,由它接管后续进度。
3. **`active_jobs` 兜底重连**:`GET /api/projects/{id}` 返回的 `active_jobs` 暴露进行中任务,前端刷新回来后据此重建 `/api/jobs/{id}/stream`;重建失败时轮询 `GET /api/jobs/{id}`。

**接力规则**:

- 如果 Agent turn 结束时 Job 已完成,最后一个 `canvas_update` 必须把节点更新为 `ready` 或 `failed`。
- 如果 Agent turn 结束时 Job 未完成,`turn_done` 必须返回可追踪的 `active_job_ids`,并保证 `GET /api/projects/{id}` 能返回同一批 active jobs。
- 前端收到未完成 Job 后,立即改用 `/api/jobs/{id}/stream` 追进度;刷新后从 `active_jobs` 恢复。
- 同一个 Job 的最终状态只能写一次;重复 SSE / 轮询结果必须幂等更新同一个 canvas node。
- **`active_job_ids` / `active_jobs` 一致性**:`turn_done.active_job_ids`(turn 关闭即时快照)与 `GET /api/projects/{id}` 返回的 `active_jobs` 必须指向同一批 Job,`job_id` 集合一致;前端 turn 内信 `turn_done`,刷新后信 `active_jobs`。
- **`job_done` 幂等去重**:同一 `job_id` 的 `job_done` 前端按 `job_id` 幂等去重;Agent turn SSE 推过 `job_done` 后,独立 `/api/jobs/{id}/stream` 重连若 Job 已 done,只推最终态一次,不重复推 `job_progress`。

### 5.3 ↔ Canvas(`canvas_update` 的 node payload)

`canvas_update` 事件推送画布素材节点。node payload 字段取 `backend_implementation_contract.md` 「Canvas Node」定义(`node_id` / `canvas_id` / `stage_id` / `type` / `status` / `title` / `content` / `asset_refs` / `source` / `visible_reasoning` / `created_at` / `updated_at`)。

**node.type(画布仅素材)**:`image` / `video`。过程性内容(brief/skill/分镜/review)**不进画布**,只走对话 `message`。

**Job 状态 → node.status 映射**:

| Job 状态 | node.status |
|---|---|
| `queued` / `processing` | `generating` |
| `succeeded` | `ready` |
| `failed` | `failed` |

> 确认门只允许对 `ready` 或 `awaiting_confirm` 的节点生效(见 `backend_implementation_contract.md` node.status)。

---

## 6. P0 / P1 边界

| 层 | P0 | P1 |
|---|---|---|
| 后端 runtime | **两入口 + Agent 分支**:Dock 直生;Agent `decision_branch` 覆盖 lightweight / full_canvas / prompt_only / revise / product_switch / confirm / consult 等 | — |
| 前端过程消息 | **全展示**(文字气泡):brief / skill / storyboard / review / optimized_prompt_preview / visible_reasoning | 可选:过程消息结构化美化(如 storyboard 分镜表、brief 卡片化) |
| 前端结果 | 结果卡(`image_card` / `video_card`) + 画布素材节点 | — |
| 对话历史 / 状态持久化 | **`messages` 持久化到 Project**(画布 + 对话 + 进行中任务一起存,`GET /api/projects/{id}` 可恢复,见 BACKEND-API-PRD §5.5)+ 当前 / 上一个产品方向的结构化摘要(见 ROADMAP 模块 10 P0 边界)。**完整历史系统**(messages / agent_events 分离、摘要、版本、索引、恢复)**不做** | 完整历史系统:`messages` 与 `agent_events` 分离 + 历史摘要(`conversation_summary`)+ 内容版本(`content_versions`)+ 版本索引 + 历史资产引用 + 版本恢复(见 ROADMAP 模块 10) |

> 前端**没有分阶段**:所有过程消息 P0 就展示,P1 仅是可选美化,非阻塞。
> 对话历史与状态持久化是另一条 P1 线,见 `FRONTEND-INTEGRATION-ROADMAP.md` 模块 10,本文不展开。

---

## 7. 验收标准(P0)

(由 `BACKEND-API-PRD.md` §10 演化而来;该 §10 现已收敛为核心基建 4 条,Agent 对话验收迁至本文):

1. **自然语言流式**:用户在 AgentChatPanel 发自然语言,流式看到 `visible_reasoning` + 过程消息(brief/skill/storyboard/review/optimized_prompt_preview)+ 结果卡(`image_card`/`video_card`);画布出现对应素材节点。
2. **Image-to-Video 前置理解**:Agent 对话里的图转视频必须有 `asset_understanding`;Dock 直生则把图随 `reference_asset_ids` 直传 Provider,不做 understanding。
3. **刷新不丢**:生成中刷新页面或切走再回来,**画布 + 已持久化对话 messages + 进行中任务**都恢复(`GET /api/projects/{id}` 返回整 Project 快照:canvas nodes + messages + active_jobs,messages 持久化见 BACKEND-API-PRD §5.5);Job 走 `active_jobs` 兜底重连或独立 `/api/jobs/{id}/stream`,完成时翻 `ready`。**完整历史系统(摘要 / 内容版本 / messages 与 agent_events 分离 / 版本索引 / 版本恢复)不在 P0,见 ROADMAP 模块 10。**
4. **"继续"不推进**:用户只说"继续"时不推进;`ready` 节点 + 明确确认才推进(确认门四分类)。
5. **不泄露内部信息**:`trace_event` / `optimized_prompt`(原始)/ `prompt_draft` / worker 名 / 文件路径不出现在任何用户可见响应;对话里给用户看的是 `optimized_prompt_preview`(友好版)。
6. **画布多图消歧**:任务需要图、画布有 ≥2 张候选、用户未 @ 未选中时,Agent 反问带候选(画布高亮 + 文字引导),不靠「最近 ready」猜;用户画布选中(`active_asset_id`)即识别,不追问;纯文字「第3张」不认。

---

## 8. 风险

- **Agent runtime 复杂度**:Full Video Canvas 编排是多 worker 协作,后端实现成本高。P0 接口和消息链路一次到位,联调时按入口验收:先 Dock 直生,再 Agent lightweight / prompt_only / full_canvas。
- **URL 签名过期**:Skill 封面用 CloudFront Signed URL,会集体 403;由 Skill 面板的 `signed-cover` 接口兜底,详见 `FRONTEND-SKILL-PANEL-PRD.md` §9。
- **匿名身份迁移**:P2 引入登录时,需把 `anonymous_id` 名下的 Project/Asset/对话合并到正式账户,后端需预留合并路径(详见 `BACKEND-API-PRD.md` §11)。
