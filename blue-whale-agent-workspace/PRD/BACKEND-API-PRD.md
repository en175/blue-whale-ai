# Blue-Whale 后端接口 PRD（P0）

> **⚠️ 部分替代（2026-07-24，IK2D8R）**：本文 §5.6 的 Agent turn 接口（`POST .../agent/turn`）与 L1 分流相关内容是历史记录，不再是实现权威——该公开协议废弃且不实现兼容端点，唯一公开对话协议为 Conversation message 命令 + Project Snapshot/SSE（ADR-0016/0039，[Runtime Agent Bundle 契约](../../docs/specs/2026-07-20-runtime-agent-bundle-contract.md) §9）。其余章节（用户/资产/目录/直生链路/传输约定）的有效性以各自后续工单与 ADR 为准。

> 🔗 **关联**：需求 #IJZ7Z9 · wayfinder map #IK29RN（前端接后端三链路总图）
> **同批 PRD**：[AGENT-CONVERSATION-PRD.md](./AGENT-CONVERSATION-PRD.md)（§5.6 抽出）· [FRONTEND-SKILL-PANEL-PRD.md](./FRONTEND-SKILL-PANEL-PRD.md) · [路线图](./FRONTEND-INTEGRATION-ROADMAP.md)

> 给后端工程师的**核心接口 + 数据模型 + 直生链路 + 通用传输约定**交付文档。配合本仓库的编排规则与数据契约一起实现。
> 版本:P0 · 日期:2026-07-04

## 0. 怎么读这份文档

本文是**核心基础设施文档**:用户/资产/项目/生成任务/目录 的接口与表,以及前后端对接的通用传输约定。

两个**独立模块**已拆出独立 PRD,本文不重复:

- **Agent 对话**(SSE 流式、Agent runtime、过程消息)→ `AGENT-CONVERSATION-PRD.md`
- **Skill 面板**(我的 Skills / Skill 库 / 签名封面)→ `FRONTEND-SKILL-PANEL-PRD.md`

实现前**必读**:

- `skill/references/backend_implementation_contract.md` —— Agent 编排的数据契约(Agent Turn / Canvas Node / Workflow Run / Stage / 对话消息类型,本文不再重复字段定义)
- `skill/references/frontend_canvas_interaction_contract.md` —— 前端展示边界与验收标准
- `skill/rules/confirmation_gate.md` —— 确认门四分类
- `skill/rules/generation_route_decision.md` —— 两条入口（Dock 直生 / Agent 对话）的路由判定

---

## 1. 背景与现状

> **⚠️ 2026-07-21 全仓扫描更新**:本节原版本(2026-07-04)写「前端纯 SPA,网络调用 0 处」——**已过时**。经扫描 `blue_whale_web`(前端 Next.js)+ `blue_whale_server`(后端 Java Spring Cloud:gateway / agent / user),前端已大量接真实后端。下方为现实。

### 已接真实后端

网关 `GATEWAY_URL` 默认 `http://115.190.244.91:8686`,Next rewrite `/api/*` + `/assets/*` 同源代理,`lib/api-client.ts` 统一 Bearer token + 401 刷新。

| 域 | 端点 | 状态 |
|---|---|---|
| 鉴权 | `/api/auth/*`(captcha/send-code/login/refresh/logout)+ `/api/me` + `/api/user/*` | **完整接,手机号验证码 + JWT 双 token**(非原匿名 X-User-Id) |
| Project/Canvas | `/api/projects` + `/api/canvases`(两表方案) | **完整接**(`lib/canvas.ts` + `useCanvasProjects`,800ms debounce PUT + beforeunload flush) |
| Job 流 | `/api/jobs` + `/{id}` + `/{id}/stream`(SSE) | **完整接**,image SSE + video 轮询;`jobs.source`(dock/agent)+ `stage_id` 已有 |
| 生成 | `/api/generation/image\|video` + `/api/generation/models?capability=` | **完整接** |
| Skill/模板 | `/api/agent/skills/*` + `/api/agent/templates/*` | **完整接** |
| 资产 | `/api/assets?type=`(只读列表) | 接了;`presign`/`complete` 骨架零调用 |

