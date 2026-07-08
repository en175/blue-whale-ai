# Backend Implementation Contract

这份文件把 Agent 编排规则翻译成后端工程需要实现的数据契约。

目标：后端可以按这个契约实现 Video Agent Canvas，而不是重新猜 Agent 应该怎么工作。

## 核心对象

### Agent Turn

每次用户输入或系统推进，都会产生一个 Agent Turn。

```text
turn_id
canvas_id
workflow_run_id
stage_id
user_message
intent
visible_reasoning
user_message_out
canvas_updates
trace_event
forced_skill_id
decision_context
created_at
```

字段说明(补充):

| 字段 | 用户可见 | 说明 |
|---|---|---|
| `forced_skill_id` | 否(仅后端消费) | 用户在 Skill 面板点 `Use` 时携带;**仅决定 skill 选择那一步,不锁后续 Stage**;一次性指令,**不持久化为 `auto`**。详见 `AGENT-CONVERSATION-PRD.md` §2 / §5。 |
| `decision_context` | 否(仅后端消费) | 每轮前置算好的判定上下文(硬事实 + L1 软建议 + 组合 `decision_branch`),主 Agent 据此 `switch(decision_branch)` 收口,不再自行扫状态自判。字段全集见本文 `decision_context` 节,语义权威见 `skill/rules/decision_layer.md`。 |

字段说明：

| 字段 | 用户可见 | 说明 |
|---|---|---|
| `visible_reasoning` | 是 | 产品化思考过程摘要 |
| `user_message_out` | 是 | Agent 给用户看的正式回复 |
| `canvas_updates` | 是 | 本轮新增或更新的画布节点 |
| `trace_event` | 否 | 内部调试日志，不给普通用户展示 |

## visible_reasoning

前端“思考过程”区域展示这个字段。

格式建议：

```json
{
  "title": "思考过程",
  "items": [
    "我看到画布里已有一张保温杯产品图。",
    "这个需求更适合使用电商产品图 Skill。",
    "我会先生成 3 个商品图方向供你确认。"
  ]
}
```

如果前端只支持文本：

```text
我看到画布里已有一张保温杯产品图。这个需求更适合使用电商产品图 Skill。我会先生成 3 个商品图方向供你确认。
```

禁止放入：

- prompt
- worker 文件名
- tool call
- JSON 参数
- 文件路径
- 模型真实推理链

## trace_event

后端内部保存，默认不展示给普通用户。

格式建议：

```json
{
  "agent": "director",
  "worker": "skill_selector",
  "tool": "select_skill",
  "input_summary": "...",
  "output_summary": "...",
  "raw_error": null
}
```

用途：

- 排查 Agent 为什么选错 Skill
- 排查确认门为什么没有推进
- 排查生成失败
- 开发者模式复盘

## decision_context

每轮 Agent Turn 前置算好的判定上下文,整体喂主 Agent。主 Agent 据此 `switch(decision_branch)` 收口,不再自行扫状态、不再自判硬状态。

权威定义(三层分工 / `decision_branch` 枚举 / 组合器优先级 / L1 classifier 契约 / 推翻规则)见 `skill/rules/decision_layer.md`,本文件只列字段全集。

```text
decision_context:
  # 硬事实(后端代码算,零 LLM)
  has_generating: bool              # 是否有 generating 节点
  has_ready_node: bool              # 当前 stage 是否有 ready/awaiting_confirm 节点
  has_failed: bool                  # 是否有 failed 节点
  awaiting_confirm: bool            # 当前 stage 是否在等确认
  pending_workflow: bool            # 是否有未完成 workflow
  current_stage: stage_ref          # 当前 stage(id + name + status)
  active_product_context: object    # 当前产品方向(见 product_switch_p0.md)
  previous_product_context: object? # 前一个产品方向(无则 null)
  active_asset_id: asset_id?       # 前端选中态透传(用户当前选中画布节点的 asset),无则 null
  candidate_asset_ids: asset_id[]  # active_product_context 内 ready/confirmed image node(消歧候选)
  # 注:本轮 @ 引用指向复用请求体的 reference_asset_ids,不在此重复

  # L1 输出(独立轻量 classifier,软建议)
  intent_direction: enum            # product_switch / new_task / prompt_only / consult / revise / responding_to_confirm / ambiguous
  suggested_route: enum?            # 仅 new_task 带:lightweight / full_canvas
  route_signals: string[]           # L1 判定信号,供主 Agent 评估推翻

  # 组合结果(后端代码按优先级算出,单一值)
  decision_branch: enum             # generation_in_progress / product_switch / new_task / prompt_only / consult / revise_canvas / confirm_pending / generation_failed / clarify
```

