# Agent 对话交付 PRD（P0）

> 给前后端工程师的 Agent 对话交付契约。从 `BACKEND-API-PRD.md` §5.6 抽出,闭合 Skill 面板 ↔ Agent 对话的接入点断头路。
> 版本:P0 · 日期:2026-07-05

## 0. 怎么读这份文档

实现前**必读** workspace 三份契约 + 两份规则:

- `skill/references/backend_implementation_contract.md` —— **权威定义层**。Agent Turn 字段、Canvas Node、ChatMessage variant(对话消息类型)、Stage、Workflow Run 都在这里定义,本文不重复字段定义,只引用。
- `skill/references/frontend_canvas_interaction_contract.md` —— 前端展示边界(画布 = 素材,对话 = 过程)与验收颗粒度。
- `skill/rules/confirmation_gate.md` —— 确认门四分类(明确确认 / 弱继续 / 修改意图 / 等待中)。
- `skill/rules/generation_route_decision.md` —— 四条生成链路的路由判定。

本文定义 backend contract **未覆盖**的部分:

- **SSE wire 格式**(事件序列 + 各事件 payload)——传输层契约,contract 当前不定义。
- **接入点契约**(Agent ↔ Skill 面板 / BottomDock / Canvas 的边界)。

> 编排规则本身(brief→skill→分镜→视觉→视频 的 worker 协作)不在本文,继续引用 `skill/rules/*` 与 `skill/workflows/*`。

---

## 1. 范围(P0)

### 后端 P0 —— 三条链路全做(避免返工)

Agent runtime(CEO 路由 + workers)在 P0 必须把以下三条链路做透:

1. **Direct**(直接生成图/视频)
2. **Image-to-Video**(上传图 → 生视频,前置 `asset_understanding`)
3. **Full Canvas**(brief → skill → 分镜 → 视觉 → 视频 的完整 worker 协作)

> Full Canvas 的**前端**过程消息展示(brief / skill / storyboard 等对话卡)见 §6 P0/P1 边界。

### 前端 —— 无分阶段,过程消息全展示

过程消息(`visible_reasoning` / `brief` / `skill_recommendation` / `storyboard` / `review` / `optimized_prompt_preview` 等)在 P0 就**全部作为对话文字气泡展示**。展示边界遵循 `frontend_canvas_interaction_contract.md`:**画布只放素材(图/视频),对话放一切过程**。

> 本文 P1 只覆盖**前端展示维度**:可选的过程消息结构化美化(如把 storyboard 渲染成分镜表),非阻塞,P0 用纯文字气泡即可。
> P1 另有一条独立工作线——**长对话 / 状态持久化 / 历史版本**(完整 `messages`+`agent_events` 历史、`conversation_summary`、`content_versions`、版本索引、历史资产引用、版本恢复),不在本文,见 `FRONTEND-INTEGRATION-ROADMAP.md` 模块 10(P1 评估)。

---

## 2. 输入

### `POST /api/projects/{project_id}/agent/turn`

用户在 AgentChatPanel 发一句话。后端 CEO 路由按 `generation_route_decision.md` 判定链路(direct / image-to-video / full canvas),逐段流式返回;必要时启动 GenerationJob。

```json
// req
{
  "text": "用户的自然语言",
  "forced_skill_id": "skl_xxx"    // optional
}
```

**字段语义**:

| 字段 | 必填 | 语义 |
|---|---|---|
| `text` | 是 | 用户的自然语言输入。 |
| `forced_skill_id` | 否 | 仅当用户在 Skill 面板点 `Use` 时携带。**仅决定 skill 选择那一步,不锁后续 Stage**;一次性指令,**不改变用户的 `auto` 状态**(不持久化)。权威定义见 `backend_implementation_contract.md` Agent Turn 字段。 |

**`forced_skill_id` 与 auto 候选池的关系**(详见 §5 接入点):

- 不传 `forced_skill_id` = 用户未手动指定,Agent 按既定规则(见 `skill/rules/skill_generation_priority.md`「Skill 来源与选择」)从 auto 候选池决定。
- **auto 候选池不在请求里传**。后端 Agent runtime 直接从 `/api/skills/mine?auto=true` 自读,保证与 Skill 面板状态同源。
- 冲突仲裁优先级:**`forced_skill_id`(Use)> auto 候选池 > 未指定**。

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

### 事件清单

| 事件 | payload | 说明 |
|---|---|---|
| `visible_reasoning` | `{title, items[]}` | 产品化思考过程,可折叠展示。 |
| `message` | `{type, content}` | 一条对话消息。`type` 取 backend contract 的 ChatMessage variant 全集(见下表)。 |
| `canvas_update` | `{node}` | 新增/更新画布素材节点。node payload 见 §5.3。 |
| `job_started` | `{job_id, type}` | Agent 内部启动了一个 GenerationJob。 |
| `job_progress` | `{job_id, status, progress}` | Job 进度,Agent turn 连接内嵌推送。 |
| `job_done` | `{job_id, status, asset_id?}` | Job 完成(成功给 `asset_id`,失败给 `status:"failed"`)。 |
| `turn_done` | `{requires_user_action, allowed_actions[], current_stage_id, active_job_ids[]}` | turn 关闭。`requires_user_action` / `allowed_actions` 由确认门四分类决定(见 §4);`active_job_ids` 用于接管仍在运行的生成任务。 |

