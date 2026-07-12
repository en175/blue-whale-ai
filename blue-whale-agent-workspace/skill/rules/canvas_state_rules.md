# Canvas State Rules

Canvas 是事实来源。对话只是意图来源。

## Canvas 里至少要有这些对象

### Canvas

表示一次完整视频创作任务。

字段建议：

- `canvas_id`
- `status`
- `current_stage`
- `selected_skill`
- `brief`
- `stage_plan`

### Node（画布素材节点）

表示画布上的一个**素材节点**(图片或视频)。过程性内容(brief / skill / 分镜 /
review / 思考)不在画布,见下方"对话消息"。

字段建议：

- `node_id`
- `type`: image / video  （画布只承载素材）
- `stage_id`
- `status`: queued / generating / ready / failed / confirmed / rejected
- `title`  （节点显示名；命名规则见下「Node title 三位一体」）
- `is_user_titled`  （用户是否手改过 title；true 后 understanding 不再覆盖）
- `asset_ref`  （引用 Asset）
- `source_agent`
- `created_from`

### Node title 三位一体

`title` 自动生成，按来源分三种、按生命周期覆盖：

1. **直生 / Agent 产出**：初始 = prompt 派生（前 ~15 字）
2. **用户上传**：初始 = 文件名去扩展名
3. **被 @ 引用做 `asset_understanding` 后**：title 覆盖为 `understanding_data.subject`（understanding 的副产品，最准）

`title` 可变：`asset_understanding` 完成时走 `canvas_update` 推前端。用户手改后置 `is_user_titled=true`，后续 understanding 不再覆盖。

> title 是辅助（无障碍 / 搜索），不是用户区分产品的主依据。画布全展示所有素材，用户靠看图点选认素材（见 `PRD/ORCHESTRATION-DECISIONS.md` 决策 2）。

### 对话消息(ChatMessage)

过程性内容在 AgentChatPanel 对话流展示,**不进画布**。类型:

- `visible_reasoning`  （思考过程摘要,可折叠）
- `brief`  （需求摘要）
- `skill_recommendation`  （Skill 推荐）
- `asset_understanding`  （图片理解摘要；**派生展示消息**——数据本体挂 asset 表 `understanding_data`，这里只是给用户读的摘要）
- `stage_plan`  （阶段计划）
- `script` / `storyboard`  （脚本 / 分镜）
- `review`  （审核结论）
- `plain_text`  （普通文字回复）
- `image_card` / `video_card`  （结果卡,引用画布上的 asset node）

`prompt_draft` / `optimized_prompt` / `trace_event` 不展示给普通用户。

### Stage

表示 workflow 中的一个阶段。

字段建议：

- `stage_id`
- `name`
- `status`: pending / running / awaiting_confirm / confirmed / failed / skipped
- `required_inputs`
- `outputs`

## 状态优先级

Agent 每轮必须先看状态，优先级如下：

1. 当前是否有 awaiting_confirm 阶段
2. 当前是否有 generating 节点
3. 当前是否有 failed 节点
4. 当前是否有 pending stage
5. 当前是否是空 canvas

用户新消息必须结合 canvas 状态解释。

## 状态转换

```text
pending
  -> running
  -> awaiting_confirm
  -> confirmed
  -> next pending
```

失败时：

```text
running
  -> failed
  -> retry / revise / cancel
```

修改时：

```text
awaiting_confirm
  -> rejected
  -> revise
  -> running
  -> awaiting_confirm
```

## 画布写入规则

- 只有图片 / 视频素材结果写成 canvas node。
- 内容相同的上传图视为同一 asset（看内容不看文件名），去重不重复展示，复用已有 `asset_understanding`（见 `PRD/ORCHESTRATION-DECISIONS.md` 决策 6）。
- brief / skill / 分镜 / review / asset_understanding / visible_reasoning 等过程内容必须写成 ChatMessage，不进画布。
- `asset_understanding` 的**数据本体**挂 asset 表（`understanding_data`），既不进画布也不作为 ChatMessage 字段；ChatMessage 里的 `asset_understanding` 只是从数据本体派生的展示摘要。
- node 必须绑定 `stage_id`。
- 生成任务不作为 canvas node；任务状态由 GenerationJob 承载，画布节点只通过 `status` 映射为 queued / generating / ready / failed / confirmed / rejected。
- ready 结果才能进入确认门。
- confirmed 结果默认不重写，除非用户明确要求修改。
- 每轮 Agent turn 可以写入 `visible_reasoning` ChatMessage，用于前端展示产品化思考过程。
- `visible_reasoning` 不得包含内部 prompt、worker 文件名、工具参数、JSON 或文件路径。

## Agent Turn 建议字段

```text
turn_id
canvas_id
stage_id
intent
visible_reasoning
user_message
canvas_updates
trace_event
```

前端默认展示 `visible_reasoning`、`user_message` 和 `canvas_updates`。

其中 `canvas_updates` 只包含 image / video 素材节点；过程内容通过对话消息展示。

`trace_event` 仅供调试，不给普通用户展示。

## 禁止

- 禁止只靠聊天记录判断当前阶段。
- 禁止没有 stage_id 的生成结果。
- 禁止把 failed 节点当作 ready。
- 禁止覆盖用户已经确认的结果。
- 禁止把内部 trace 当作用户可见思考过程。