**L1 classifier 调用时机**:硬状态代码每轮必跑(零成本);`has_generating=true` 直接短路到 `generation_in_progress`,**跳过 L1**;其余情况才调 L1(独立轻量模型,haiku 级)。L1 是软建议,主 Agent 可推翻(见 `decision_layer.md` 推翻规则)。`decision_context` 是后端 turn 内部,不暴露新 API,不进 SSE。

## Canvas Node

画布节点只表示用户能看到的图片 / 视频素材结果。生成任务本身由 GenerationJob 承载，brief / skill / 分镜 / review 等过程内容由 ChatMessage 承载。

```text
node_id
canvas_id
stage_id
type
status
title
is_user_titled
content
asset_refs
source
visible_reasoning
created_at
updated_at
```

> `title` 命名（三位一体：prompt 派生 / 文件名 / `understanding.subject` 覆盖）与 `is_user_titled`（用户手改标记，置 true 后 understanding 不再覆盖 title）的完整规则见 `canvas_state_rules.md`。

### node.type（画布节点,仅素材）

画布只承载素材节点,生成中与已完成的区分用 `status`(queued / generating / ready / ...),
不拆 task / result type:

- `image`  （图片:中间结果或最终结果）
- `video`  （视频:中间结果或最终结果）

### 对话消息类型(ChatMessage variant)

过程性内容在对话流展示,**不进画布**:

- `visible_reasoning`  （思考过程,可折叠）
- `brief`  （需求摘要）
- `skill_recommendation`  （Skill 推荐）
- `asset_understanding`  （图片理解摘要；**派生展示消息**：从 `assets.understanding_data` 派生给用户读的摘要，数据本体挂 asset 表，见 `BACKEND-API-PRD.md` §7）
- `stage_plan`  （阶段计划）
- `script` / `storyboard`  （脚本 / 分镜）
- `prompt_draft` / `optimized_prompt`  （提示词草稿 / 优化后,**默认不展示给用户**;`optimized_prompt` 是发给 Provider 的原始版,含系统指令/格式 token)
- `optimized_prompt_preview`  （优化后提示词的**用户友好版**,中文可读、可展示;区别于原始 `optimized_prompt`;`prompt_only` 分支只输出它,不启动 GenerationJob / 不写 Canvas）
- `review`  （审核结论）
- `plain_text`  （普通文字回复）
- `image_card` / `video_card`  （结果卡,引用画布上的 asset node）
- `error`  （错误说明,可展示给用户)

### node.status

建议值：

- `queued`
- `generating`
- `ready`
- `awaiting_confirm`
- `confirmed`
- `rejected`
- `failed`

确认门只允许对 `ready` 或 `awaiting_confirm` 的素材节点生效。`queued` / `generating` / `failed` 节点不能被确认。

## Workflow Run

```text
workflow_run_id
canvas_id
workflow_name
current_stage_id
status
selected_skill
brief
stage_plan
created_at
updated_at
```

### workflow.status

建议值：

- `idle`
- `collecting`
- `running`
- `awaiting_confirm`
- `completed`
- `failed`

### workflow_name

建议值：

- `direct_generation`
- `image_generation_prompt`
- `image_understanding`
- `video_agent_canvas`

## Stage

```text
stage_id
workflow_run_id
name
status
required_inputs
outputs
confirmation_required
confirmed_at
```

### stage.status

建议值：

- `pending`
- `running`
- `awaiting_confirm`
- `confirmed`
- `failed`
- `skipped`

## API 返回结构建议

每次用户发消息后，后端返回：

```json
{
  "canvas": {},
  "workflow_run": {},
  "agent_turn": {
    "visible_reasoning": {},
    "user_message_out": "",
    "message_updates": [],
    "canvas_updates": []
  },
  "requires_user_action": true,
  "allowed_actions": ["confirm", "revise", "retry"]
}
```

字段说明：

- `message_updates`:本轮新增/更新的**对话消息**(brief / skill / 分镜 / review /
  visible_reasoning / 结果卡等)。对话区只从这里取内容。