### 仍 mock / 零落地

1. **Agent 对话整条**(`AgentChatPanel.handleSend` → `buildMockReplyForMode`,无网络) — 见 [AGENT-CONVERSATION-PRD.md](./AGENT-CONVERSATION-PRD.md),后端 agent turn 零实现
2. **三处模型硬编码**(`AgentComposer` / `AgentChatPanel` / `constants.ts`) — catalog 端点已存在(`/api/generation/models`),前端未接
3. **画布上传 base64**(`canvas/page.tsx:247` FileReader) — `presign`/`complete` 骨架零调用
4. PROJECTS mock 降级 fallback(`backendReady=false` 时)

### 后端实现状态(扫描 `blue_whale_server`)

- **已实现**:四表(users/project/canvas/assets/generation_jobs)、catalog(`generation_model_capability` 表,数据等价 §5.3 全集)、Project/Canvas CRUD、Job 流、Skill/模板、鉴权(登录 JWT)
- **缺(从零建)**:资产上传(presign/complete/GET/{id})、canvas.messages(零)、assets.understanding 字段(零)、agent turn 整条(零)、video SSE(只有 image SSE)

> 详见 wayfinder map #IK29RN + 共享地基 #IK2H6I(G0)。原始「三条后端线索」(Skill 封面 / next.config 白名单):封面已决不用 CloudFront 签名(§9.2),走 cover_url 公开 URL。

## 2. 范围

### P0(本文覆盖,业务主链路)

- ~~匿名用户标识(无登录、无鉴权)~~ → **手机号登录 JWT**(见 §4,2026-07-21 校准)
- 资产上传(预签名直传)
- 模型/参数目录(聚合接口)
- 生成任务:Direct(含 Direct Image / Direct Video)/ Image-to-Video / Full Video Canvas 三条链路全做(对齐 ROADMAP「已锁定产品决策」)
- Agent 对话过程消息 P0 全部展示为文字气泡；P1 只做结构化美化
- Agent 对话(SSE 流式,返回对话消息 + 画布素材更新)→ **见独立 `AGENT-CONVERSATION-PRD.md`**
- Skill 面板 P0 实现我的 Skills / Skill 库 / auto / Use / 封面(cover_url,无签名)
- Project 持久化(画布 + 对话 + 进行中任务,刷新不丢)

### P1(本文列出占位,后续细化)

- 节点衍生操作(refresh / shuffle / paint 局部重绘 / light 重打光 / upscale 超分)
- Skill 创建 / 上传 / AI 格式化
- 模板墙、运营位
- Full Video Canvas 过程消息结构化美化(brief 卡片、分镜表等)

### P2(中台,后置)

- 账户 / 登录 / 鉴权 / Token
- 积分扣减、订阅套餐
- 运营横幅
- CloudFront Signed URL 体系的对外标准化

## 3. 领域模型

权威定义见仓库根 `CONTEXT.md` 与 `skill/references/backend_implementation_contract.md`。要点:

- **User / 访客**:**手机号登录 JWT**(非匿名,见 §4;2026-07-21 校准);资源归属隔离。一个 User 拥有多个 Project。
- **Project**:顶层聚合根,1:1 包含 Canvas + 对话流。
- **Asset**:图片/视频文件实体,有 id 与可访问 URL。**Card 与 NodeItem 是同一 Asset 的两种视图**。
- **GenerationJob**:异步后台任务,持久化。`queued → processing → succeeded | failed`。产出 Asset。
- **展示边界**:**画布 = 素材(图/视频),对话 = 过程**(brief/skill/分镜/review/思考 都在对话流)。
- **确认**:对话式自然语言,无按钮。后端按 `confirmation_gate` 四分类处理。

