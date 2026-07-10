# Image Understanding Workflow

目标：用户上传图片后，先把图片转成可供 Agent 使用的资产理解结果。

这是 Video Agent Canvas 的中间层，不是最终创作阶段。

> **归属 Agent 链路**：understanding 是给 Agent 的 LLM 推理用的（Agent 基于图做 brief / skill / 分镜）。**Dock 直生不经过本 workflow**——Dock 把图随 `reference_asset_ids` 直传 Provider，Provider 自己消费图像素。详见 `backend_implementation_contract.md` 硬约束 8。

## 触发条件

本 workflow **仅对已指向的 asset 做 understanding**（对齐决策 3：understanding 仅 @ 引用触发，lazy + 缓存）：

- 用户 @ 引用画布图（`reference_asset_ids`）→ 该 asset 若 `understanding_status != ready` 补做
- 用户选中画布图（`active_asset_id`）→ 同上
- 用户上传新图 → 上传时或引用时补做
- 图生图 / 图转视频前，目标 asset 必须已有 understanding

纯文生不进本 workflow。**画布多图 + 用户未指明用哪张时，先在 `@` 引用解析阶段消歧**（见下），确定指向后才进本 workflow。

**生图意图 + 未明确指向素材时**（决策 4）：系统主动提示用户点选画布图 / 上传新图 / @ 某张，用户做明确动作后才调视觉模型。非生图场景不触发 understanding。不偷偷扫画布猜用户指哪张。

**asset 两态**（决策 5）：

| 状态 | 模型能拿到 | 何时进入 |
|---|---|---|
| 未引用态 | 上传元信息（`asset_id` / 文件名 / title / 尺寸类型） | 上传后、未被引用 |
| 已理解态 | 上述 + `asset_understanding` | 第一次被选中/@/进生成引用时算 |

`previous_product_context` 的 asset 按此分层：被引用过的带 understanding，只上传没引用的只有元信息。

## 候选图消歧（@ 引用解析阶段，画布多图未指明时）

**挂载点**：消歧发生在 `@` 引用解析阶段（对齐决策 3/5），**不是** understanding workflow 内部。用户要引画布图但没指明哪张时，先消歧定指向，确定 asset 后才进 understanding。

判定（字段由后端算好进 `decision_context`，见 `rules/decision_layer.md`；本轮 @ 引用指向 = 请求体 `reference_asset_ids`）：

```text
本轮指向解析：
  ├ reference_asset_ids 非空（@ 引用）         → 用那些
  ├ active_asset_id 非空（前端选中态）         → 用那个（选中即识别，不追问）
  └ 都没有：
       candidate_asset_ids（active_product_context 内 ready/confirmed image）
       ├ count = 0  → 无候选，按无图处理
       ├ count = 1  → 用唯一张
       └ count ≥ 2  → 消歧反问（画布高亮 + 文字引导）
```

**候选范围** = 当前 `active_product_context` 内、`ready` / `confirmed` 的 image。不含其他产品图（跨产品引用必须用户显式，见 `product_switch_p0.md` 第 4/5 类），不含 `generating` / `queued` / `failed`。

**消歧执行**（决策 5：反问带候选）：

- 主 Agent 输出：「我看到 N 张候选 [列出 title]，点画布上高亮的图，或 @ 某张 / 上传新图」
- 前端画布高亮候选，其他淡化（见 `frontend_canvas_interaction_contract.md`）
- 用户下一轮答（三条硬路径）：
  - 点选画布高亮图 → `active_asset_id`（硬，**选中即识别，不追问**）
  - @某张图 → `reference_asset_ids`（硬）
  - 上传新图 → 新 asset（硬，覆盖消歧走新路）
  - 纯文字「第3张」→ **不认**（主 Agent 不猜编号映射）

**多图引用**（`@A @B`）：每张 asset 各自 `asset_understanding`；`usage_intent` 优先复用历史 → 无则主 Agent 推断（产品特征→主体，风格特征→风格）→ `optimized_prompt_preview` 暴露 → 用户可改。仅当推断不出才追问。

**铁律**：主 Agent 多图时**禁止**靠「最近 ready / 第一张 / 刚生成」猜自然语言指代——猜 = 默认扫描变体。`active_asset_id`（用户画布选中）视为明确指向，不追问；不定义过期（纯文生不进本 workflow，自动兜底）。

## 阶段

| 阶段 | 名称 | 产物 | 是否需要用户确认 |
|---|---|---|---|
| 1 | 能力判断 | multimodal_status | 否 |
| 2 | 图片识别 | asset_understanding | 视情况 |
| 3 | 缺口补充 | user_asset_description | 是 |
| 4 | 持久化 | asset.understanding_data（写 asset 表，非画布节点） | 否 |

## Stage 1：能力判断

读取系统能力：

- 主 LLM 是否支持图片输入
- 是否配置独立视觉模型
- 是否只能处理文本

输出：

```text
multimodal_status:
- primary_llm_vision: true/false
- vision_model_available: true/false
- strategy: direct_vision / vision_adapter / ask_user
```

## Stage 2：图片识别

### direct_vision

主 LLM 直接识别图片。

### vision_adapter

独立视觉模型先识别图片，再把结构化摘要交给主 LLM。

### ask_user

没有视觉能力，不识别图片。向用户索要描述。

## Stage 3：缺口补充

当无法识别或识别不确定时，只问当前任务必要问题。

```text
我还需要确认图片里的关键信息：
1. 图片里的主体是什么？
2. 哪些外观特征必须保留？
3. 这张图是产品参考、风格参考，还是构图参考？
```

## Stage 4：持久化到 asset 表

把 understanding 写入 `assets.understanding_data`（数据本体），`understanding_status` 翻 `ready`。**不是画布节点**——画布只承载 image / video 素材，understanding 数据挂 asset 表（见 `BACKEND-API-PRD.md` §7）。

`understanding_data` 字段：

```text
subject
visual_traits
scene
text_or_logo
usage_intent
must_keep
can_change
uncertainties
source: direct_vision / vision_adapter / user_description
```

> ChatMessage 的 `asset_understanding` variant 是从这份数据**派生**的展示摘要（给用户读），不是数据本体。

## 阻断规则

以下情况不能进入图生图或图片转视频：

- 参考图未识别，且用户也未补充描述
- 不知道图片是产品参考、风格参考还是构图参考
- 必须保留的主体特征不清楚

## 禁止

- 不把图片上传成功等同于图片已理解。
- 不把文件名、URL 或 asset id 当成图片内容。
- 不假装模型看懂了图片。