### `message` 的 ChatMessage variant 全集

`type` 字段取 `backend_implementation_contract.md` 「对话消息类型」全集:

| variant | 是否展示 | 备注 |
|---|---|---|
| `visible_reasoning` | 是 | 思考过程,可折叠。 |
| `brief` | 是 | 需求摘要。 |
| `skill_recommendation` | 是 | Skill 推荐。 |
| `asset_understanding` | 是 | 图片理解摘要。 |
| `stage_plan` | 是 | 阶段计划。 |
| `script` / `storyboard` | 是 | 脚本 / 分镜(P0 文字气泡,P1 可美化成分镜表)。 |
| `prompt_draft` | **否** | 提示词草稿,默认不展示。 |
| `optimized_prompt` | **否** | 发给 Provider 的原始版,含系统指令/格式 token,**永不进 `message`**。 |
| `optimized_prompt_preview` | **是** | 用户友好版,中文可读,"我帮你优化成了这样",可在对话展示。直生链路用它给用户看优化后的提示词。 |
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

> 规则全文见 `skill/rules/confirmation_gate.md`(四分类)与 `skill/rules/generation_route_decision.md`(四链路路由判定)。本文不复制规则全文,只声明 Agent 对话链路必须遵守。

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
| 后端 runtime | **三链路全做**(Direct / Image-to-Video / Full Canvas) | — |
| 前端过程消息 | **全展示**(文字气泡):brief / skill / storyboard / review / optimized_prompt_preview / visible_reasoning | 可选:过程消息结构化美化(如 storyboard 分镜表、brief 卡片化) |
| 前端结果 | 结果卡(`image_card` / `video_card`) + 画布素材节点 | — |
| 对话历史 / 状态持久化 | 最小持久化:当前 + 上一个产品方向的结构化摘要(见 ROADMAP 模块 10 P0 边界);完整 `messages` / `agent_events` 历史**不做** | 状态持久化(`project_state`)+ 内容版本(`content_versions`)+ 完整历史 + 历史摘要(`conversation_summary`)+ 版本索引 + 历史资产引用 + 版本恢复(见 ROADMAP 模块 10) |

> 前端**没有分阶段**:所有过程消息 P0 就展示,P1 仅是可选美化,非阻塞。
> 对话历史与状态持久化是另一条 P1 线,见 `FRONTEND-INTEGRATION-ROADMAP.md` 模块 10,本文不展开。

---

## 7. 验收标准(P0)

(由 `BACKEND-API-PRD.md` §10 演化而来;该 §10 现已收敛为核心基建 4 条,Agent 对话验收迁至本文):

1. **自然语言流式**:用户在 AgentChatPanel 发自然语言,流式看到 `visible_reasoning` + 过程消息(brief/skill/storyboard/review/optimized_prompt_preview)+ 结果卡(`image_card`/`video_card`);画布出现对应素材节点。
2. **Image-to-Video 前置理解**:上传图 → Agent/直生生视频,前置 `asset_understanding` 存在(主 LLM 不多模态时调视觉模型或请用户补充,不假装识别)。
3. **刷新不丢**:生成中刷新页面或切走再回来,**画布 + 对话消息 + 进行中任务**都恢复(`GET /api/projects/{id}` 返回整 Project 快照:canvas nodes + messages + active_jobs);Job 走 `active_jobs` 兜底重连或独立 `/api/jobs/{id}/stream`,完成时翻 `ready`。**完整历史系统(摘要 / 内容版本 / messages 与 agent_events 分离 / 版本索引)不在 P0,见 ROADMAP 模块 10。**
4. **"继续"不推进**:用户只说"继续"时不推进;`ready` 节点 + 明确确认才推进(确认门四分类)。
5. **不泄露内部信息**:`trace_event` / `optimized_prompt`(原始)/ `prompt_draft` / worker 名 / 文件路径不出现在任何用户可见响应;对话里给用户看的是 `optimized_prompt_preview`(友好版)。

---

## 8. 风险

- **Agent runtime 复杂度**:Full Video Canvas 编排是多 worker 协作,后端实现成本高。P0 接口和消息链路一次到位,联调时可按 Direct / Image-to-Video / Full Canvas 的顺序逐条验收。
- **URL 签名过期**:Skill 封面用 CloudFront Signed URL,会集体 403;由 Skill 面板的 `signed-cover` 接口兜底,详见 `FRONTEND-SKILL-PANEL-PRD.md` §9。
- **匿名身份迁移**:P2 引入登录时,需把 `anonymous_id` 名下的 Project/Asset/对话合并到正式账户,后端需预留合并路径(详见 `BACKEND-API-PRD.md` §11)。