数据模型见 §7。

## 4. 通用传输约定

> **⚠️ 2026-07-21 更新**:鉴权从原「匿名 X-User-Id」改为「手机号登录 JWT」(后端已实现,前端已接);错误格式从原 `{error:{...}}` 改为 `Result{code,msg,data}`(Jackson,前端已按此解)。

- 所有接口前缀 `/api`。
- **鉴权:手机号验证码登录 + JWT 双 token**(user-service 已实现)。网关 `JwtAuthGlobalFilter` 强制:除 `/api/auth/**` 白名单外所有 `/api/**` 必须带 `Authorization: Bearer <access_token>`,无 token 直接 401。
  - access_token 15min、refresh_token 30d(存 Redis `bw:refresh:{jti}`);refresh 一次一换、删旧。
  - **无匿名 X-User-Id 直传**(原 P0 匿名方案后端不存在);`X-User-Id` 由网关从 JWT 注入,前端不直传。
  - 前端 token 存储 `localStorage` 键 `bw-access-token` / `bw-refresh-token` / `bw-user`(`components/auth/authStorage.ts`);`NEXT_PUBLIC_SKIP_AUTH=1` 本地跳过前端登录门槛(后端 JWT 仍校验)。
  - 资源归属隔离:Project / Asset / GenerationJob / Skill 都绑 `user_id`,接口校验归属,禁止跨用户访问(P2 登录迁移见 §11)。
- 编码:JSON,snake_case。
- 时间:ISO 8601 字符串。
- **错误:统一 `Result{code,msg,data}`**(Jackson 序列化,前端 `lib/api.ts` 按 `{code,msg,data}` 拆解);HTTP 状态码标准语义。错误码至少区分 `quota_exhausted`(P2)/ `content_moderation_rejected` / `upstream_timeout` / `asset_unavailable` / `asset_understanding_missing`。
- 长任务统一走异步 + SSE(见 §8)。

## 5. 接口清单(P0)

### 5.1 用户

#### `GET /api/me`
返回当前匿名用户与占位余额。
```json
{
  "user_id": "uuid",
  "anonymous": true,
  "credits": null,
  "subscription": null
}
```
> `credits` / `subscription` 在 P0 为 `null`(占位),P2 才有真值。前端目前硬编码的积分纯展示。

---

### 5.2 资产上传(预签名直传)

#### `POST /api/assets/presign`
预创建 Asset 并签发直传 URL。
```json
// req
{ "type": "image" | "video", "mime": "image/png", "size": 1234567 }

// res
{
  "asset_id": "ast_xxx",
  "upload_url": "https://<cdn>/<key>?<sig>",
  "headers": { "Content-Type": "image/png" },
  "expires_in": 900
}
```
前端随后 `PUT upload_url` 带文件二进制。

#### `POST /api/assets/{asset_id}/complete`
上传完成后回调,后端校验对象存在、登记元数据。
```json
// res
{
  "asset_id": "ast_xxx",
  "status": "ready",
  "type": "image",
  "url": "https://<cdn>/<key>",     // 可直接展示的(签名)URL
  "width": 1024, "height": 1024,
  "duration": null,
  "mime": "image/png", "size": 1234567
}
```
> Asset 既是用户上传素材(生成输入),也是生成结果(输出),同一实体,`source` 区分。

#### `GET /api/assets/{asset_id}`
取单个 Asset(用于 URL 过期后重新拿签名 URL)。

> `DELETE /api/assets/{id}` 进 P1。

---

### 5.3 模型 / 参数目录