- `canvas_updates`:本轮新增/更新的**画布素材节点**(仅 image / video)。
  画布只从这里取内容;过程内容不得放进 canvas_updates。
- `requires_user_action` / `allowed_actions`:后端组织确认话术的依据,
  前端**不据此渲染按钮**,而是在对话里用文字提示"可以确认 / 修改 / 重做"。

## 用户确认动作

确认采用**对话式**:前端不增加确认按钮,也不发送结构化 action。
用户在对话里用自然语言表达,后端按 `rules/confirmation_gate.md` 的四分类处理
(明确确认 / 弱继续 / 修改意图 / 等待中)。

后端职责:

1. 从用户消息推断意图类别。
2. 结合当前 workflow stage 与 canvas node 的 status 判断能否推进。
3. 只有「当前阶段存在 ready 节点」+「用户明确确认」同时满足,才 `advance_stage`。

- 弱继续("继续/好了/下一步")不推进,后端回复二次确认话术。
- 修改意图("改一下/换风格")进入 revise(见 `rules/revise_canvas.md`),可带自然语言 instruction
  (如"保留构图,换成清晨桌面风格")。
- 重试也通过对话表达("重新生成这版")。

`stage_id`、`node_ids` 由后端从 canvas 状态自行解析,**不要求前端传递**。
返回结构中的 `requires_user_action` / `allowed_actions` 字段保留,但语义是
「后端组织确认话术的依据」,前端**不据此渲染按钮**,而是在对话里用文字
提示用户可以确认 / 修改 / 重做。

## 后端必须实现的硬约束

1. 没有 ready node，不允许确认。
2. 用户只说“继续”，不能自动推进。
3. stage 未确认，不能进入后续生成阶段。
4. confirmed node 默认不覆盖。
5. 生成失败必须写入 failed node，而不是静默失败。
6. `visible_reasoning` 必须经过过滤后再返回前端。
7. `trace_event` 默认不返回普通用户端。
8. **Agent 链路**基于图推理前必须存在 `asset_understanding`；Provider 直接消费图（Dock 直生 / 图生图 / 图生视频）不需要——Provider 是多模态生成模型，直接吃图像素，不存在「假装识别」。
9. 主 LLM 不支持多模态时，不能声称已识别图片，必须调用视觉模型或请求用户补充。
10. Provider 调用前必须存在 `optimized_prompt`。
11. 轻量 direct generation 不应强制创建完整广告 stage plan。
12. 完整广告/UGC/短剧视频不能绕过脚本分镜直接发给 Provider。
13. **`advance_stage` 铁闸(confirm_pending)**:推进 stage 必须独立校验当前 stage 存在 `has_ready_node`,与主 Agent 判定**解耦**——主 Agent 误判要推进也拦。呼应 `decision_layer.md` confirm_pending 后端铁闸与 `confirmation_gate.md`。
14. **候选图消歧铁闸**：`@` 引用解析阶段，任务需要图 + `candidate_asset_ids` ≥ 2 + 无 `reference_asset_ids` / `active_asset_id` 时，必须消歧反问（画布高亮 + 文字引导），**禁止**主 Agent 靠「最近 ready / 第一张 / 刚生成」猜自然语言指代。`active_asset_id`（用户画布选中）视为明确指向，选中即识别不追问。详见 `image_understanding.md` 候选图消歧。
15. **id 全部后端生成**：画布 node_id / asset_id 由后端创建/列表接口返回，前端不得本地 mint；`active_asset_id` / `candidate_asset_ids`（及请求体 `reference_asset_ids`）必须是后端认识的 id。

## 前端展示建议

一个 Agent Turn 可以展示为：

```text
[思考过程]
我看到...
我判断...
我接下来...

[正式回复]
当前阶段结果已生成，请确认是否满意。

[画布]
展示新增节点
```

确认走对话:用户用自然语言表达确认 / 修改 / 重做(详见 `rules/confirmation_gate.md`),
此处**不渲染按钮**。

## 工程验收标准

实现完成后，至少验证：

1. 用户说“继续”但当前结果未明确确认时，不推进。
2. 画布没有 ready node 时，不允许确认。
3. Agent 选择 Skill 后，返回可见选择理由。
4. Seedance 生成提示词不会覆盖已确认 Skill。
5. trace_event 不出现在普通用户响应里。