> **⚠️ 2026-07-21 更新**:端点名从 `/api/catalog` 改为 **`/api/generation/models`**(后端已实现,数据等价全集)。前端三处硬编码**仍未接**,是 G0(#IK2H6I)前端工作量。

#### `GET /api/generation/models?capability=image|video`
聚合返回模型能力,**作为前端唯一来源**(消除前端 `AgentComposer` / `AgentChatPanel` / `constants.ts` 三处硬编码)。后端表 `generation_model_capability`(provider_id / model_id / capability_type / model_label / icon / supported_sizes / supported_aspect_ratios / supported_formats / default_* / features{referenceImage/watermark/quantityMax/sequentialImageGeneration/stream/tools} / enabled)。`capability` 默认 image,可传 video。
```json
{
  "creation_modes": [ { "id": "agent", "label": "视频智能体" }, { "id": "direct", "label": "直接生成" } ],
  "video_models": [ { "id": "seedance-2", "label": "Seedance 2.0", "cost_multiplier": 1.0 }, ... ],
  "image_models": [ { "id": "gpt-image-2", "label": "...", "premium": false }, ... ],
  "agent_llm_models": [ { "id": "claude-opus-4-7", "cost_multiplier": 1.5 }, ... ],
  "video_aspect_ratios": [ "16:9", "9:16", ... ],
  "image_aspect_ratios": [ ... ],
  "resolutions": [ "480p", "720p", "1080p", "2160p" ],
  "image_resolutions": [ "1K", "2K", "4K" ],
  "durations": { "min": 4, "max": 15 },
  "ref_modes": [ "omni", "first-last", "text-to-video" ]
}
```

---

### 5.4 生成任务

两条入口,共用同一套 GenerationJob:

- **BottomDock 直生**:用户手填参数 + prompt,**零优化、零图理解**——原话 + 参数 + reference_asset_ids 直传 Provider,Provider 自己消费图,结果落画布(不进对话流)。质量用户自负责。
- **Agent 对话**:L1 轻量 classifier(haiku 级,独立模型)分流(轻量编排 / Full Canvas),永远走 Prompt Optimizer(出 `optimized_prompt_preview` 让用户确认),图推理前做 `asset_understanding`。判定分层见 `skill/rules/decision_layer.md`,交付见 `AGENT-CONVERSATION-PRD.md`。

#### `POST /api/projects/{project_id}/generate`(BottomDock 直生入口)
```json
// req
{
  "type": "image" | "video",
  "prompt": "...",
  "model": "seedance-2",
  "params": {
    "aspect_ratio": "16:9",
    "resolution": "1080p",
    "duration": 8,
    "ref_mode": "omni",
    "quantity": 1,
    "internet_search": false
  },
  "reference_asset_ids": ["ast_xxx"],
  "source": "dock"
}
// res
{ "job_id": "job_xxx", "status": "queued" }
```

#### `GET /api/jobs/{job_id}`
查任务状态(轮询兜底,主推 SSE)。
```json
{
  "job_id": "job_xxx",
  "project_id": "prj_xxx",
  "type": "video",
  "status": "queued" | "processing" | "succeeded" | "failed",
  "progress": 0.35,
  "output_asset_ids": ["ast_yyy"],
  "error": null,
  "created_at": "...", "updated_at": "..."
}
```

#### `GET /api/jobs/{job_id}/stream`(SSE)
推送任务进度事件,直到 `succeeded` / `failed`:
```
event: progress
data: {"job_id":"job_xxx","status":"processing","progress":0.35}

event: done
data: {"job_id":"job_xxx","status":"succeeded","output_asset_ids":["ast_yyy"]}
```

> Job 状态 → 画布节点 status 映射:`queued`/`processing` → `generating`;`succeeded` → `ready`;`failed` → `failed`。对应 Card 展示状态见 `CONTEXT.md`。

---

### 5.5 Project(画布 + 对话 持久化)

> **⚠️ 2026-07-21 现实校准**:下方单表方案(`projects.canvas_state` + `messages` jsonb)**后端未实现**。现实是**两表**:
> - `project`(owner_id / name / thumb)
> - `canvas`(project_id UNIQUE / viewport_json / nodes_json)—— canvas 只存 viewport+nodes,**无 messages 列**
> - `messages` 持久化用**新建 `message` 表**(一条一行,关联 project_id;见 AGENT-CONVERSATION-PRD / wayfinder #IK2H7R B 票建),**不进 canvas**
> - 现行前端已接两表(`lib/canvas.ts`:GET/POST/PUT/DELETE `/api/projects` + `/api/canvases`,800ms debounce PUT + beforeunload flush)
> - `GET /api/projects/{id}` 恢复 = canvas nodes(从 canvas 表)+ messages(从 message 表)+ active_jobs(从 generation_jobs)
>
> 下方接口签名保留作「理想契约」,实现按上方两表 + message 表。

#### `GET /api/projects`
替换前端 TopBar 的 `PROJECTS` 硬编码。
```json
{ "items": [ { "id": "prj_xxx", "title": "...", "cover_asset_id": "ast_xxx", "updated_at": "..." } ] }
```

#### `POST /api/projects`
首页点"开始生成"时创建(替代当前裸 `router.push('/canvas?prompt=...')`)。
```json
// req
{ "title": "未命名项目", "initial_prompt": "(可选)" }
// res
{ "id": "prj_xxx", "title": "...", "canvas_state": { "nodes": [], "viewport": {} }, "messages": [], "created_at": "..." }
```

#### `GET /api/projects/{id}`
恢复整个工作区。**必须包含进行中的 GenerationJob**(满足"刷新/切走不丢"):
```json
{
  "id": "prj_xxx",
  "title": "...",
  "canvas_state": { "nodes": [ ... ], "viewport": { "zoom": 1, "x": 0, "y": 0 } },
  "messages": [ ... ],            // 对话流(见 backend contract 的 ChatMessage)
  "active_jobs": [ { "job_id": "job_xxx", "status": "processing", ... } ],
  "updated_at": "..."
}
```

#### `PATCH /api/projects/{id}`
**整 Project 快照保存**(画布 nodes + 视口 + 对话 messages 一起存)。前端在节点变动、对话推进后调用。简单可靠;细粒度节点级 CRUD 后续再拆。
```json
// req
{
  "title": "(可选)",
  "canvas_state": { "nodes": [ ... ], "viewport": { ... } },
  "messages": [ ... ]
}
```

#### `DELETE /api/projects/{id}`
> 删除前需用户确认(前端二次确认)。

---

### 5.6 Agent 对话(SSE 流式)

> **已抽出独立 PRD**。Agent 对话的 req/res、SSE 全事件序列、6 条后端硬约束、Skill/BottomDock/Canvas 接入点、P0/P1 边界与验收 → 见 **`AGENT-CONVERSATION-PRD.md`**(§2 输入 / §3 SSE 事件 / §4 硬约束 / §5 接入点 / §7 验收)。

入口端点(权威定义在 Agent PRD):

- `POST /api/projects/{project_id}/agent/turn` —— `text` + 可选 `forced_skill_id`;`forced_skill_id` 字段权威定义见 `skill/references/backend_implementation_contract.md` Agent Turn 字段。

---

### 5.7 节点衍生操作(P1 占位)

`POST /api/nodes/{node_id}/actions` —— `refresh` / `shuffle` / `video-from-image` / `paint` / `light` / `upscale`,各自启动一个新的 GenerationJob。

### 5.8 Skill

> **已抽出独立 PRD**。Skill 面板的全部接口(library / mine / 关系操作 / 签名封面)、双向同步规则、`Use` 与 `auto` 语义 → 见 **`FRONTEND-SKILL-PANEL-PRD.md`**(§3 数据契约 / §4 交互规则 / §5 接入点)。Skill 已从 P1 提升至 P0。

## 6. BottomDock 直生 vs Agent 对话(职责边界)

按 `CONTEXT.md`:**两条独立生成路径,不合并为同一 API**。职责按「要快 / 要好」划分,二者底层共用 GenerationJob + Asset,保证计费/状态/资产管理统一。

| 维度 | BottomDock(`/generate`)| Agent(`/agent/turn`)|
|---|---|---|
| 定位 | **要快**——用户自负责 prompt 质量 | **要好**——Agent 帮优化 |
| 承担 | **所有直接生成**(Direct Image / Direct Video / Image-to-Video) | **单入口多分支**:L1 轻量 classifier(haiku 级)→ lightweight / full_canvas / prompt_only / revise / product_switch / consult / confirm 等 |
| 入参 | 完整参数 + prompt + reference_asset_ids | 自然语言意图 |
| 提示词处理 | **零处理**(原话 + 参数直传 Provider,不做任何优化;质量用户自负责) | **永远有 Prompt Optimizer**(技术规整 + 创意优化,出 `optimized_prompt_preview` 用户确认) |
| 图理解 | **零 understanding**(图随 reference_asset_ids 直传 Provider,Provider 自己消费图像素) | 图推理前必须 `asset_understanding`(见 `backend_implementation_contract.md` 硬约束 8) |
| 编排 | 无,直接 GenerationJob | L1 轻量 classifier + worker 编排 |
| 产物 | Asset → 画布节点(不进对话流) | 对话消息 + Asset → 画布节点 |
| 复用 | 共用 `/api/jobs` 状态查询 | 内部启动 Job,进度走 turn 的 SSE |
| 详见 | 本文 §5.4 | **`AGENT-CONVERSATION-PRD.md` §5.2** |

> Image-to-Video 两条路径都能做,机制不同:Dock = 图 + prompt 直传 Provider(零中间步);Agent = understanding + 优化 + 生成。用户按「要快 / 要编排」选入口。

## 7. 数据模型(补充 backend contract 未覆盖的表)

> **⚠️ 2026-07-21 现实校准**:标注每张表「✅ 后端已实现 / ⚠️ 待补」。理想字段保留,现实偏离见标注。

backend contract 已定义:Agent Turn / Canvas Node / Workflow Run / Stage / ChatMessage。补充:

```
users                                          -- ✅ 已实现(手机号登录,非匿名)
  id
  phone / username / status                    -- 现实字段(user-service)
  (anonymous_id 方案未实现;P2 登录迁移见 §11)
  created_at

assets                                         -- ✅ 已实现(⚠️ understanding 两列待补 G0 #IK2H6I)
  id
  user_id
  type            -- image | video
  storage_key
  url             -- 当前可访问 URL(可能过期)
  mime, size
  width, height, duration
  source          -- upload | generated
  status          -- normal | failed            -- 现实枚举
  understanding_status  -- ⚠️ 待补(G0);none | processing | ready | failed（仅 Agent 链路消费图前触发）
  understanding_data     -- ⚠️ 待补(G0);jsonb: subject/visual_traits/scene/text_or_logo/usage_intent/must_keep/can_change/uncertainties/source
  created_at

projects                                       -- ✅ 已实现(现实两表,见下)
  id
  user_id (owner_id)
  title (name)
  thumb (cover_asset_id)
  created_at, updated_at
  -- ⚠️ 现实不含 canvas_state / messages 列;原 PRD 单表方案未实现

canvas                                         -- ✅ 已实现(现实新增表,从 projects 拆出)
  project_id (UNIQUE)
  viewport_json                                 -- json 字符串,后端不解析
  nodes_json                                    -- json 字符串

message                                        -- ⚠️ 待建(wayfinder #IK2H7R B 票;Agent 对话 messages)
  id
  project_id
  role / type / content                         -- 取 backend contract ChatMessage variant
  created_at

generation_jobs                                -- ✅ 已实现(source + stage_id 已有)
  id
  project_id
  user_id
  type            -- image | video
  source          -- dock | agent               -- ✅ 已有
  input           -- jsonb: prompt/model/params/reference_asset_ids
  status          -- queued | processing | succeeded | failed
  progress
  output_asset_ids -- jsonb
  error
  stage_id        -- 关联 workspace Stage       -- ✅ 已有(agent 触发时)
  provider / provider_task_id / poll_count / next_poll_at / retry_count / last_polled_at  -- 现实轮询字段
  created_at, updated_at
```

## 8. 执行模型与长任务

- 图/视频生成、Agent 编排均为**异步 + SSE**。
- 任务**后台持久化**:用户刷新 / 切 Project / 关浏览器后,`generation_jobs` 继续执行;回到 Project 时 `GET /api/projects/{id}` 的 `active_jobs` 暴露进行中任务,前端渲染为 `generating` 节点。
- Agent turn SSE 关闭后,进行中的 Job 由 `active_jobs` + `/api/jobs/{id}/stream` 接管;前端重连失败时再轮询 `GET /api/jobs/{id}`。
- 前端轮询仅作 SSE 断线兜底(`GET /api/jobs/{id}`)。
- 视频生成耗时长,前端 `generating` 占位卡必须可见,完成翻 `ready`,失败显示"可在对话里要求重做"。

## 9. 非功能 / 前置依赖

1. **CDN 域名统一**:前端发现三个 CloudFront 域(`dj5nb01yl89hl`、`du9d8548ooqnc`、`d1735p3aqhycef`)+ `images.unsplash.com` + `placehold.co`。后端规划统一资产域名后,前端同步更新 `next.config.ts` 的 `images.remotePatterns`(目前只白名单了 `dj5nb01yl89hl`)。
2. **Skill 封面(无签名,2026-07-22 决策)**:封面非敏感,不用 CloudFront Signed URL。封面 = `skill.cover_url` 公开图 URL,由 `library`/`mine` 直接返回,无 `signed-cover` 端点。(`GET /api/assets/{id}` 资产签名另议,非封面。)
3. **上传替换 base64**:当前前端用 `FileReader.readAsDataURL` 把上传图塞进画布 state(`app/canvas/page.tsx:163-189`),大图会撑爆内存。后端 presign 接口就绪后前端立即改走直传。
4. **错误码**:至少区分 `quota_exhausted`(P2)/ `content_moderation_rejected` / `upstream_timeout` / `asset_unavailable` / `asset_understanding_missing`。
5. **多模态**:主 LLM 不支持图像时,后端必须调视觉模型或回退让用户补充,不得伪造 `asset_understanding`。

## 10. 验收标准(P0)

本文聚焦**核心基础设施**验收。Agent 对话链路相关验收 → 见 **`AGENT-CONVERSATION-PRD.md` §7**。

1. 用户在 BottomDock 填参数生成图/视频,能拿到真实 Asset URL 并在画布以 `ready` 节点展示。
2. 生成中刷新页面或切走再回来,任务仍在,完成时翻 `ready`。
3. 关浏览器再开,`GET /api/projects/{id}` 恢复画布 + 对话 + 进行中任务。
4. 前端三处模型硬编码全部替换为 `GET /api/catalog`。

> Agent 对话相关验收(自然语言流式、Image-to-Video 前置理解、刷新不丢、用户只说"继续"不推进、trace/prompt/worker 名不泄露)已迁至 `AGENT-CONVERSATION-PRD.md` §7。

## 11. 风险

- **URL 签名过期(已解,2026-07-22)**:Skill 封面不用签名(详见 `FRONTEND-SKILL-PANEL-PRD.md` §3.4),33 条硬编码签名随 mock 移除,无集体 403 风险。
- **匿名身份迁移**:P2 引入登录时,需把 `anonymous_id` 名下的 Project/Asset 合并到正式账户,后端需预留合并路径。
- **Agent runtime 复杂度**:见 `AGENT-CONVERSATION-PRD.md` §8。
